-- RTTRACK Migration 010: treatment-plan lifecycle for FICTIONAL TEST DATA ONLY.
-- Apply ONCE after 005 and 006, on your EXISTING DEVELOPMENT Supabase project.
-- Never rerun old migrations. No patient, plan or session data is deleted.
-- Existing active-plan unique index is deliberately retained.
BEGIN;

-- Fail early rather than partly install against an unexpected schema.
DO $$ BEGIN
  IF to_regclass('public.rttrack_treatment_plans') IS NULL
    OR to_regclass('public.rttrack_treatment_sessions') IS NULL
    OR to_regclass('public.rttrack_treatment_events') IS NULL
    OR to_regclass('public.rttrack_patient_clinician_links') IS NULL
    OR to_regclass('public.rttrack_treatment_sharing') IS NULL
  THEN RAISE EXCEPTION 'Missing earlier treatment/connection migration. Stop; inspect 004-006.';
  END IF;
END $$;

ALTER TABLE public.rttrack_treatment_plans
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN closure_reason text,
  ADD COLUMN superseded_by uuid REFERENCES public.rttrack_treatment_plans(id) ON DELETE RESTRICT;

ALTER TABLE public.rttrack_treatment_plans
  DROP CONSTRAINT rttrack_treatment_plans_status_check,
  DROP CONSTRAINT rttrack_published_plan_timestamp;
ALTER TABLE public.rttrack_treatment_plans
  ADD CONSTRAINT rttrack_treatment_plans_status_check
    CHECK (status IN ('draft','active','completed','discontinued','superseded')),
  ADD CONSTRAINT rttrack_published_plan_timestamp CHECK (
    (status='draft' AND published_at IS NULL AND closed_at IS NULL
      AND closed_by IS NULL AND closure_reason IS NULL AND superseded_by IS NULL)
    OR (status='active' AND published_at IS NOT NULL AND closed_at IS NULL
      AND closed_by IS NULL AND closure_reason IS NULL AND superseded_by IS NULL)
    OR (status IN ('completed','discontinued','superseded') AND published_at IS NOT NULL
      AND closed_at IS NOT NULL AND closed_by IS NOT NULL
      AND closure_reason IS NOT NULL AND char_length(btrim(closure_reason)) BETWEEN 10 AND 1000
      AND ((status='superseded' AND superseded_by IS NOT NULL)
        OR (status<>'superseded' AND superseded_by IS NULL)))
  ),
  ADD CONSTRAINT rttrack_no_self_supersession CHECK (superseded_by IS NULL OR superseded_by <> id);

-- Retain previous events. Add contextual metadata; never overwrite historical events.
ALTER TABLE public.rttrack_treatment_events
  ADD COLUMN reason text,
  ADD COLUMN related_plan_id uuid REFERENCES public.rttrack_treatment_plans(id) ON DELETE RESTRICT;
ALTER TABLE public.rttrack_treatment_events
  DROP CONSTRAINT rttrack_treatment_events_event_type_check;
ALTER TABLE public.rttrack_treatment_events
  ADD CONSTRAINT rttrack_treatment_events_event_type_check CHECK (event_type IN (
    'plan_created','plan_published','fraction_scheduled','fraction_completed','fraction_missed',
    'plan_completed','plan_discontinued','plan_superseded'
  ));

-- A closure and any linked event are committed in one database transaction.
-- Only the AUTHOR of an active plan, with a currently approved clinician account
-- and a CURRENT patient connection with separate treatment-record consent, can close it.
CREATE FUNCTION public.rttrack_close_treatment_plan(
  p_plan_id uuid, p_outcome text, p_reason text, p_confirm text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan public.rttrack_treatment_plans%ROWTYPE; v_reason text;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed','discontinued')
     OR p_confirm IS DISTINCT FROM 'CLOSE PLAN' THEN
    RAISE EXCEPTION 'Select completed or discontinued and explicitly confirm CLOSE PLAN';
  END IF;
  v_reason := btrim(coalesce(p_reason,''));
  IF char_length(v_reason) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Enter a closure reason of 10 to 1000 characters';
  END IF;
  -- Serialize lifecycle operations for this patient's plans.
  SELECT * INTO v_plan FROM public.rttrack_treatment_plans WHERE id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Treatment plan unavailable'; END IF;
  PERFORM 1 FROM public.patient_profiles WHERE user_id=v_plan.patient_id FOR UPDATE;
  SELECT * INTO v_plan FROM public.rttrack_treatment_plans WHERE id=p_plan_id FOR UPDATE;
  IF v_plan.status <> 'active' OR v_plan.created_by <> auth.uid()
     OR NOT EXISTS (
       SELECT 1 FROM public.rttrack_patient_clinician_links l
       JOIN public.rttrack_treatment_sharing sh ON sh.link_id=l.id
       WHERE l.patient_id=v_plan.patient_id AND l.clinician_id=auth.uid()
         AND l.status='active' AND l.patient_consented_at IS NOT NULL
         AND l.clinician_accepted_at IS NOT NULL AND sh.allowed AND sh.allowed_at IS NOT NULL
     ) THEN RAISE EXCEPTION 'Active plan author and patient treatment consent required'; END IF;
  UPDATE public.rttrack_treatment_plans SET
    status=p_outcome, closed_at=now(), closed_by=auth.uid(), closure_reason=v_reason
    WHERE id=v_plan.id;
  INSERT INTO public.rttrack_treatment_events(actor_id,patient_id,plan_id,event_type,reason)
    VALUES (auth.uid(),v_plan.patient_id,v_plan.id,
      CASE WHEN p_outcome='completed' THEN 'plan_completed' ELSE 'plan_discontinued' END,v_reason);
END;
$$;

-- Atomic supersession: old plan closed AND new draft published together, or neither.
-- Do not automatically declare the old plan completed, change delivered doses,
-- or erase scheduled sessions. Closed-plan appointments are excluded from upcoming lists.
CREATE FUNCTION public.rttrack_supersede_treatment_plan(
  p_old_plan_id uuid, p_new_plan_id uuid, p_reason text, p_confirm text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old public.rttrack_treatment_plans%ROWTYPE;
        v_new public.rttrack_treatment_plans%ROWTYPE; v_reason text;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  IF p_confirm IS DISTINCT FROM 'SUPERSEDE' OR p_old_plan_id IS NULL
     OR p_new_plan_id IS NULL OR p_old_plan_id=p_new_plan_id THEN
    RAISE EXCEPTION 'Select two distinct plans and explicitly confirm SUPERSEDE'; END IF;
  v_reason := btrim(coalesce(p_reason,''));
  IF char_length(v_reason) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Enter a supersession reason of 10 to 1000 characters'; END IF;
  SELECT * INTO v_old FROM public.rttrack_treatment_plans WHERE id=p_old_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active plan unavailable'; END IF;
  PERFORM 1 FROM public.patient_profiles WHERE user_id=v_old.patient_id FOR UPDATE;
  SELECT * INTO v_old FROM public.rttrack_treatment_plans WHERE id=p_old_plan_id FOR UPDATE;
  SELECT * INTO v_new FROM public.rttrack_treatment_plans WHERE id=p_new_plan_id FOR UPDATE;
  IF NOT FOUND OR v_old.status<>'active' OR v_new.status<>'draft'
    OR v_new.patient_id<>v_old.patient_id
    OR v_old.created_by<>auth.uid() OR v_new.created_by<>auth.uid()
    OR NOT EXISTS (
      SELECT 1 FROM public.rttrack_patient_clinician_links l
      JOIN public.rttrack_treatment_sharing sh ON sh.link_id=l.id
      WHERE l.patient_id=v_old.patient_id AND l.clinician_id=auth.uid()
        AND l.status='active' AND l.patient_consented_at IS NOT NULL
        AND l.clinician_accepted_at IS NOT NULL AND sh.allowed AND sh.allowed_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'Both plans must belong to the same patient and author; active consent required'; END IF;
  UPDATE public.rttrack_treatment_plans
    SET status='superseded',closed_at=now(),closed_by=auth.uid(),
        closure_reason=v_reason,superseded_by=v_new.id
    WHERE id=v_old.id;
  UPDATE public.rttrack_treatment_plans
    SET status='active',published_at=now() WHERE id=v_new.id;
  INSERT INTO public.rttrack_treatment_events(actor_id,patient_id,plan_id,event_type,reason,related_plan_id)
    VALUES(auth.uid(),v_old.patient_id,v_old.id,'plan_superseded',v_reason,v_new.id);
  INSERT INTO public.rttrack_treatment_events(actor_id,patient_id,plan_id,event_type,reason,related_plan_id)
    VALUES(auth.uid(),v_new.patient_id,v_new.id,'plan_published',v_reason,v_old.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rttrack_schedule_fraction(
  p_plan_id uuid, p_fraction_number integer, p_scheduled_for timestamptz,
  p_location text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.rttrack_treatment_plans%ROWTYPE; v_session uuid;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required'; END IF;
  SELECT * INTO p FROM public.rttrack_treatment_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND OR p.created_by <> auth.uid() OR p.status NOT IN ('draft','active') OR NOT EXISTS (
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

CREATE OR REPLACE FUNCTION public.rttrack_list_treatment_plans()
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
      WHERE s.plan_id=p.id AND p.status='active' AND s.status='scheduled' AND s.scheduled_for>=now()
      ORDER BY s.scheduled_for,s.fraction_number LIMIT 1
    ) upcoming ON true
    WHERE (p.patient_id=auth.uid() AND p.status<>'draft' AND p.published_at IS NOT NULL AND public.rttrack_is_patient())
       OR (public.rttrack_is_approved_clinician() AND (p.status<>'draft' OR p.created_by=auth.uid()) AND EXISTS (
          SELECT 1 FROM public.rttrack_patient_clinician_links l
          WHERE l.patient_id=p.patient_id AND l.clinician_id=auth.uid()
            AND l.status='active' AND l.patient_consented_at IS NOT NULL
            AND l.clinician_accepted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.rttrack_treatment_sharing sh WHERE sh.link_id=l.id AND sh.allowed AND sh.allowed_at IS NOT NULL)
       ))
    ORDER BY p.created_at DESC LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.rttrack_list_treatment_sessions(p_plan_id uuid)
RETURNS TABLE(
  session_id uuid, fraction_number integer, scheduled_for timestamptz,
  location text, status text, delivered_gy numeric, completed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rttrack_treatment_plans p
    WHERE p.id=p_plan_id AND (
      (p.patient_id=auth.uid() AND p.status<>'draft' AND p.published_at IS NOT NULL AND public.rttrack_is_patient())
      OR (public.rttrack_is_approved_clinician() AND (p.status<>'draft' OR p.created_by=auth.uid()) AND EXISTS (
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


-- Browser has no direct table grants. Only checked, authenticated RPCs may execute.
REVOKE ALL ON FUNCTION
 public.rttrack_close_treatment_plan(uuid,text,text,text),
 public.rttrack_supersede_treatment_plan(uuid,uuid,text,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
 public.rttrack_close_treatment_plan(uuid,text,text,text),
 public.rttrack_supersede_treatment_plan(uuid,uuid,text,text)
TO authenticated;
COMMIT;
-- After success run separately: NOTIFY pgrst, 'reload schema';
