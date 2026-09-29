-- RTTRACK 017: administrator-only user directory and invitation lifecycle.
-- Apply after existing migrations 001-016. No existing users or clinical records are changed.
BEGIN;
DO $preflight$ BEGIN
  IF to_regclass('public.clinician_applications') IS NULL OR
     to_regclass('public.patient_profiles') IS NULL OR
     to_regclass('public.rttrack_administrators') IS NULL OR
     to_regprocedure('public.rttrack_is_administrator()') IS NULL OR
     to_regprocedure('public.rttrack_is_patient()') IS NULL OR
     to_regprocedure('public.rttrack_is_approved_clinician()') IS NULL
  THEN RAISE EXCEPTION 'RTTRACK migrations 001-016 must be applied first'; END IF;
END $preflight$;

-- Service-only invitation state; no browser role may read or write the table.
CREATE TABLE public.rttrack_account_invites (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('patient','doctor')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  password_set_at timestamptz
);
ALTER TABLE public.rttrack_account_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rttrack_account_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rttrack_account_invites TO service_role;

-- Supabase Auth updates encrypted_password when the invitee selects a password.
-- This server-side event, rather than editable user metadata, completes onboarding.
CREATE FUNCTION public.rttrack_complete_invite_on_password_set()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password
     AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.rttrack_account_invites
       SET password_set_at = now()
     WHERE user_id = NEW.id AND password_set_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rttrack_complete_invite_on_password_set() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rttrack_invite_password_set
AFTER UPDATE OF encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.rttrack_complete_invite_on_password_set();

CREATE FUNCTION public.rttrack_my_invitation_pending()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rttrack_account_invites i
    WHERE i.user_id = (SELECT auth.uid()) AND i.password_set_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.rttrack_my_invitation_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_my_invitation_pending() TO authenticated;

-- Preserve existing clinical permission checks, additionally withholding access
-- from an invited user until the server has recorded the first password change.
CREATE OR REPLACE FUNCTION public.rttrack_is_patient()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.patient_profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE p.user_id = (SELECT auth.uid()) AND u.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.rttrack_account_invites i
      WHERE i.user_id = p.user_id AND i.password_set_at IS NULL
    )
  );
$$;
REVOKE ALL ON FUNCTION public.rttrack_is_patient() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rttrack_is_approved_clinician()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinician_applications c
    JOIN auth.users u ON u.id = c.user_id
    WHERE c.user_id = (SELECT auth.uid()) AND c.status = 'approved'
    AND u.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.rttrack_account_invites i
      WHERE i.user_id = c.user_id AND i.password_set_at IS NULL
    )
  );
$$;
REVOKE ALL ON FUNCTION public.rttrack_is_approved_clinician() FROM PUBLIC, anon, authenticated;

-- Directory: private PII is available solely to confirmed, active administrators.
-- Search/filter/pagination execute on the server rather than in browser memory.
CREATE FUNCTION public.rttrack_admin_user_directory(
  p_role text DEFAULT 'all', p_status text DEFAULT 'all',
  p_search text DEFAULT '', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id uuid, full_name text, email text, user_role text,
  account_status text, created_at timestamptz, email_confirmed_at timestamptz,
  registration_number text, institution text, total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_administrator() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_role,'') NOT IN ('all','patient','doctor','administrator') OR
     coalesce(p_status,'') NOT IN ('all','active','not_activated','pending','approved','rejected','deactivated','reapproval_requested') OR
     p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
     p_offset IS NULL OR p_offset < 0 OR
     length(coalesce(p_search,'')) > 120 THEN
    RAISE EXCEPTION 'Invalid directory filters or pagination';
  END IF;

  RETURN QUERY WITH directory AS (
    SELECT u.id AS user_id,
      CASE WHEN c.user_id IS NOT NULL THEN c.full_name
           WHEN p.user_id IS NOT NULL THEN p.full_name
           ELSE coalesce(nullif(u.raw_user_meta_data ->> 'full_name',''), 'Administrator') END::text AS full_name,
      u.email::text AS email,
      CASE WHEN c.user_id IS NOT NULL THEN 'doctor'
           WHEN p.user_id IS NOT NULL THEN 'patient'
           ELSE 'administrator' END::text AS user_role,
      CASE WHEN u.email_confirmed_at IS NULL
                  OR (i.user_id IS NOT NULL AND i.password_set_at IS NULL) THEN 'not_activated'
           WHEN c.user_id IS NOT NULL THEN c.status
           ELSE 'active' END::text AS account_status,
      u.created_at AS created_at, u.email_confirmed_at AS email_confirmed_at,
      c.registration_number::text AS registration_number,
      c.institution::text AS institution
    FROM auth.users u
    LEFT JOIN public.clinician_applications c ON c.user_id = u.id
    LEFT JOIN public.patient_profiles p ON p.user_id = u.id
    LEFT JOIN public.rttrack_administrators a ON a.user_id = u.id
    LEFT JOIN public.rttrack_account_invites i ON i.user_id = u.id
    WHERE c.user_id IS NOT NULL OR p.user_id IS NOT NULL OR a.user_id IS NOT NULL
  )
  SELECT d.user_id,d.full_name,d.email,d.user_role,d.account_status,
         d.created_at,d.email_confirmed_at,d.registration_number,d.institution,
         count(*) OVER ()::bigint
  FROM directory d
  WHERE (p_role = 'all' OR d.user_role = p_role)
    AND (p_status = 'all' OR d.account_status = p_status)
    AND (btrim(p_search) = '' OR
      d.full_name ILIKE '%' || btrim(p_search) || '%' OR
      d.email ILIKE '%' || btrim(p_search) || '%' OR
      coalesce(d.registration_number,'') ILIKE '%' || btrim(p_search) || '%' OR
      coalesce(d.institution,'') ILIKE '%' || btrim(p_search) || '%')
  ORDER BY d.created_at DESC, d.user_id
  LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.rttrack_admin_user_directory(text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_admin_user_directory(text,text,text,integer,integer) TO authenticated;

CREATE FUNCTION public.rttrack_admin_directory_counts()
RETURNS TABLE(total bigint, doctors bigint, patients bigint, administrators bigint, not_activated bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_administrator() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE c.user_id IS NOT NULL)::bigint,
         count(*) FILTER (WHERE c.user_id IS NULL AND p.user_id IS NOT NULL)::bigint,
         count(*) FILTER (WHERE c.user_id IS NULL AND p.user_id IS NULL AND a.user_id IS NOT NULL)::bigint,
         count(*) FILTER (WHERE u.email_confirmed_at IS NULL OR
           (i.user_id IS NOT NULL AND i.password_set_at IS NULL))::bigint
  FROM auth.users u
  LEFT JOIN public.clinician_applications c ON c.user_id = u.id
  LEFT JOIN public.patient_profiles p ON p.user_id = u.id
  LEFT JOIN public.rttrack_administrators a ON a.user_id = u.id
  LEFT JOIN public.rttrack_account_invites i ON i.user_id = u.id
  WHERE c.user_id IS NOT NULL OR p.user_id IS NOT NULL OR a.user_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rttrack_admin_directory_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_admin_directory_counts() TO authenticated;

CREATE FUNCTION public.rttrack_admin_invitation_activity(p_limit integer DEFAULT 100)
RETURNS TABLE(event_id uuid, actor_email text, target_email text, user_role text, event_type text, occurred_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_administrator() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid activity limit';
  END IF;
  RETURN QUERY
  SELECT events.event_id, events.actor_email, events.target_email, events.user_role,
         events.event_type, events.occurred_at
  FROM (
    SELECT i.user_id AS event_id, actor.email::text AS actor_email,
           invited.email::text AS target_email, i.role AS user_role,
           'invited'::text AS event_type, i.invited_at AS occurred_at
    FROM public.rttrack_account_invites i
    JOIN auth.users actor ON actor.id = i.invited_by
    JOIN auth.users invited ON invited.id = i.user_id
    UNION ALL
    SELECT i.user_id, actor.email::text, invited.email::text, i.role,
           'activated'::text, i.password_set_at
    FROM public.rttrack_account_invites i
    JOIN auth.users actor ON actor.id = i.invited_by
    JOIN auth.users invited ON invited.id = i.user_id
    WHERE i.password_set_at IS NOT NULL
  ) AS events ORDER BY events.occurred_at DESC LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.rttrack_admin_invitation_activity(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_admin_invitation_activity(integer) TO authenticated;
COMMIT;
