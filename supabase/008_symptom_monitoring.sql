-- RTTRACK Milestone 04: symptom log, separately consented clinician viewing, acknowledgement.
-- DEVELOPMENT ONLY: fictional health details; NOT monitored, triaged, or sent by email/SMS.
-- Apply once AFTER migrations 001-007 in the EXISTING development project.
BEGIN;

CREATE TABLE public.rttrack_symptom_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id) ON DELETE RESTRICT,
  symptom_type text NOT NULL CHECK (symptom_type IN (
    'fatigue','nausea','skin_irritation','appetite_changes','pain','other'
  )),
  onset_at timestamptz NOT NULL,
  severity integer NOT NULL CHECK (severity BETWEEN 1 AND 10),
  observations text CHECK (observations IS NULL OR char_length(observations) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.clinician_applications(user_id) ON DELETE RESTRICT,
  CONSTRAINT rttrack_symptom_review_consistent CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL) OR
    (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);
CREATE INDEX rttrack_symptom_entries_patient_idx
  ON public.rttrack_symptom_entries(patient_id, onset_at DESC);
ALTER TABLE public.rttrack_symptom_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_symptom_entries FROM PUBLIC, anon, authenticated;

-- Each link begins PRIVATE, independently of treatment-record consent (Migration 005).
CREATE TABLE public.rttrack_symptom_sharing (
  link_id uuid PRIMARY KEY REFERENCES public.rttrack_patient_clinician_links(id) ON DELETE RESTRICT,
  allowed boolean NOT NULL DEFAULT false,
  allowed_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rttrack_symptom_sharing_timestamp CHECK (
    (allowed AND allowed_at IS NOT NULL AND revoked_at IS NULL) OR
    (NOT allowed AND allowed_at IS NULL)
  )
);
ALTER TABLE public.rttrack_symptom_sharing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_symptom_sharing FROM PUBLIC, anon, authenticated;

-- Lightweight development audit metadata only; NOT a validated clinical audit system.
CREATE TABLE public.rttrack_symptom_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  entry_id uuid REFERENCES public.rttrack_symptom_entries(id) ON DELETE RESTRICT,
  link_id uuid REFERENCES public.rttrack_patient_clinician_links(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created','acknowledged','sharing_enabled','sharing_disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rttrack_symptom_event_target CHECK (
    (event_type IN ('created','acknowledged') AND entry_id IS NOT NULL AND link_id IS NULL) OR
    (event_type IN ('sharing_enabled','sharing_disabled') AND link_id IS NOT NULL AND entry_id IS NULL)
  )
);
ALTER TABLE public.rttrack_symptom_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_symptom_events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.rttrack_log_symptom(
  p_symptom_type text, p_onset_at timestamptz, p_severity integer, p_observations text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_entry uuid; v_notes text := nullif(btrim(coalesce(p_observations, '')), '');
BEGIN
  IF NOT public.rttrack_is_patient() THEN RAISE EXCEPTION 'Confirmed patient account required' USING ERRCODE='42501'; END IF;
  IF p_symptom_type IS NULL OR p_symptom_type NOT IN (
    'fatigue','nausea','skin_irritation','appetite_changes','pain','other'
  ) OR p_severity IS NULL OR p_severity NOT BETWEEN 1 AND 10
    OR p_onset_at IS NULL OR p_onset_at > now() + interval '5 minutes'
    OR p_onset_at < now() - interval '5 years'
    OR (v_notes IS NOT NULL AND char_length(v_notes)>1000)
  THEN RAISE EXCEPTION 'Enter a valid symptom, onset, severity (1–10) and observations (up to 1000 characters)' USING ERRCODE='22023'; END IF;
  INSERT INTO public.rttrack_symptom_entries(patient_id,symptom_type,onset_at,severity,observations)
  VALUES(auth.uid(),p_symptom_type,p_onset_at,p_severity,v_notes) RETURNING id INTO v_entry;
  INSERT INTO public.rttrack_symptom_events(actor_id,entry_id,event_type)
  VALUES(auth.uid(),v_entry,'created');
  RETURN v_entry;
END;
$$;

CREATE FUNCTION public.rttrack_set_symptom_sharing(p_link_id uuid, p_allow boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.rttrack_patient_clinician_links%ROWTYPE;
BEGIN
  IF NOT public.rttrack_is_patient() OR p_allow IS NULL THEN
    RAISE EXCEPTION 'Confirmed patient authorisation required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO l FROM public.rttrack_patient_clinician_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR l.patient_id<>auth.uid() OR l.status<>'active'
    OR l.patient_consented_at IS NULL OR l.clinician_accepted_at IS NULL THEN
    RAISE EXCEPTION 'An active, consented patient-owned connection is required' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.rttrack_symptom_sharing(link_id,allowed,allowed_at,revoked_at)
  VALUES(l.id,p_allow,CASE WHEN p_allow THEN now() ELSE NULL END,
    CASE WHEN p_allow THEN NULL ELSE now() END)
  ON CONFLICT (link_id) DO UPDATE SET
    allowed=EXCLUDED.allowed, allowed_at=EXCLUDED.allowed_at,
    revoked_at=EXCLUDED.revoked_at,updated_at=now();
  INSERT INTO public.rttrack_symptom_events(actor_id,link_id,event_type)
  VALUES(auth.uid(),l.id,CASE WHEN p_allow THEN 'sharing_enabled' ELSE 'sharing_disabled' END);
END;
$$;

CREATE FUNCTION public.rttrack_my_symptom_sharing()
RETURNS TABLE(link_id uuid, allowed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_patient() THEN RAISE EXCEPTION 'Patient account required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT l.id,coalesce(sh.allowed,false)
  FROM public.rttrack_patient_clinician_links l
  LEFT JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
  WHERE l.patient_id=auth.uid() AND l.status='active'
    AND l.patient_consented_at IS NOT NULL AND l.clinician_accepted_at IS NOT NULL
  ORDER BY l.created_at DESC LIMIT 100;
END;
$$;

CREATE FUNCTION public.rttrack_symptom_patients()
RETURNS TABLE(patient_id uuid, full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT DISTINCT p.user_id,p.full_name
  FROM public.patient_profiles p
  JOIN public.rttrack_patient_clinician_links l ON l.patient_id=p.user_id
  JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
  WHERE l.clinician_id=auth.uid() AND l.status='active'
    AND l.patient_consented_at IS NOT NULL AND l.clinician_accepted_at IS NOT NULL
    AND sh.allowed AND sh.allowed_at IS NOT NULL
  ORDER BY p.full_name,p.user_id LIMIT 100;
END;
$$;

-- A patient can only list their own entries. A clinician MUST supply a specific patient ID
-- and have their own current active connection AND separate symptom-sharing permission.
CREATE FUNCTION public.rttrack_list_symptoms(p_patient_id uuid)
RETURNS TABLE(
  entry_id uuid,patient_id uuid,symptom_type text,onset_at timestamptz,
  severity integer,observations text,created_at timestamptz,
  reviewed_at timestamptz,reviewed_by uuid
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_patient uuid;
BEGIN
  IF public.rttrack_is_patient() AND (p_patient_id IS NULL OR p_patient_id=auth.uid()) THEN
    v_patient := auth.uid();
  ELSIF public.rttrack_is_approved_clinician() AND p_patient_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rttrack_patient_clinician_links l
    JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
    WHERE l.patient_id=p_patient_id AND l.clinician_id=auth.uid()
      AND l.status='active' AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL AND sh.allowed AND sh.allowed_at IS NOT NULL
  ) THEN
    v_patient := p_patient_id;
  ELSE
    RAISE EXCEPTION 'Symptom records unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT e.id,e.patient_id,e.symptom_type,e.onset_at,e.severity,
    e.observations,e.created_at,e.reviewed_at,e.reviewed_by
  FROM public.rttrack_symptom_entries e
  WHERE e.patient_id=v_patient
  ORDER BY e.onset_at DESC,e.created_at DESC LIMIT 100;
END;
$$;

-- Acknowledgement means the clinician opened/reviewed the entry; not diagnosis or triage.
CREATE FUNCTION public.rttrack_acknowledge_symptom(p_entry_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.rttrack_symptom_entries%ROWTYPE;
BEGIN
  IF NOT public.rttrack_is_approved_clinician() THEN RAISE EXCEPTION 'Approved clinician required' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.rttrack_symptom_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.rttrack_patient_clinician_links l
    JOIN public.rttrack_symptom_sharing sh ON sh.link_id=l.id
    WHERE l.patient_id=e.patient_id AND l.clinician_id=auth.uid()
      AND l.status='active' AND l.patient_consented_at IS NOT NULL
      AND l.clinician_accepted_at IS NOT NULL AND sh.allowed AND sh.allowed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Symptom entry unavailable' USING ERRCODE='42501'; END IF;
  IF e.reviewed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.rttrack_symptom_entries SET reviewed_at=now(),reviewed_by=auth.uid()
  WHERE id=e.id AND reviewed_at IS NULL;
  INSERT INTO public.rttrack_symptom_events(actor_id,entry_id,event_type)
  VALUES(auth.uid(),e.id,'acknowledged');
END;
$$;

REVOKE ALL ON FUNCTION
  public.rttrack_log_symptom(text,timestamptz,integer,text),
  public.rttrack_set_symptom_sharing(uuid,boolean),
  public.rttrack_my_symptom_sharing(),
  public.rttrack_symptom_patients(),
  public.rttrack_list_symptoms(uuid),
  public.rttrack_acknowledge_symptom(uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.rttrack_log_symptom(text,timestamptz,integer,text),
  public.rttrack_set_symptom_sharing(uuid,boolean),
  public.rttrack_my_symptom_sharing(),
  public.rttrack_symptom_patients(),
  public.rttrack_list_symptoms(uuid),
  public.rttrack_acknowledge_symptom(uuid)
TO authenticated;
COMMIT;
