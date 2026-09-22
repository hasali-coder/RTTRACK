-- RTTRACK 015 | Doctor access lifecycle, administrative activity and aggregate reporting.
-- Apply ONCE after migration 014 (and 001-013) in the existing RTTRACK project.
-- This migration intentionally does not change patient connections, patient sharing,
-- notifications, sessions or authored treatment plans.
BEGIN;
DO $preflight$ BEGIN
 IF to_regclass('public.clinician_applications') IS NULL
  OR to_regclass('public.rttrack_administrators') IS NULL
  OR to_regclass('public.rttrack_application_reviews') IS NULL
  OR to_regclass('public.rttrack_education_audit') IS NULL
  OR to_regprocedure('public.rttrack_is_approved_clinician()') IS NULL
  OR to_regprocedure('public.rttrack_is_administrator()') IS NULL
  OR to_regclass('public.rttrack_combined_consent_events') IS NULL
 THEN RAISE EXCEPTION 'RTTRACK migrations 001-014 are required. Stop without changes.'; END IF;
END $preflight$;

-- A deactivated doctor must not be considered approved by ANY existing treatment,
-- symptom, education or connections RPC that calls rttrack_is_approved_clinician().
ALTER TABLE public.clinician_applications DROP CONSTRAINT IF EXISTS clinician_applications_status_check;
ALTER TABLE public.clinician_applications ADD CONSTRAINT clinician_applications_status_check
 CHECK (status IN ('pending','approved','rejected','deactivated','reapproval_requested'));

-- If an administrator ALSO has a doctor application, a deactivation disables their
-- administrator role for the duration. Admin-only accounts continue to work.
CREATE OR REPLACE FUNCTION public.rttrack_is_administrator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.rttrack_administrators a
   JOIN auth.users u ON u.id=a.user_id
   LEFT JOIN public.clinician_applications c ON c.user_id=a.user_id
   WHERE a.user_id=(SELECT auth.uid()) AND u.email_confirmed_at IS NOT NULL
     AND coalesce(c.status,'') NOT IN ('deactivated','reapproval_requested')
 );
$$;
REVOKE ALL ON FUNCTION public.rttrack_is_administrator() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_is_administrator() TO authenticated;

-- Override the shared gate used by the existing SECURITY DEFINER clinical RPCs.
CREATE OR REPLACE FUNCTION public.rttrack_is_approved_clinician()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.clinician_applications c
  JOIN auth.users u ON u.id=c.user_id
  WHERE c.user_id=(SELECT auth.uid()) AND c.status='approved'
    AND u.email_confirmed_at IS NOT NULL
 );
$$;
REVOKE ALL ON FUNCTION public.rttrack_is_approved_clinician() FROM PUBLIC, anon, authenticated;

-- Existing direct SELECT on connection metadata must not disclose patient names
-- to deactivated doctors via RLS, even if they bypass the application UI.
DROP POLICY IF EXISTS "Connection participants read their own links" ON public.rttrack_patient_clinician_links;
CREATE POLICY "Connection participants read their own links"
 ON public.rttrack_patient_clinician_links FOR SELECT TO authenticated
 USING (patient_id=(SELECT auth.uid()) OR
   (clinician_id=(SELECT auth.uid()) AND (SELECT public.rttrack_is_approved_clinician())));

-- Discovery must reject deactivated doctors even if a historical directory flag remains true.
CREATE OR REPLACE FUNCTION public.rttrack_find_clinicians()
RETURNS TABLE(clinician_id uuid, full_name text, institution text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.rttrack_is_patient() THEN RAISE EXCEPTION 'Patient account required'; END IF;
 RETURN QUERY SELECT c.user_id,c.full_name,c.institution FROM public.clinician_applications c
 JOIN public.rttrack_clinician_directory d ON d.clinician_id=c.user_id
 JOIN auth.users u ON u.id=c.user_id
 WHERE c.status='approved' AND d.discoverable AND u.email_confirmed_at IS NOT NULL
 ORDER BY c.full_name LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.rttrack_find_clinicians() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_find_clinicians() TO authenticated;

-- Immutable administrative access-event metadata, never patient data.
CREATE TABLE public.rttrack_doctor_access_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 doctor_id uuid NOT NULL REFERENCES public.clinician_applications(user_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK (action IN ('deactivated','reapproval_requested','reactivated')),
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 15 AND 2000),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rttrack_doctor_access_events_time_idx ON public.rttrack_doctor_access_events(occurred_at DESC);
ALTER TABLE public.rttrack_doctor_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rttrack_doctor_access_events FROM PUBLIC, anon, authenticated;
-- No direct table access; all reads go through administrator-checked RPCs.

CREATE FUNCTION public.rttrack_deactivate_doctor(p_doctor_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_updated integer; v_reason text := btrim(coalesce(p_reason,''));
BEGIN
 IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_doctor_id IS NULL OR p_doctor_id=auth.uid() THEN RAISE EXCEPTION 'Select another doctor'; END IF;
 IF char_length(v_reason) NOT BETWEEN 15 AND 2000 THEN RAISE EXCEPTION 'Provide a reason of 15 to 2000 characters'; END IF;
 UPDATE public.clinician_applications SET status='deactivated',reviewed_at=now(),review_note=v_reason
 WHERE user_id=p_doctor_id AND status='approved';
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated<>1 THEN RAISE EXCEPTION 'Doctor is not currently approved. Refresh and retry.'; END IF;
 INSERT INTO public.rttrack_doctor_access_events(doctor_id,actor_id,action,reason)
 VALUES(p_doctor_id,auth.uid(),'deactivated',v_reason);
END;
$$;

CREATE FUNCTION public.rttrack_request_doctor_reapproval(p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_updated integer; v_reason text := btrim(coalesce(p_reason,''));
BEGIN
 IF auth.uid() IS NULL OR char_length(v_reason) NOT BETWEEN 15 AND 2000
 THEN RAISE EXCEPTION 'Sign in and provide a reason of 15 to 2000 characters'; END IF;
 UPDATE public.clinician_applications SET status='reapproval_requested',review_note=v_reason
 WHERE user_id=auth.uid() AND status='deactivated';
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated<>1 THEN RAISE EXCEPTION 'Reapproval request is not available for this account'; END IF;
 INSERT INTO public.rttrack_doctor_access_events(doctor_id,actor_id,action,reason)
 VALUES(auth.uid(),auth.uid(),'reapproval_requested',v_reason);
END;
$$;

CREATE FUNCTION public.rttrack_reapprove_doctor(p_doctor_id uuid,p_evidence_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_updated integer; v_note text := btrim(coalesce(p_evidence_note,''));
BEGIN
 IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_doctor_id IS NULL OR p_doctor_id=auth.uid() THEN RAISE EXCEPTION 'Select another doctor'; END IF;
 IF char_length(v_note) NOT BETWEEN 15 AND 2000 THEN RAISE EXCEPTION 'Provide a review note of 15 to 2000 characters'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_doctor_id AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Doctor must have confirmed email'; END IF;
 UPDATE public.clinician_applications SET status='approved',reviewed_at=now(),review_note=v_note
 WHERE user_id=p_doctor_id AND status='reapproval_requested';
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated<>1 THEN RAISE EXCEPTION 'Reapproval has not been requested. Refresh and retry.'; END IF;
 INSERT INTO public.rttrack_doctor_access_events(doctor_id,actor_id,action,reason)
 VALUES(p_doctor_id,auth.uid(),'reactivated',v_note);
END;
$$;

-- Avoid a stale directory presence during deactivation. Reapproval does NOT
-- automatically rediscover a doctor; they may opt into the directory again.
CREATE FUNCTION public.rttrack_hide_deactivated_doctor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.status='deactivated' AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE public.rttrack_clinician_directory SET discoverable=false,updated_at=now()
   WHERE clinician_id=NEW.user_id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER rttrack_hide_doctor_on_deactivation
 AFTER UPDATE OF status ON public.clinician_applications FOR EACH ROW
 EXECUTE FUNCTION public.rttrack_hide_deactivated_doctor();
REVOKE ALL ON FUNCTION public.rttrack_hide_deactivated_doctor() FROM PUBLIC, anon, authenticated;

-- Administrator-only activity stream: review decisions, education actions and
-- doctor access changes. Deliberately excludes patient details and clinical notes.
CREATE FUNCTION public.rttrack_admin_activity(
 p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_action text DEFAULT NULL,p_actor uuid DEFAULT NULL
) RETURNS TABLE(event_key text,actor_id uuid,actor_label text,action text,subject text,occurred_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to THEN RAISE EXCEPTION 'Invalid date range'; END IF;
 RETURN QUERY
 SELECT x.event_key,x.actor_id,coalesce(u.email,'Administrator')::text,x.action,x.subject,x.occurred_at
 FROM (
   SELECT ('review-'||r.id)::text AS event_key,r.reviewer_user_id AS actor_id,
     ('doctor_'||r.decision)::text AS action,c.full_name::text AS subject,r.decided_at AS occurred_at
   FROM public.rttrack_application_reviews r
   JOIN public.clinician_applications c ON c.user_id=r.application_user_id
   UNION ALL
   SELECT ('education-'||e.id)::text,e.actor_id,('education_'||e.event_type)::text,
     res.title::text,e.occurred_at FROM public.rttrack_education_audit e
   JOIN public.rttrack_education_resources res ON res.id=e.resource_id
   UNION ALL
   SELECT ('access-'||a.id)::text,a.actor_id,('doctor_'||a.action)::text,
     c.full_name::text,a.occurred_at FROM public.rttrack_doctor_access_events a
   JOIN public.clinician_applications c ON c.user_id=a.doctor_id
 ) x LEFT JOIN auth.users u ON u.id=x.actor_id
 WHERE (p_from IS NULL OR x.occurred_at>=p_from::timestamptz)
   AND (p_to IS NULL OR x.occurred_at<(p_to::timestamptz+INTERVAL '1 day'))
   AND (p_action IS NULL OR x.action=p_action)
   AND (p_actor IS NULL OR x.actor_id=p_actor)
 ORDER BY x.occurred_at DESC,x.event_key DESC LIMIT 500;
END;
$$;

-- Snapshot figures are explicitly marked snapshot; period figures count
-- administrative decisions in the requested date range, never patient records.
CREATE FUNCTION public.rttrack_admin_report_metrics(p_from date,p_to date)
RETURNS TABLE(metric text,value bigint,kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366
 THEN RAISE EXCEPTION 'Choose a valid date range of up to 366 days'; END IF;
 RETURN QUERY
 SELECT 'Doctors · approved'::text,count(*)::bigint,'snapshot'::text FROM public.clinician_applications WHERE status='approved'
 UNION ALL SELECT 'Doctors · pending'::text,count(*)::bigint,'snapshot'::text FROM public.clinician_applications WHERE status='pending'
 UNION ALL SELECT 'Doctors · deactivated'::text,count(*)::bigint,'snapshot'::text FROM public.clinician_applications WHERE status='deactivated'
 UNION ALL SELECT 'Doctors · reapproval requested'::text,count(*)::bigint,'snapshot'::text FROM public.clinician_applications WHERE status='reapproval_requested'
 UNION ALL SELECT 'Education · drafts'::text,count(*)::bigint,'snapshot'::text FROM public.rttrack_education_resources WHERE status='draft'
 UNION ALL SELECT 'Education · published'::text,count(*)::bigint,'snapshot'::text FROM public.rttrack_education_resources WHERE status='approved'
 UNION ALL SELECT 'Doctor approvals in period'::text,count(*)::bigint,'period'::text FROM public.rttrack_application_reviews
 WHERE decision='approved' AND decided_at>=p_from::timestamptz AND decided_at<(p_to::timestamptz+INTERVAL '1 day')
 UNION ALL SELECT 'Doctor reactivations in period'::text,count(*)::bigint,'period'::text FROM public.rttrack_doctor_access_events
 WHERE action='reactivated' AND occurred_at>=p_from::timestamptz AND occurred_at<(p_to::timestamptz+INTERVAL '1 day')
 UNION ALL SELECT 'Education approvals in period'::text,count(*)::bigint,'period'::text FROM public.rttrack_education_audit
 WHERE event_type='approved' AND occurred_at>=p_from::timestamptz AND occurred_at<(p_to::timestamptz+INTERVAL '1 day');
END;
$$;

CREATE FUNCTION public.rttrack_admin_report_trends(p_from date,p_to date)
RETURNS TABLE(day date,doctor_reviews bigint,education_actions bigint,access_actions bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366
 THEN RAISE EXCEPTION 'Choose a valid date range of up to 366 days'; END IF;
 RETURN QUERY SELECT d.day::date,
 (SELECT count(*) FROM public.rttrack_application_reviews r WHERE r.decided_at>=d.day AND r.decided_at<d.day+INTERVAL '1 day')::bigint,
 (SELECT count(*) FROM public.rttrack_education_audit e WHERE e.occurred_at>=d.day AND e.occurred_at<d.day+INTERVAL '1 day')::bigint,
 (SELECT count(*) FROM public.rttrack_doctor_access_events a WHERE a.occurred_at>=d.day AND a.occurred_at<d.day+INTERVAL '1 day')::bigint
 FROM generate_series(p_from::timestamptz,p_to::timestamptz,INTERVAL '1 day') d(day)
 ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.rttrack_deactivate_doctor(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_request_doctor_reapproval(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_reapprove_doctor(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_admin_activity(date,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_admin_report_metrics(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_admin_report_trends(date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_deactivate_doctor(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_request_doctor_reapproval(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_reapprove_doctor(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_admin_activity(date,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_admin_report_metrics(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_admin_report_trends(date,date) TO authenticated;
COMMIT;
