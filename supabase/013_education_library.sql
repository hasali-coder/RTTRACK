-- RTTRACK M06A: controlled education library, for fictional development accounts only.
-- Additive, independent of notification migration 012. Run ONCE in the existing development project.
-- Do not insert unverified clinical information: resources begin as drafts and require another administrator.
BEGIN;

CREATE TABLE public.rttrack_education_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 4 AND 160),
  category text NOT NULL CHECK (category IN ('Radiotherapy basics','Side effects','Nutrition','Emotional support','Caregiver support','Glossary')),
  language_code text NOT NULL CHECK (language_code IN ('en','sw')),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 40 AND 12000),
  source_name text NOT NULL CHECK (char_length(btrim(source_name)) BETWEEN 4 AND 200),
  source_url text NOT NULL CHECK (char_length(source_url) <= 1000 AND source_url ~* '^https://[^[:space:]<>]+$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  review_note text,
  archived_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  archive_reason text,
  CONSTRAINT rttrack_education_status_consistency CHECK (
    (status='draft' AND approved_by IS NULL AND approved_at IS NULL AND archived_by IS NULL AND archived_at IS NULL)
    OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND archived_by IS NULL AND archived_at IS NULL)
    OR (status='archived' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND archived_by IS NOT NULL AND archived_at IS NOT NULL)
  ),
  CONSTRAINT rttrack_education_separate_approver CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE INDEX rttrack_education_published_idx ON public.rttrack_education_resources(approved_at DESC) WHERE status='approved';
CREATE INDEX rttrack_education_admin_idx ON public.rttrack_education_resources(created_at DESC);
ALTER TABLE public.rttrack_education_resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_education_resources FROM PUBLIC, anon, authenticated;

CREATE TABLE public.rttrack_education_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES public.rttrack_education_resources(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created','approved','archived')),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rttrack_education_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_education_audit FROM PUBLIC, anon, authenticated;

-- Authenticated verified patients/approved clinicians/admins see ONLY approved resources.
CREATE FUNCTION public.rttrack_list_education()
RETURNS TABLE (resource_id uuid, title text, category text, language_code text,
  content text, source_name text, source_url text, approved_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.rttrack_is_patient() OR public.rttrack_is_approved_clinician()
    OR public.rttrack_is_administrator()
  ) THEN RAISE EXCEPTION 'Authorised RTTRACK account required'; END IF;
  RETURN QUERY
    SELECT r.id,r.title,r.category,r.language_code,r.content,r.source_name,r.source_url,r.approved_at
    FROM public.rttrack_education_resources r
    WHERE r.status='approved'
    ORDER BY r.approved_at DESC, r.id;
END;
$$;

-- Administrators see drafts and archived records, including evidence and attribution.
CREATE FUNCTION public.rttrack_list_education_admin()
RETURNS TABLE (resource_id uuid, title text, category text, language_code text,
  content text, source_name text, source_url text, status text, created_by uuid,
  created_at timestamptz, approved_by uuid, approved_at timestamptz,
  review_note text, archived_at timestamptz, archive_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  RETURN QUERY
    SELECT r.id,r.title,r.category,r.language_code,r.content,r.source_name,r.source_url,
      r.status,r.created_by,r.created_at,r.approved_by,r.approved_at,
      r.review_note,r.archived_at,r.archive_reason
    FROM public.rttrack_education_resources r
    ORDER BY r.created_at DESC, r.id;
END;
$$;

CREATE FUNCTION public.rttrack_create_education_draft(
  p_title text, p_category text, p_language_code text, p_content text,
  p_source_name text, p_source_url text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  INSERT INTO public.rttrack_education_resources
    (title,category,language_code,content,source_name,source_url,created_by)
  VALUES (btrim(p_title),p_category,p_language_code,btrim(p_content),btrim(p_source_name),btrim(p_source_url),auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.rttrack_education_audit(resource_id,actor_id,event_type)
  VALUES (v_id,auth.uid(),'created');
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.rttrack_approve_education(p_resource_id uuid, p_review_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_creator uuid; v_status text;
BEGIN
  IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  IF p_review_note IS NULL OR char_length(btrim(p_review_note)) < 20 OR char_length(p_review_note) > 2000 THEN
    RAISE EXCEPTION 'Enter a clinical and source review note of 20 to 2000 characters';
  END IF;
  SELECT r.created_by,r.status INTO v_creator,v_status
  FROM public.rttrack_education_resources r WHERE r.id=p_resource_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'draft' THEN RAISE EXCEPTION 'Draft unavailable; refresh'; END IF;
  IF v_creator=auth.uid() THEN RAISE EXCEPTION 'Another administrator must approve this content'; END IF;
  UPDATE public.rttrack_education_resources
  SET status='approved',approved_by=auth.uid(),approved_at=now(),review_note=btrim(p_review_note)
  WHERE id=p_resource_id;
  INSERT INTO public.rttrack_education_audit(resource_id,actor_id,event_type,note)
  VALUES (p_resource_id,auth.uid(),'approved',btrim(p_review_note));
END;
$$;

CREATE FUNCTION public.rttrack_archive_education(p_resource_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.rttrack_is_administrator() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 15 OR char_length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'Enter an archive reason of 15 to 2000 characters';
  END IF;
  SELECT r.status INTO v_status FROM public.rttrack_education_resources r
  WHERE r.id=p_resource_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'approved' THEN RAISE EXCEPTION 'Only published resources can be archived'; END IF;
  UPDATE public.rttrack_education_resources SET status='archived',archived_by=auth.uid(),
    archived_at=now(),archive_reason=btrim(p_reason) WHERE id=p_resource_id;
  INSERT INTO public.rttrack_education_audit(resource_id,actor_id,event_type,note)
  VALUES (p_resource_id,auth.uid(),'archived',btrim(p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.rttrack_list_education() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_list_education_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_create_education_draft(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_approve_education(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rttrack_archive_education(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_list_education() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_list_education_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_create_education_draft(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_approve_education(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_archive_education(uuid,text) TO authenticated;
COMMIT;
