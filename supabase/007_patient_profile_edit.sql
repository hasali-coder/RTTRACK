-- RTTRACK Milestone 03D: self-service patient name + mobile edits.
-- Apply once AFTER 003_patient_accounts.sql, using the trusted SQL Editor in a DEVELOPMENT project.
-- No change to existing clinician/admin permissions or treatment-record tables.
BEGIN;
ALTER TABLE public.patient_profiles
  ADD COLUMN IF NOT EXISTS mobile_number text;
-- NULL = not supplied. Mobile numbers use E.164 (+ followed by 8-15 digits).
ALTER TABLE public.patient_profiles
  ADD CONSTRAINT rttrack_mobile_e164_check
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9][0-9]{7,14}$');

CREATE FUNCTION public.rttrack_update_patient_profile(p_full_name text, p_mobile_number text)
RETURNS TABLE(full_name text, mobile_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := btrim(coalesce(p_full_name, ''));
  v_mobile text := nullif(btrim(coalesce(p_mobile_number, '')), '');
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Name must contain 2 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF v_mobile IS NOT NULL AND v_mobile !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Use international mobile number format, e.g. +254712345678' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    UPDATE public.patient_profiles AS p
    SET full_name = v_name, mobile_number = v_mobile
    WHERE p.user_id = (SELECT auth.uid())
    RETURNING p.full_name, p.mobile_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient profile not found' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.rttrack_update_patient_profile(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rttrack_update_patient_profile(text,text) TO authenticated;
-- Do not grant direct UPDATE on patient_profiles. All edits use the scoped RPC.
COMMIT;
