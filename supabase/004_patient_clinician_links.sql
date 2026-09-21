-- RTTRACK 03B • development-only fictional identities • additive after 001–003.
-- A patient's explicit consent plus the other party's acceptance are required.
-- No treatment or symptom access is granted by this migration.
begin;

create table public.rttrack_clinician_directory (
  clinician_id uuid primary key references public.clinician_applications(user_id) on delete cascade,
  discoverable boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.rttrack_clinician_directory enable row level security;
revoke all on public.rttrack_clinician_directory from public, anon, authenticated;

create table public.rttrack_patient_clinician_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_profiles(user_id) on delete restrict,
  clinician_id uuid not null references public.clinician_applications(user_id) on delete restrict,
  initiated_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','active','declined','revoked')),
  patient_consented_at timestamptz,
  clinician_accepted_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  ended_at timestamptz,
  constraint rttrack_participant_initiated check (initiated_by in (patient_id, clinician_id)),
  constraint rttrack_active_requires_both check (status <> 'active' or (patient_consented_at is not null and clinician_accepted_at is not null)),
  constraint rttrack_primary_requires_active check (not is_primary or status = 'active')
);
create unique index rttrack_one_open_link_per_pair on public.rttrack_patient_clinician_links(patient_id,clinician_id)
  where status in ('pending','active');
create unique index rttrack_one_primary_per_patient on public.rttrack_patient_clinician_links(patient_id)
  where status = 'active' and is_primary;
create index rttrack_links_patient_idx on public.rttrack_patient_clinician_links(patient_id,created_at desc);
create index rttrack_links_clinician_idx on public.rttrack_patient_clinician_links(clinician_id,created_at desc);
alter table public.rttrack_patient_clinician_links enable row level security;
revoke all on public.rttrack_patient_clinician_links from public, anon, authenticated;
-- Read only own connection metadata. All mutations use checked security-definer RPCs.
grant select on public.rttrack_patient_clinician_links to authenticated;
create policy "Connection participants read their own links" on public.rttrack_patient_clinician_links
 for select to authenticated using (patient_id = (select auth.uid()) or clinician_id = (select auth.uid()));

create function public.rttrack_is_patient() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.patient_profiles p join auth.users u on u.id=p.user_id
 where p.user_id=(select auth.uid()) and u.email_confirmed_at is not null);
$$;
create function public.rttrack_is_approved_clinician() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.clinician_applications c join auth.users u on u.id=c.user_id
 where c.user_id=(select auth.uid()) and c.status='approved' and u.email_confirmed_at is not null);
$$;
revoke all on function public.rttrack_is_patient() from public, anon, authenticated;
revoke all on function public.rttrack_is_approved_clinician() from public, anon, authenticated;

-- Clinician voluntarily chooses whether their name and institution appear in discovery.
create function public.rttrack_set_discoverable(p_discoverable boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.rttrack_is_approved_clinician() or p_discoverable is null then raise exception 'Not authorised'; end if;
 insert into public.rttrack_clinician_directory(clinician_id,discoverable)
 values(auth.uid(),p_discoverable)
 on conflict(clinician_id) do update set discoverable=excluded.discoverable,updated_at=now();
end;
$$;
create function public.rttrack_my_discoverability() returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce((select d.discoverable from public.rttrack_clinician_directory d where d.clinician_id=auth.uid()),false);
$$;
create function public.rttrack_find_clinicians()
returns table(clinician_id uuid, full_name text, institution text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.rttrack_is_patient() then raise exception 'Patient account required'; end if;
 return query select c.user_id,c.full_name,c.institution from public.clinician_applications c
 join public.rttrack_clinician_directory d on d.clinician_id=c.user_id
 join auth.users u on u.id=c.user_id
 where c.status='approved' and d.discoverable and u.email_confirmed_at is not null
 order by c.full_name limit 100;
end;
$$;

-- Patient explicitly checks consent before requesting a clinician. The clinician must accept.
create function public.rttrack_patient_request_clinician(p_clinician_id uuid,p_consent boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.rttrack_is_patient() then raise exception 'Patient account required'; end if;
 if p_consent is distinct from true then raise exception 'Explicit patient consent required'; end if;
 if not exists(select 1 from public.rttrack_clinician_directory d
   join public.clinician_applications c on c.user_id=d.clinician_id
   join auth.users u on u.id=c.user_id
   where d.clinician_id=p_clinician_id and d.discoverable and c.status='approved' and u.email_confirmed_at is not null)
 then raise exception 'Clinician is not currently available in the directory'; end if;
 insert into public.rttrack_patient_clinician_links(patient_id,clinician_id,initiated_by,patient_consented_at)
 values(auth.uid(),p_clinician_id,auth.uid(),now());
end;
$$;

-- No public patient directory. A clinician may propose via an email supplied to them;
-- no data is returned, including when the address is not found.
create function public.rttrack_clinician_request_patient(p_patient_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
 if not public.rttrack_is_approved_clinician() then raise exception 'Approved clinician required'; end if;
 if p_patient_email is null or length(btrim(p_patient_email)) not between 5 and 254 then raise exception 'Enter a valid patient email'; end if;
 -- Basic abuse safeguard for the development prototype, including unknown addresses.
 if (select count(*) from public.rttrack_patient_clinician_links l
     where l.clinician_id=auth.uid() and l.initiated_by=auth.uid()
       and l.created_at>now()-interval '1 hour') >= 10 then
   raise exception 'Request limit reached. Try again later';
 end if;
 select p.user_id into v_patient from public.patient_profiles p
 join auth.users u on u.id=p.user_id
 where lower(u.email)=lower(btrim(p_patient_email)) and u.email_confirmed_at is not null;
 if v_patient is null then return; end if;
 -- Duplicate requests are ignored to avoid exposing whether an account exists.
 insert into public.rttrack_patient_clinician_links(patient_id,clinician_id,initiated_by)
 values(v_patient,auth.uid(),auth.uid()) on conflict do nothing;
end;
$$;

create function public.rttrack_list_my_links()
returns table(id uuid,patient_id uuid,clinician_id uuid,patient_name text,clinician_name text,
 institution text,initiated_by uuid,status text,is_primary boolean,patient_consented_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (public.rttrack_is_patient() or public.rttrack_is_approved_clinician()) then
   raise exception 'Not authorised'; end if;
 return query select l.id,l.patient_id,l.clinician_id,
   case when l.initiated_by=l.clinician_id and l.status='pending' and auth.uid()=l.clinician_id
     then 'Patient (awaiting consent)'::text else p.full_name end,
   c.full_name,c.institution,
  l.initiated_by,l.status,l.is_primary,l.patient_consented_at,l.created_at
 from public.rttrack_patient_clinician_links l
 join public.patient_profiles p on p.user_id=l.patient_id
 join public.clinician_applications c on c.user_id=l.clinician_id
 where l.patient_id=auth.uid() or l.clinician_id=auth.uid()
 order by l.created_at desc limit 100;
end;
$$;

-- Recipient alone accepts/declines; patient consent is required on patient acceptance.
create function public.rttrack_respond_link(p_link_id uuid,p_accept boolean,p_patient_consent boolean default false)
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
 else
  update public.rttrack_patient_clinician_links set status='declined',decided_at=now() where id=l.id;
 end if;
end;
$$;

create function public.rttrack_set_primary(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.rttrack_patient_clinician_links%rowtype;
begin
 if not public.rttrack_is_patient() then raise exception 'Patient account required'; end if;
 select * into l from public.rttrack_patient_clinician_links where id=p_link_id;
 if not found or l.patient_id<>auth.uid() or l.status<>'active' then raise exception 'Active connection required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(l.patient_id::text,0));
 update public.rttrack_patient_clinician_links set is_primary=false where patient_id=l.patient_id and is_primary;
 update public.rttrack_patient_clinician_links set is_primary=true where id=l.id and status='active';
end;
$$;

create function public.rttrack_end_link(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.rttrack_patient_clinician_links%rowtype;
begin
 if auth.uid() is null then raise exception 'Not authorised'; end if;
 select * into l from public.rttrack_patient_clinician_links where id=p_link_id for update;
 if not found or auth.uid() not in(l.patient_id,l.clinician_id) or l.status not in('pending','active') then
    raise exception 'Connection unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(l.patient_id::text,0));
 update public.rttrack_patient_clinician_links set status='revoked',is_primary=false,ended_at=now()
  where id=l.id;
 -- Another active clinician becomes primary deterministically, if available.
 if l.is_primary then
  update public.rttrack_patient_clinician_links set is_primary=true
   where id=(select id from public.rttrack_patient_clinician_links
      where patient_id=l.patient_id and status='active' order by created_at,id limit 1);
 end if;
end;
$$;

-- Disallow default PUBLIC EXECUTE on all newly created security-definer functions.
revoke all on function public.rttrack_set_discoverable(boolean),public.rttrack_my_discoverability(),
 public.rttrack_find_clinicians(),public.rttrack_patient_request_clinician(uuid,boolean),
 public.rttrack_clinician_request_patient(text),public.rttrack_list_my_links(),
 public.rttrack_respond_link(uuid,boolean,boolean),public.rttrack_set_primary(uuid),
 public.rttrack_end_link(uuid) from public,anon,authenticated;
grant execute on function public.rttrack_set_discoverable(boolean),public.rttrack_my_discoverability(),
 public.rttrack_find_clinicians(),public.rttrack_patient_request_clinician(uuid,boolean),
 public.rttrack_clinician_request_patient(text),public.rttrack_list_my_links(),
 public.rttrack_respond_link(uuid,boolean,boolean),public.rttrack_set_primary(uuid),
 public.rttrack_end_link(uuid) to authenticated;
commit;
