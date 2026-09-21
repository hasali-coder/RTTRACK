-- RTTRACK M05B1: patient-controlled notification preferences only.
-- NO EMAILS OR SMS ARE SENT BY THIS MIGRATION.
-- Requires migration 009. Development project with fictional data only.
BEGIN;

CREATE TABLE public.rttrack_notification_preferences (
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  notification_type text NOT NULL CHECK (notification_type IN ('personal_reminder', 'appointment')),
  enabled boolean NOT NULL DEFAULT false,
  opted_in_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, channel, notification_type),
  CONSTRAINT rttrack_notification_opt_in_state CHECK (
    (enabled = true AND opted_in_at IS NOT NULL)
    OR (enabled = false AND opted_in_at IS NULL)
  )
);

ALTER TABLE public.rttrack_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_notification_preferences FROM PUBLIC, anon, authenticated;

-- Returns only the signed-in patient's EMAIL preferences.
-- Missing rows mean opt-in is OFF.
CREATE FUNCTION public.rttrack_list_email_preferences()
RETURNS TABLE(notification_type text, enabled boolean, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.rttrack_is_patient() THEN
    RAISE EXCEPTION 'Confirmed patient account required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT n.notification_type, n.enabled, n.updated_at
      FROM public.rttrack_notification_preferences n
     WHERE n.patient_id = auth.uid() AND n.channel = 'email'
     ORDER BY n.notification_type;
END;
$$;

-- SMS remains disabled: no public RPC can opt in to SMS in this milestone.
-- Opting into an email preference DOES NOT send or schedule any messages.
CREATE FUNCTION public.rttrack_set_email_preference(p_notification_type text, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.rttrack_is_patient() THEN
    RAISE EXCEPTION 'Confirmed patient account required' USING ERRCODE = '42501';
  END IF;
  IF p_notification_type IS NULL OR p_notification_type NOT IN ('personal_reminder', 'appointment')
    OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Invalid preference' USING ERRCODE = '22023';
  END IF;
  IF p_enabled AND NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Email confirmation required before opting in' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.rttrack_notification_preferences
      (patient_id, channel, notification_type, enabled, opted_in_at, updated_at)
  VALUES (auth.uid(), 'email', p_notification_type, p_enabled,
          CASE WHEN p_enabled THEN now() ELSE NULL END, now())
  ON CONFLICT (patient_id, channel, notification_type) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        opted_in_at = CASE WHEN EXCLUDED.enabled THEN
          COALESCE(public.rttrack_notification_preferences.opted_in_at, now()) ELSE NULL END,
        updated_at = now();
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.rttrack_list_email_preferences(),
  public.rttrack_set_email_preference(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_list_email_preferences(),
  public.rttrack_set_email_preference(text, boolean) TO authenticated;
COMMIT;
