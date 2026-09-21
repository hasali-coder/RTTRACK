-- RTTRACK M05B2: server-only, opt-in email delivery queue for DEVELOPMENT WITH FICTIONAL DATA.
-- Requires 009, 010 and 011. DOES NOT send mail on its own: deploy/schedule the Edge Function.
-- Never put SMTP credentials, patient names, titles, appointment details or treatment data in email.
BEGIN;

CREATE TABLE public.rttrack_email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id) ON DELETE RESTRICT,
  notification_type text NOT NULL CHECK (notification_type IN ('personal_reminder', 'appointment')),
  source_id uuid NOT NULL,
  event_at timestamptz NOT NULL,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_type, source_id, event_at)
);
CREATE INDEX rttrack_email_notifications_due_idx
  ON public.rttrack_email_notifications(send_at, id) WHERE status='pending';
ALTER TABLE public.rttrack_email_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_email_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rttrack_email_notifications TO service_role;

-- Only the trusted backend can enqueue and atomically claim due messages.
-- Delivery window: personal reminders at their due time, appointment reminders 24h ahead.
-- Do not mail stale personal reminders (>12 hours late) or already-started appointments.
CREATE FUNCTION public.rttrack_claim_email_notifications(p_batch_size integer DEFAULT 5)
RETURNS TABLE(notification_id uuid, recipient_email text, kind text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.rttrack_email_notifications(patient_id,notification_type,source_id,event_at,send_at)
  SELECT r.patient_id,'personal_reminder',r.id,r.due_at,r.due_at
    FROM public.rttrack_personal_reminders r
    JOIN public.rttrack_notification_preferences p
      ON p.patient_id=r.patient_id AND p.channel='email'
     AND p.notification_type='personal_reminder' AND p.enabled
    JOIN auth.users u ON u.id=r.patient_id AND u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL
   WHERE r.status='pending' AND r.due_at <= now() AND r.due_at >= now() - interval '12 hours'
  ON CONFLICT (notification_type, source_id, event_at) DO NOTHING;

  INSERT INTO public.rttrack_email_notifications(patient_id,notification_type,source_id,event_at,send_at)
  SELECT plan.patient_id,'appointment',s.id,s.scheduled_for,
         GREATEST(s.scheduled_for - interval '24 hours',s.created_at)
    FROM public.rttrack_treatment_sessions s
    JOIN public.rttrack_treatment_plans plan ON plan.id=s.plan_id AND plan.status='active'
    JOIN public.rttrack_notification_preferences p
      ON p.patient_id=plan.patient_id AND p.channel='email'
     AND p.notification_type='appointment' AND p.enabled
    JOIN auth.users u ON u.id=plan.patient_id AND u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL
   WHERE s.status='scheduled' AND s.scheduled_for>now()+interval '30 minutes'
     AND GREATEST(s.scheduled_for - interval '24 hours',s.created_at) <= now()
     AND GREATEST(s.scheduled_for - interval '24 hours',s.created_at) >= now() - interval '12 hours'
  ON CONFLICT (notification_type, source_id, event_at) DO NOTHING;

  -- Cancel unsent messages if a reminder/appointment was cancelled or changed,
  -- a plan was closed, or the patient opted out. A sent message cannot be recalled.
  UPDATE public.rttrack_email_notifications n
     SET status='cancelled',updated_at=now()
   WHERE n.status='pending' AND NOT EXISTS (
     SELECT 1 FROM public.rttrack_notification_preferences pref
     WHERE pref.patient_id=n.patient_id AND pref.channel='email'
       AND pref.notification_type=n.notification_type AND pref.enabled
   );
  UPDATE public.rttrack_email_notifications n
     SET status='cancelled',updated_at=now()
   WHERE n.status='pending' AND (
     (n.notification_type='personal_reminder' AND NOT EXISTS (
       SELECT 1 FROM public.rttrack_personal_reminders r
        WHERE r.id=n.source_id AND r.patient_id=n.patient_id
          AND r.status='pending' AND r.due_at=n.event_at
          AND r.due_at >= now() - interval '12 hours'
     ))
     OR (n.notification_type='appointment' AND NOT EXISTS (
       SELECT 1 FROM public.rttrack_treatment_sessions s
         JOIN public.rttrack_treatment_plans plan ON plan.id=s.plan_id
        WHERE s.id=n.source_id AND plan.patient_id=n.patient_id
          AND plan.status='active' AND s.status='scheduled'
          AND s.scheduled_for=n.event_at AND s.scheduled_for>now()+interval '30 minutes'
     ))
   );

  RETURN QUERY
  WITH chosen AS (
    SELECT n.id,u.email
      FROM public.rttrack_email_notifications n
      JOIN auth.users u ON u.id=n.patient_id
      WHERE n.status='pending' AND n.send_at<=now()
        AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
      ORDER BY n.send_at,n.id
      FOR UPDATE OF n SKIP LOCKED
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size,5),1),5)
  )
  UPDATE public.rttrack_email_notifications n
     SET status='sending',attempts=n.attempts+1,last_attempt_at=now(),updated_at=now()
    FROM chosen c
   WHERE n.id=c.id
   RETURNING n.id,c.email,n.notification_type;
END;
$$;

-- A failed/ambiguous SMTP attempt is NOT retried automatically: accepting an SMTP
-- DATA command followed by a broken connection could otherwise duplicate emails.
-- Operators can review failed/sending records before deciding on a manual retry.
CREATE FUNCTION public.rttrack_finish_email_notification(
  p_notification_id uuid,p_result text,p_message_id text DEFAULT NULL,p_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF p_result NOT IN ('accepted','failed') OR p_result IS NULL THEN
    RAISE EXCEPTION 'Invalid delivery result' USING ERRCODE='22023';
  END IF;
  UPDATE public.rttrack_email_notifications n
    SET status=p_result,
        accepted_at=CASE WHEN p_result='accepted' THEN now() ELSE NULL END,
        provider_message_id=CASE WHEN p_result='accepted' THEN left(p_message_id,255) ELSE NULL END,
        last_error_code=CASE WHEN p_result='failed' THEN left(coalesce(p_error_code,'unknown'),64) ELSE NULL END,
        updated_at=now()
  WHERE n.id=p_notification_id AND n.status='sending'
  RETURNING n.id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

-- Private status and verified RECIPIENT recheck immediately before SMTP. No browser access.
CREATE FUNCTION public.rttrack_email_notification_is_current(p_notification_id uuid,p_recipient_email text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.rttrack_email_notifications n
      JOIN public.rttrack_notification_preferences pref
        ON pref.patient_id=n.patient_id AND pref.channel='email'
       AND pref.notification_type=n.notification_type AND pref.enabled
      JOIN auth.users u ON u.id=n.patient_id AND u.email_confirmed_at IS NOT NULL
        AND u.email=p_recipient_email AND p_recipient_email IS NOT NULL
    WHERE n.id=p_notification_id AND n.status='sending'
      AND (
        (n.notification_type='personal_reminder' AND EXISTS (
          SELECT 1 FROM public.rttrack_personal_reminders r
          WHERE r.id=n.source_id AND r.patient_id=n.patient_id
            AND r.status='pending' AND r.due_at=n.event_at
            AND r.due_at>=now()-interval '12 hours'
        ))
        OR (n.notification_type='appointment' AND EXISTS (
          SELECT 1 FROM public.rttrack_treatment_sessions s
          JOIN public.rttrack_treatment_plans plan ON plan.id=s.plan_id
          WHERE s.id=n.source_id AND plan.patient_id=n.patient_id
            AND plan.status='active' AND s.status='scheduled'
            AND s.scheduled_for=n.event_at AND s.scheduled_for>now()+interval '30 minutes'
        ))
      )
  );
END;
$$;

CREATE FUNCTION public.rttrack_cancel_email_notification(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  UPDATE public.rttrack_email_notifications SET status='cancelled',updated_at=now()
  WHERE id=p_notification_id AND status='sending' RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION
  public.rttrack_claim_email_notifications(integer),
  public.rttrack_finish_email_notification(uuid,text,text,text),
  public.rttrack_email_notification_is_current(uuid,text),
  public.rttrack_cancel_email_notification(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.rttrack_claim_email_notifications(integer),
  public.rttrack_finish_email_notification(uuid,text,text,text),
  public.rttrack_email_notification_is_current(uuid,text),
  public.rttrack_cancel_email_notification(uuid)
TO service_role;
COMMIT;
-- After migration completes: NOTIFY pgrst, 'reload schema';
