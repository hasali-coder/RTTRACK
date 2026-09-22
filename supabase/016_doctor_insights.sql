-- RTTRACK migration 016: permission-scoped descriptive Doctor Insights.
-- Apply once AFTER the existing treatment and symptom migrations. No patient data is modified.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.rttrack_is_approved_clinician()') IS NULL
     OR to_regclass('public.rttrack_patient_clinician_links') IS NULL
     OR to_regclass('public.rttrack_treatment_plans') IS NULL
     OR to_regclass('public.rttrack_treatment_sessions') IS NULL
     OR to_regclass('public.rttrack_treatment_sharing') IS NULL
     OR to_regclass('public.rttrack_symptom_entries') IS NULL
     OR to_regclass('public.rttrack_symptom_sharing') IS NULL
  THEN
    RAISE EXCEPTION 'Required earlier RTTRACK migrations are missing. Stop and inspect migrations 004, 005, 008 and 010.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rttrack_doctor_insight_filters()
RETURNS TABLE(
  patient_id uuid,
  patient_name text,
  plan_id uuid,
  plan_title text,
  plan_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN
    RAISE EXCEPTION 'Approved doctor required' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT l.id,l.patient_id
    FROM public.rttrack_patient_clinician_links l
    WHERE l.clinician_id=auth.uid()
      AND l.status='active'
      AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL
  ),
  treatment_links AS (
    SELECT l.id,l.patient_id
    FROM links l
    JOIN public.rttrack_treatment_sharing sh ON sh.link_id=l.id
    WHERE sh.allowed AND sh.allowed_at IS NOT NULL
  ),
  symptom_links AS (
    SELECT l.id,l.patient_id
    FROM links l
    JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
    WHERE sh.allowed AND sh.allowed_at IS NOT NULL
  )
  SELECT DISTINCT p.user_id,p.full_name,tp.id,tp.title,tp.status
  FROM public.patient_profiles p
  JOIN links l ON l.patient_id=p.user_id
  LEFT JOIN treatment_links tl ON tl.patient_id=p.user_id
  LEFT JOIN public.rttrack_treatment_plans tp
    ON tp.patient_id=p.user_id
   AND tl.patient_id IS NOT NULL
   AND (tp.status<>'draft' OR tp.created_by=auth.uid())
  WHERE tl.patient_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM symptom_links sl WHERE sl.patient_id=p.user_id)
  ORDER BY p.full_name,tp.title NULLS LAST,p.user_id,tp.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rttrack_doctor_insight_summary(
  p_patient_id uuid DEFAULT NULL,
  p_plan_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE(
  connected_patients bigint,
  active_plans bigint,
  total_plans bigint,
  completed_fractions bigint,
  missed_fractions bigint,
  upcoming_fractions bigint,
  symptom_entries bigint,
  unacknowledged_symptoms bigint,
  prescribed_fractions bigint,
  completion_percent numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, now() - interval '30 days');
  v_to timestamptz := COALESCE(p_to, now());
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN
    RAISE EXCEPTION 'Approved doctor required' USING ERRCODE='42501';
  END IF;
  IF v_to < v_from OR v_to - v_from > interval '180 days' THEN
    RAISE EXCEPTION 'Insight period must be between 0 and 180 days' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT l.id,l.patient_id
    FROM public.rttrack_patient_clinician_links l
    WHERE l.clinician_id=auth.uid()
      AND l.status='active'
      AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL
  ),
  treatment_links AS (
    SELECT l.id,l.patient_id
    FROM links l
    JOIN public.rttrack_treatment_sharing sh ON sh.link_id=l.id
    WHERE sh.allowed AND sh.allowed_at IS NOT NULL
  ),
  accessible_plans AS (
    SELECT tp.*
    FROM public.rttrack_treatment_plans tp
    JOIN treatment_links tl ON tl.patient_id=tp.patient_id
    WHERE (tp.status<>'draft' OR tp.created_by=auth.uid())
  ),
  selected_plans AS (
    SELECT ap.*
    FROM accessible_plans ap
    WHERE (p_patient_id IS NULL OR ap.patient_id=p_patient_id)
      AND (p_plan_id IS NULL OR ap.id=p_plan_id)
  ),
  selected_link_patients AS (
    SELECT DISTINCT l.patient_id
    FROM links l
    WHERE (p_patient_id IS NULL OR l.patient_id=p_patient_id)
      AND (p_plan_id IS NULL OR EXISTS (
        SELECT 1 FROM selected_plans sp WHERE sp.patient_id=l.patient_id
      ))
  ),
  period_sessions AS (
    SELECT s.*
    FROM public.rttrack_treatment_sessions s
    JOIN selected_plans sp ON sp.id=s.plan_id
    WHERE s.scheduled_for >= v_from AND s.scheduled_for <= v_to
  ),
  all_plan_sessions AS (
    SELECT s.*
    FROM public.rttrack_treatment_sessions s
    JOIN selected_plans sp ON sp.id=s.plan_id
  ),
  symptom_patients AS (
    SELECT l.patient_id
    FROM links l
    JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
    WHERE sh.allowed AND sh.allowed_at IS NOT NULL
      AND (p_patient_id IS NULL OR l.patient_id=p_patient_id)
      AND (p_plan_id IS NULL OR EXISTS (
        SELECT 1 FROM selected_plans sp WHERE sp.patient_id=l.patient_id
      ))
  ),
  selected_symptoms AS (
    SELECT e.*
    FROM public.rttrack_symptom_entries e
    JOIN symptom_patients sp ON sp.patient_id=e.patient_id
    WHERE e.onset_at >= v_from AND e.onset_at <= v_to
  ),
  progress AS (
    SELECT
      COALESCE((SELECT sum(sp.total_fractions)::bigint FROM selected_plans sp),0)::bigint AS prescribed,
      COALESCE((SELECT count(*)::bigint FROM all_plan_sessions s WHERE s.status='completed'),0)::bigint AS completed
  )
  SELECT
    (SELECT count(*)::bigint FROM selected_link_patients),
    (SELECT count(*)::bigint FROM selected_plans WHERE status='active'),
    (SELECT count(*)::bigint FROM selected_plans),
    (SELECT count(*)::bigint FROM period_sessions WHERE status='completed'),
    (SELECT count(*)::bigint FROM period_sessions WHERE status='missed'),
    (SELECT count(*)::bigint FROM all_plan_sessions s
      JOIN selected_plans sp ON sp.id=s.plan_id
      WHERE sp.status='active' AND s.status='scheduled' AND s.scheduled_for>=now()),
    (SELECT count(*)::bigint FROM selected_symptoms),
    (SELECT count(*)::bigint FROM selected_symptoms WHERE reviewed_at IS NULL),
    progress.prescribed,
    CASE WHEN progress.prescribed=0 THEN 0::numeric
      ELSE round((progress.completed::numeric * 100.0) / progress.prescribed::numeric,1) END
  FROM progress;
END;
$$;

CREATE OR REPLACE FUNCTION public.rttrack_doctor_insight_trend(
  p_patient_id uuid DEFAULT NULL,
  p_plan_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE(
  day date,
  completed_fractions bigint,
  missed_fractions bigint,
  symptom_entries bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, now() - interval '30 days');
  v_to timestamptz := COALESCE(p_to, now());
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN
    RAISE EXCEPTION 'Approved doctor required' USING ERRCODE='42501';
  END IF;
  IF v_to < v_from OR v_to - v_from > interval '180 days' THEN
    RAISE EXCEPTION 'Insight period must be between 0 and 180 days' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT l.id,l.patient_id
    FROM public.rttrack_patient_clinician_links l
    WHERE l.clinician_id=auth.uid()
      AND l.status='active'
      AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL
  ),
  treatment_links AS (
    SELECT l.id,l.patient_id
    FROM links l
    JOIN public.rttrack_treatment_sharing sh ON sh.link_id=l.id
    WHERE sh.allowed AND sh.allowed_at IS NOT NULL
  ),
  selected_plans AS (
    SELECT tp.*
    FROM public.rttrack_treatment_plans tp
    JOIN treatment_links tl ON tl.patient_id=tp.patient_id
    WHERE (tp.status<>'draft' OR tp.created_by=auth.uid())
      AND (p_patient_id IS NULL OR tp.patient_id=p_patient_id)
      AND (p_plan_id IS NULL OR tp.id=p_plan_id)
  ),
  symptom_patients AS (
    SELECT l.patient_id
    FROM links l
    JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
    WHERE sh.allowed AND sh.allowed_at IS NOT NULL
      AND (p_patient_id IS NULL OR l.patient_id=p_patient_id)
      AND (p_plan_id IS NULL OR EXISTS (
        SELECT 1 FROM selected_plans sp WHERE sp.patient_id=l.patient_id
      ))
  ),
  days AS (
    SELECT generate_series(v_from::date,v_to::date,interval '1 day')::date AS day
  )
  SELECT d.day,
    (SELECT count(*)::bigint
      FROM public.rttrack_treatment_sessions s
      JOIN selected_plans sp ON sp.id=s.plan_id
      WHERE s.status='completed'
        AND COALESCE(s.completed_at,s.scheduled_for)::date=d.day),
    (SELECT count(*)::bigint
      FROM public.rttrack_treatment_sessions s
      JOIN selected_plans sp ON sp.id=s.plan_id
      WHERE s.status='missed' AND s.scheduled_for::date=d.day),
    (SELECT count(*)::bigint
      FROM public.rttrack_symptom_entries e
      JOIN symptom_patients sp ON sp.patient_id=e.patient_id
      WHERE e.onset_at::date=d.day)
  FROM days d
  ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.rttrack_doctor_insight_filters() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_doctor_insight_summary(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_doctor_insight_trend(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_doctor_insight_filters() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_doctor_insight_summary(uuid,uuid,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_doctor_insight_trend(uuid,uuid,timestamptz,timestamptz) TO authenticated;

COMMIT;
