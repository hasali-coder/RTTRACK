-- RTTRACK Milestone 03A: independent patient identity only.
-- Run once AFTER migrations 001 and 002 in the existing development project.
-- No clinical data, patient-clinician links, or treatment information is created.
begin;

create table public.patient_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  created_at timestamptz not null default now()
);

alter table public.patient_profiles enable row level security;
revoke all on public.patient_profiles from public, anon, authenticated;
grant select on public.patient_profiles to authenticated;
create policy "Patients read only own profile" on public.patient_profiles
  for select to authenticated using (user_id = (select auth.uid()));

-- Account type comes from signup metadata solely to create a self-owned profile.
-- Metadata NEVER grants clinician or administrator privileges.
create function public.rttrack_create_patient_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if new.raw_user_meta_data ->> 'account_type' = 'patient' then
    v_name := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    if char_length(v_name) not between 2 and 120 then
      raise exception 'Valid patient name required';
    end if;
    insert into public.patient_profiles (user_id, full_name)
    values (new.id, v_name);
  end if;
  return new;
end;
$$;
revoke all on function public.rttrack_create_patient_profile() from public, anon, authenticated;
create trigger rttrack_auth_patient_signup
  after insert on auth.users for each row
  execute function public.rttrack_create_patient_profile();
commit;
