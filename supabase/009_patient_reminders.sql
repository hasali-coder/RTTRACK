-- RTTRACK M05A: patient-owned, one-time personal care reminders. Fictional development data only.
-- No email/SMS delivery or clinical alerting is performed by this migration.
-- Requires migrations 001-008. Run ONCE in the existing development project.
BEGIN;
CREATE TABLE public.rttrack_personal_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT rttrack_reminder_state CHECK (
    (status='pending' AND finished_at IS NULL) OR
    (status<>'pending' AND finished_at IS NOT NULL)
  )
);
CREATE INDEX rttrack_personal_reminders_patient_due_idx ON public.rttrack_personal_reminders(patient_id,due_at);
ALTER TABLE public.rttrack_personal_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_personal_reminders FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.rttrack_create_personal_reminder(p_title text,p_due_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_title text:=btrim(coalesce(p_title,'')); v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rttrack_is_patient() THEN
    RAISE EXCEPTION 'Confirmed patient account required' USING ERRCODE='42501'; END IF;
  IF char_length(v_title) NOT BETWEEN 2 AND 100 OR p_due_at IS NULL
    OR p_due_at < now() - interval '1 minute' OR p_due_at > now() + interval '1 year'
  THEN RAISE EXCEPTION 'Enter a title of 2–100 characters and a future time within one year' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.rttrack_personal_reminders r WHERE r.patient_id=auth.uid() AND r.status='pending') >= 100
  THEN RAISE EXCEPTION 'Maximum of 100 pending reminders reached' USING ERRCODE='22023'; END IF;
  INSERT INTO public.rttrack_personal_reminders(patient_id,title,due_at)
    VALUES(auth.uid(),v_title,p_due_at) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.rttrack_list_personal_reminders()
RETURNS TABLE(reminder_id uuid,title text,due_at timestamptz,status text,created_at timestamptz,finished_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.rttrack_is_patient() THEN
    RAISE EXCEPTION 'Confirmed patient account required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.id,r.title,r.due_at,r.status,r.created_at,r.finished_at
    FROM public.rttrack_personal_reminders r
    WHERE r.patient_id=auth.uid() ORDER BY r.due_at DESC,r.created_at DESC LIMIT 200;
END; $$;

CREATE FUNCTION public.rttrack_set_personal_reminder_status(p_reminder_id uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rttrack_is_patient() THEN
    RAISE EXCEPTION 'Confirmed patient account required' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('done','cancelled') THEN
    RAISE EXCEPTION 'Invalid reminder status' USING ERRCODE='22023'; END IF;
  UPDATE public.rttrack_personal_reminders r SET status=p_status,finished_at=now()
    WHERE r.id=p_reminder_id AND r.patient_id=auth.uid() AND r.status='pending'
    RETURNING r.id INTO v_id;
  RETURN v_id IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION public.rttrack_create_personal_reminder(text,timestamptz),
 public.rttrack_list_personal_reminders(),
 public.rttrack_set_personal_reminder_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_create_personal_reminder(text,timestamptz),
 public.rttrack_list_personal_reminders(),
 public.rttrack_set_personal_reminder_status(uuid,text) TO authenticated;
COMMIT;
