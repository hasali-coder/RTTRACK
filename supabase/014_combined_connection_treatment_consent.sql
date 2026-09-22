-- RTTRACK 014: patient-authorised connection + treatment sharing in one action.
-- Apply ONCE to the EXISTING RTTRACK database, after migrations 004, 005 and 006.
-- No existing link, sharing setting or symptom permission is changed or backfilled.
-- The UI must be deployed alongside this change: earlier client wording describes separate consent.
BEGIN;
DO $preflight$
BEGIN
 IF to_regprocedure('public.rttrack_patient_request_clinician(uuid,boolean)') IS NULL
 OR to_regprocedure('public.rttrack_respond_link(uuid,boolean,boolean)') IS NULL
 OR to_regprocedure('public.rttrack_set_treatment_sharing(uuid,boolean)') IS NULL
 OR to_regclass('public.rttrack_treatment_sharing_events') IS NULL
 THEN RAISE EXCEPTION 'Required RTTRACK migrations 004/005/006 missing. Stop.'; END IF;
END;
$preflight$;


-- Version the combined patient agreement for future consent audits. This table
-- contains user/link IDs and consent metadata, never medical records.
CREATE TABLE public.rttrack_combined_consent_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 link_id uuid NOT NULL REFERENCES public.rttrack_patient_clinician_links(id),
 patient_id uuid NOT NULL REFERENCES public.patient_profiles(user_id),
 consent_version text NOT NULL CHECK (consent_version = 'connection-treatment-v1'),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rttrack_combined_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rttrack_combined_consent_events FROM PUBLIC, anon, authenticated;

-- Request initiated by patient: patient explicitly consents to both permissions;
-- clinician still has to accept before the link becomes ACTIVE.
create or replace function public.rttrack_patient_request_clinician(p_clinician_id uuid,p_consent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link uuid;
begin
 if not public.rttrack_is_patient() then raise exception 'Patient account required'; end if;
 if p_consent is distinct from true then raise exception 'Explicit patient consent required'; end if;
 if not exists(select 1 from public.rttrack_clinician_directory d
   join public.clinician_applications c on c.user_id=d.clinician_id
   join auth.users u on u.id=c.user_id
   where d.clinician_id=p_clinician_id and d.discoverable and c.status='approved' and u.email_confirmed_at is not null)
 then raise exception 'Clinician is not currently available in the directory'; end if;
 insert into public.rttrack_patient_clinician_links(patient_id,clinician_id,initiated_by,patient_consented_at)
 values(auth.uid(),p_clinician_id,auth.uid(),now()) returning id into v_link;
 -- Recorded now, but doctor access is gated by ACTIVE link and clinician approval.
 insert into public.rttrack_treatment_sharing(link_id,allowed,allowed_at,revoked_at)
 values(v_link,true,now(),null);
 insert into public.rttrack_treatment_sharing_events(link_id,patient_id,allowed)
 values(v_link,auth.uid(),true);
 insert into public.rttrack_combined_consent_events(link_id,patient_id,consent_version)
 values(v_link,auth.uid(),'connection-treatment-v1');
end;
$$;


-- Doctor-initiated request: only the patient can accept and grant access.
-- Declines and clinician acceptance keep their existing semantics.
create or replace function public.rttrack_respond_link(p_link_id uuid,p_accept boolean,p_patient_consent boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.rttrack_patient_clinician_links%rowtype;
begin
 if auth.uid() is null or p_accept is null then raise exception 'Not authorised'; end if;
 select * into l from public.rttrack_patient_clinician_links where id=p_link_id for update;
 if not found or l.status<>'pending' then raise exception 'Request no longer pending'; end if;
 if l.initiated_by=auth.uid() or auth.uid() not in (l.patient_id,l.clinician_id) then
   raise exception 'Only the recipient may respond'; end if;
 if p_accept and auth.uid()=l.patient_id then
   if not public.rttrack_is_patient() or p_patient_consent is distinct from true then
     raise exception 'Explicit patient consent required'; end if;
 elsif p_accept and auth.uid()=l.clinician_id and not public.rttrack_is_approved_clinician() then
   raise exception 'Clinician approval required';
 end if;
 -- Lock per patient to serialize primary selection across concurrent approvals.
 perform pg_advisory_xact_lock(hashtextextended(l.patient_id::text,0));
 if p_accept then
  update public.rttrack_patient_clinician_links
   set status='active',decided_at=now(),
    patient_consented_at=case when auth.uid()=patient_id then now() else patient_consented_at end,
    clinician_accepted_at=case when auth.uid()=clinician_id then now() else clinician_accepted_at end,
    is_primary=not exists(select 1 from public.rttrack_patient_clinician_links x
                           where x.patient_id=l.patient_id and x.status='active' and x.is_primary)
   where id=l.id;
  -- The patient gives the combined consent when accepting a doctor-initiated request.
  -- This function and the sharing RPC execute in one PostgreSQL transaction.
  if auth.uid()=l.patient_id then
    perform public.rttrack_set_treatment_sharing(l.id,true);
    insert into public.rttrack_combined_consent_events(link_id,patient_id,consent_version)
    values(l.id,auth.uid(),'connection-treatment-v1');
  end if;
 else
  update public.rttrack_patient_clinician_links set status='declined',decided_at=now() where id=l.id;
 end if;
end;
$$;


-- Keep invocation restricted to authenticated users. SECURITY DEFINER bodies
-- validate the patient/doctor identity; RLS and existing treatment RPCs stay intact.
REVOKE ALL ON FUNCTION public.rttrack_patient_request_clinician(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_patient_request_clinician(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.rttrack_respond_link(uuid,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rttrack_respond_link(uuid,boolean,boolean) TO authenticated;
COMMIT;
