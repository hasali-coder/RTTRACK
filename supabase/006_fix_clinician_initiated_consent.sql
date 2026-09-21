-- RTTRACK migration 006: correct clinician-initiated link acceptance.
-- Development project and fictional accounts only. Run ONCE after 004 (and 005 if installed).
-- No changes to treatment plans, patient data, auth configuration, or the frontend.
-- A clinician's request constitutes their acceptance of the proposed care relationship;
-- the patient must STILL explicitly consent before a link becomes active.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.rttrack_patient_clinician_links') IS NULL
     OR to_regclass('public.clinician_applications') IS NULL
     OR to_regclass('public.patient_profiles') IS NULL
     OR to_regprocedure('public.rttrack_clinician_request_patient(text)') IS NULL
  THEN
    RAISE EXCEPTION 'RTTRACK migration 004 is missing or incomplete. Stop; do not run older migrations again.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.rttrack_patient_clinician_links'::regclass
      AND conname = 'rttrack_active_requires_both'
  ) THEN
    RAISE EXCEPTION 'The expected RTTRACK consent constraint was not found. Stop and review the schema.';
  END IF;
END;
$preflight$;

-- Fix EXISTING clinician-initiated pending requests. The clinician's original
-- created_at records when they initiated (and thereby accepted) the request.
-- Patient consent remains NULL until that patient actively accepts in RTTRACK.
-- Do not touch patient-initiated, declined, revoked, or already-active links.
UPDATE public.rttrack_patient_clinician_links
SET clinician_accepted_at = created_at
WHERE status = 'pending'
  AND initiated_by = clinician_id
  AND clinician_accepted_at IS NULL;

-- Fix NEW clinician-initiated requests. Preserve the existing identity checks,
-- confirmed-email requirement, rate limit, and no-account-enumeration behavior.
CREATE OR REPLACE FUNCTION public.rttrack_clinician_request_patient(p_patient_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_patient uuid;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN
    RAISE EXCEPTION 'Approved clinician required';
  END IF;
  IF p_patient_email IS NULL OR length(btrim(p_patient_email)) NOT BETWEEN 5 AND 254 THEN
    RAISE EXCEPTION 'Enter a valid patient email';
  END IF;
  IF (
    SELECT count(*) FROM public.rttrack_patient_clinician_links l
    WHERE l.clinician_id = auth.uid()
      AND l.initiated_by = auth.uid()
      AND l.created_at > now() - interval '1 hour'
  ) >= 10 THEN
    RAISE EXCEPTION 'Request limit reached. Try again later';
  END IF;
  SELECT p.user_id INTO v_patient
  FROM public.patient_profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE lower(u.email) = lower(btrim(p_patient_email))
    AND u.email_confirmed_at IS NOT NULL;

  IF v_patient IS NULL THEN RETURN; END IF;
  INSERT INTO public.rttrack_patient_clinician_links
    (patient_id, clinician_id, initiated_by, clinician_accepted_at)
  VALUES (v_patient, auth.uid(), auth.uid(), now())
  ON CONFLICT DO NOTHING;
END;
$function$;

-- Keep RPC access limited to signed-in users. All authorization checks remain
-- inside the SECURITY DEFINER function; direct table writes remain revoked.
REVOKE ALL ON FUNCTION public.rttrack_clinician_request_patient(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_clinician_request_patient(text)
  TO authenticated;

COMMIT;
