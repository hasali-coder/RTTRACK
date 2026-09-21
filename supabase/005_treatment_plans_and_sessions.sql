-- RTTRACK M03C: treatment plans and fraction appointments for FICTIONAL DEVELOPMENT DATA ONLY.
-- Apply once after migrations 001-004 to the EXISTING development Supabase project.
-- Clinicians enter prescribed values; RTTRACK NEVER calculates, recommends, or changes prescriptions.
-- No email/SMS, emergency monitoring, or clinical decision support is activated by this migration.
BEGIN;

CREATE TABLE public.rttrack_treatment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.clinician_applications(user_id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  treatment_site text NOT NULL CHECK (char_length(btrim(treatment_site)) BETWEEN 2 AND 120),
  technique text NOT NULL CHECK (char_length(btrim(technique)) BETWEEN 2 AND 120),
  total_fractions integer NOT NULL CHECK (total_fractions > 0 AND total_fractions <= 1000),
  prescribed_total_gy numeric(12,3) NOT NULL CHECK (prescribed_total_gy > 0),
  planned_start_on date,
  estimated_end_on date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT rttrack_valid_plan_dates CHECK (
    planned_start_on IS NULL OR estimated_end_on IS NULL OR estimated_end_on >= planned_start_on
  ),
  CONSTRAINT rttrack_published_plan_timestamp CHECK (
    (status = 'draft' AND published_at IS NULL) OR
    (status = 'active' AND published_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX rttrack_one_active_plan_per_patient
  ON public.rttrack_treatment_plans(patient_id) WHERE status = 'active';
CREATE INDEX rttrack_plans_patient_idx ON public.rttrack_treatment_plans(patient_id, created_at DESC);
CREATE INDEX rttrack_plans_author_idx ON public.rttrack_treatment_plans(created_by, created_at DESC);
ALTER TABLE public.rttrack_treatment_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_treatment_plans FROM PUBLIC, anon, authenticated;

CREATE TABLE public.rttrack_treatment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.rttrack_treatment_plans(id) ON DELETE RESTRICT,
  fraction_number integer NOT NULL CHECK (fraction_number > 0),
  scheduled_for timestamptz NOT NULL,
  location text CHECK (location IS NULL OR char_length(location) <= 160),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','missed')),
  delivered_gy numeric(12,3),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, fraction_number),
  CONSTRAINT rttrack_session_dose_state CHECK (
    (status = 'completed' AND delivered_gy IS NOT NULL AND delivered_gy > 0 AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND delivered_gy IS NULL AND completed_at IS NULL)
  )
);
CREATE INDEX rttrack_sessions_next_idx ON public.rttrack_treatment_sessions(plan_id, scheduled_for);
ALTER TABLE public.rttrack_treatment_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_treatment_sessions FROM PUBLIC, anon, authenticated;

-- Minimal audit metadata; NOT a clinical record or immutable external audit log.
CREATE TABLE public.rttrack_treatment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id),
  plan_id uuid NOT NULL REFERENCES public.rttrack_treatment_plans(id),
  session_id uuid REFERENCES public.rttrack_treatment_sessions(id),
  event_type text NOT NULL CHECK (event_type IN (
    'plan_created','plan_published','fraction_scheduled','fraction_completed','fraction_missed'
  )),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rttrack_treatment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_treatment_events FROM PUBLIC, anon, authenticated;

-- Connection consent from 004 explicitly excluded treatment records. A SEPARATE
-- per-link, patient-controlled opt-in is required before ANY clinician treatment access.
-- Existing links start with NO treatment-data sharing; nothing is backfilled.
CREATE TABLE public.rttrack_treatment_sharing (
  link_id uuid PRIMARY KEY REFERENCES public.rttrack_patient_clinician_links(id) ON DELETE RESTRICT,
  allowed boolean NOT NULL DEFAULT false,
  allowed_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rttrack_share_granted_timestamp CHECK (
    (allowed = true AND allowed_at IS NOT NULL AND revoked_at IS NULL) OR
    (allowed = false AND allowed_at IS NULL)
  )
);
ALTER TABLE public.rttrack_treatment_sharing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_treatment_sharing FROM PUBLIC, anon, authenticated;

CREATE TABLE public.rttrack_treatment_sharing_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES public.rttrack_patient_clinician_links(id),
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id),
  allowed boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rttrack_treatment_sharing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_treatment_sharing_events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.rttrack_set_treatment_sharing(p_link_id uuid, p_allow boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.rttrack_patient_clinician_links%ROWTYPE;
BEGIN
  IF NOT public.rttrack_is_patient() OR p_allow IS NULL THEN
    RAISE EXCEPTION 'Patient authorisation required';
  END IF;
  SELECT * INTO l FROM public.rttrack_patient_clinician_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR l.patient_id<>auth.uid() OR l.status<>'active'
     OR l.patient_consented_at IS NULL OR l.clinician_accepted_at IS NULL THEN
    RAISE EXCEPTION 'An active patient-owned connection is required';
  END IF;
  INSERT INTO public.rttrack_treatment_sharing (link_id,allowed,allowed_at,revoked_at)
  VALUES (l.id,p_allow,CASE WHEN p_allow THEN now() ELSE NULL END,
          CASE WHEN p_allow THEN NULL ELSE now() END)
  ON CONFLICT (link_id) DO UPDATE SET
    allowed=EXCLUDED.allowed, allowed_at=EXCLUDED.allowed_at,
    revoked_at=EXCLUDED.revoked_at, updated_at=now();
  INSERT INTO public.rttrack_treatment_sharing_events(link_id,patient_id,allowed)
  VALUES (l.id,l.patient_id,p_allow);
END;
$$;

CREATE FUNCTION public.rttrack_my_treatment_sharing()
RETURNS TABLE(link_id uuid, allowed boolean, allowed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.rttrack_is_patient() OR public.rttrack_is_approved_clinician())
  THEN RAISE EXCEPTION 'Not authorised'; END IF;
  RETURN QUERY SELECT l.id,coalesce(s.allowed,false),s.allowed_at
    FROM public.rttrack_patient_clinician_links l
    LEFT JOIN public.rttrack_treatment_sharing s ON s.link_id=l.id
    WHERE l.status='active' AND (l.patient_id=auth.uid() OR l.clinician_id=auth.uid())
    ORDER BY l.created_at DESC LIMIT 100;
END;
$$;

-- Only an approved, email-confirmed clinician with a CURRENT ACTIVE, consented
-- connection may discover the patient for plan creation. Administrator role ALONE
-- never grants clinical access.
CREATE FUNCTION public.rttrack_treatment_patients()
RETURNS TABLE(patient_id uuid, full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  RETURN QUERY
    SELECT p.user_id, p.full_name
    FROM public.patient_profiles p
    JOIN public.rttrack_patient_clinician_links l ON l.patient_id = p.user_id
    WHERE l.clinician_id = auth.uid() AND l.status = 'active'
      AND l.patient_consented_at IS NOT NULL AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
    ORDER BY p.full_name, p.user_id LIMIT 100;
END;
$$;

CREATE FUNCTION public.rttrack_create_treatment_plan(
  p_patient_id uuid, p_title text, p_site text, p_technique text,
  p_total_fractions integer, p_prescribed_total_gy numeric,
  p_start_on date DEFAULT NULL, p_end_on date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan uuid;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  IF p_patient_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rttrack_patient_clinician_links l
    WHERE l.patient_id = p_patient_id AND l.clinician_id = auth.uid()
      AND l.status = 'active' AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'An active consented patient connection is required'; END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 120
     OR p_site IS NULL OR char_length(btrim(p_site)) NOT BETWEEN 2 AND 120
     OR p_technique IS NULL OR char_length(btrim(p_technique)) NOT BETWEEN 2 AND 120
     OR p_total_fractions IS NULL OR p_total_fractions NOT BETWEEN 1 AND 1000
     OR p_prescribed_total_gy IS NULL OR p_prescribed_total_gy <= 0
     OR (p_start_on IS NOT NULL AND p_end_on IS NOT NULL AND p_end_on < p_start_on)
  THEN RAISE EXCEPTION 'Enter a valid clinician-specified plan'; END IF;
  INSERT INTO public.rttrack_treatment_plans
    (patient_id, created_by, title, treatment_site, technique, total_fractions,
     prescribed_total_gy, planned_start_on, estimated_end_on)
  VALUES (p_patient_id, auth.uid(), btrim(p_title), btrim(p_site), btrim(p_technique),
          p_total_fractions, p_prescribed_total_gy, p_start_on, p_end_on)
  RETURNING id INTO v_plan;
  INSERT INTO public.rttrack_treatment_events(actor_id, patient_id, plan_id, event_type)
  VALUES(auth.uid(), p_patient_id, v_plan, 'plan_created');
  RETURN v_plan;
END;
$$;

CREATE FUNCTION public.rttrack_publish_treatment_plan(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.rttrack_treatment_plans%ROWTYPE;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  SELECT * INTO p FROM public.rttrack_treatment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR p.created_by <> auth.uid() OR p.status <> 'draft' OR NOT EXISTS (
    SELECT 1 FROM public.rttrack_patient_clinician_links l
    WHERE l.patient_id = p.patient_id AND l.clinician_id = auth.uid()
      AND l.status = 'active' AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Draft plan or active author connection unavailable'; END IF;
  -- A partial unique index prevents two simultaneously active plans for a patient.
  UPDATE public.rttrack_treatment_plans SET status='active', published_at=now() WHERE id=p.id;
  INSERT INTO public.rttrack_treatment_events(actor_id, patient_id, plan_id, event_type)
  VALUES(auth.uid(), p.patient_id, p.id, 'plan_published');
END;
$$;

CREATE FUNCTION public.rttrack_schedule_fraction(
  p_plan_id uuid, p_fraction_number integer, p_scheduled_for timestamptz,
  p_location text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.rttrack_treatment_plans%ROWTYPE; v_session uuid;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  SELECT * INTO p FROM public.rttrack_treatment_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND OR p.created_by <> auth.uid() OR NOT EXISTS (
    SELECT 1 FROM public.rttrack_patient_clinician_links l
    WHERE l.patient_id=p.patient_id AND l.clinician_id=auth.uid()
      AND l.status='active' AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Plan or active author connection unavailable'; END IF;
  IF p_fraction_number IS NULL OR p_fraction_number < 1 OR p_fraction_number > p.total_fractions
     OR p_scheduled_for IS NULL OR (p_location IS NOT NULL AND char_length(btrim(p_location)) > 160)
  THEN RAISE EXCEPTION 'Invalid session number, time or location'; END IF;
  INSERT INTO public.rttrack_treatment_sessions(plan_id,fraction_number,scheduled_for,location)
  VALUES(p.id,p_fraction_number,p_scheduled_for,nullif(btrim(p_location),''))
  RETURNING id INTO v_session;
  INSERT INTO public.rttrack_treatment_events(actor_id,patient_id,plan_id,session_id,event_type)
  VALUES(auth.uid(),p.patient_id,p.id,v_session,'fraction_scheduled');
  RETURN v_session;
END;
$$;

CREATE FUNCTION public.rttrack_complete_fraction(p_session_id uuid, p_delivered_gy numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.rttrack_treatment_sessions%ROWTYPE; p public.rttrack_treatment_plans%ROWTYPE;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  SELECT * INTO s FROM public.rttrack_treatment_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
  SELECT * INTO p FROM public.rttrack_treatment_plans WHERE id=s.plan_id FOR UPDATE;
  IF p.created_by <> auth.uid() OR p.status <> 'active' OR s.status <> 'scheduled'
     OR s.scheduled_for > now() OR p_delivered_gy IS NULL OR p_delivered_gy <= 0
     OR NOT EXISTS (SELECT 1 FROM public.rttrack_patient_clinician_links l
       WHERE l.patient_id=p.patient_id AND l.clinician_id=auth.uid()
         AND l.status='active' AND l.patient_consented_at IS NOT NULL
         AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL))
  THEN RAISE EXCEPTION 'Session cannot be completed by this user'; END IF;
  UPDATE public.rttrack_treatment_sessions
    SET status='completed', delivered_gy=p_delivered_gy, completed_at=now()
    WHERE id=s.id;
  INSERT INTO public.rttrack_treatment_events(actor_id,patient_id,plan_id,session_id,event_type)
  VALUES(auth.uid(),p.patient_id,p.id,s.id,'fraction_completed');
END;
$$;

CREATE FUNCTION public.rttrack_mark_fraction_missed(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.rttrack_treatment_sessions%ROWTYPE; p public.rttrack_treatment_plans%ROWTYPE;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  SELECT * INTO s FROM public.rttrack_treatment_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable'; END IF;
  SELECT * INTO p FROM public.rttrack_treatment_plans WHERE id=s.plan_id FOR UPDATE;
  IF p.created_by <> auth.uid() OR p.status <> 'active' OR s.status <> 'scheduled'
     OR s.scheduled_for > now() OR NOT EXISTS (
       SELECT 1 FROM public.rttrack_patient_clinician_links l
       WHERE l.patient_id=p.patient_id AND l.clinician_id=auth.uid()
         AND l.status='active' AND l.patient_consented_at IS NOT NULL
         AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL))
  THEN RAISE EXCEPTION 'Session cannot be marked missed by this user'; END IF;
  UPDATE public.rttrack_treatment_sessions SET status='missed' WHERE id=s.id;
  INSERT INTO public.rttrack_treatment_events(actor_id,patient_id,plan_id,session_id,event_type)
  VALUES(auth.uid(),p.patient_id,p.id,s.id,'fraction_missed');
END;
$$;

-- List is caller-scoped. A patient sees ONLY their PUBLISHED plans;
-- a clinician sees active plans for currently connected patients and only OWN drafts.
CREATE FUNCTION public.rttrack_list_treatment_plans()
RETURNS TABLE(
  plan_id uuid, patient_id uuid, patient_name text, created_by uuid, clinician_name text,
  title text, treatment_site text, technique text, total_fractions integer,
  prescribed_total_gy numeric, planned_start_on date, estimated_end_on date,
  status text, completed_fractions bigint, missed_fractions bigint,
  delivered_total_gy numeric, next_session_at timestamptz, next_session_location text,
  next_fraction_number integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.rttrack_is_patient() OR public.rttrack_is_approved_clinician())
  THEN RAISE EXCEPTION 'Not authorised'; END IF;
  RETURN QUERY
    SELECT p.id, p.patient_id, pat.full_name, p.created_by, c.full_name,
      p.title, p.treatment_site, p.technique, p.total_fractions,
      p.prescribed_total_gy, p.planned_start_on, p.estimated_end_on,
      p.status, stats.done, stats.missed, stats.delivered,
      upcoming.scheduled_for, upcoming.location, upcoming.fraction_number
    FROM public.rttrack_treatment_plans p
    JOIN public.patient_profiles pat ON pat.user_id=p.patient_id
    JOIN public.clinician_applications c ON c.user_id=p.created_by
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE s.status='completed') AS done,
             count(*) FILTER (WHERE s.status='missed') AS missed,
             coalesce(sum(s.delivered_gy) FILTER (WHERE s.status='completed'),0)::numeric AS delivered
      FROM public.rttrack_treatment_sessions s WHERE s.plan_id=p.id
    ) stats ON true
    LEFT JOIN LATERAL (
      SELECT s.scheduled_for,s.location,s.fraction_number
      FROM public.rttrack_treatment_sessions s
      WHERE s.plan_id=p.id AND s.status='scheduled' AND s.scheduled_for>=now()
      ORDER BY s.scheduled_for,s.fraction_number LIMIT 1
    ) upcoming ON true
    WHERE (p.patient_id=auth.uid() AND p.status='active' AND public.rttrack_is_patient())
       OR (public.rttrack_is_approved_clinician() AND (p.status='active' OR p.created_by=auth.uid()) AND EXISTS (
          SELECT 1 FROM public.rttrack_patient_clinician_links l
          WHERE l.patient_id=p.patient_id AND l.clinician_id=auth.uid()
            AND l.status='active' AND l.patient_consented_at IS NOT NULL
            AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
       ))
    ORDER BY p.created_at DESC LIMIT 100;
END;
$$;

CREATE FUNCTION public.rttrack_list_treatment_sessions(p_plan_id uuid)
RETURNS TABLE(
  session_id uuid, fraction_number integer, scheduled_for timestamptz,
  location text, status text, delivered_gy numeric, completed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rttrack_treatment_plans p
    WHERE p.id=p_plan_id AND (
      (p.patient_id=auth.uid() AND p.status='active' AND public.rttrack_is_patient())
      OR (public.rttrack_is_approved_clinician() AND (p.status='active' OR p.created_by=auth.uid()) AND EXISTS (
        SELECT 1 FROM public.rttrack_patient_clinician_links l
        WHERE l.patient_id=p.patient_id AND l.clinician_id=auth.uid()
          AND l.status='active' AND l.patient_consented_at IS NOT NULL
          AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
      ))
    )
  ) THEN RAISE EXCEPTION 'Plan unavailable'; END IF;
  RETURN QUERY SELECT s.id,s.fraction_number,s.scheduled_for,s.location,s.status,
                      s.delivered_gy,s.completed_at
    FROM public.rttrack_treatment_sessions s
    WHERE s.plan_id=p_plan_id ORDER BY s.fraction_number LIMIT 1000;
END;
$$;

-- Deliberately NO table grants or RLS read policies for browser access.
-- The ONLY browser entry points are these explicitly checked RPCs.
REVOKE ALL ON FUNCTION
  public.rttrack_set_treatment_sharing(uuid,boolean),
  public.rttrack_my_treatment_sharing(),
  public.rttrack_treatment_patients(),
  public.rttrack_create_treatment_plan(uuid,text,text,text,integer,numeric,date,date),
  public.rttrack_publish_treatment_plan(uuid),
  public.rttrack_schedule_fraction(uuid,integer,timestamptz,text),
  public.rttrack_complete_fraction(uuid,numeric),
  public.rttrack_mark_fraction_missed(uuid),
  public.rttrack_list_treatment_plans(),
  public.rttrack_list_treatment_sessions(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.rttrack_set_treatment_sharing(uuid,boolean),
  public.rttrack_my_treatment_sharing(),
  public.rttrack_treatment_patients(),
  public.rttrack_create_treatment_plan(uuid,text,text,text,integer,numeric,date,date),
  public.rttrack_publish_treatment_plan(uuid),
  public.rttrack_schedule_fraction(uuid,integer,timestamptz,text),
  public.rttrack_complete_fraction(uuid,numeric),
  public.rttrack_mark_fraction_missed(uuid),
  public.rttrack_list_treatment_plans(),
  public.rttrack_list_treatment_sessions(uuid)
TO authenticated;
COMMIT;
