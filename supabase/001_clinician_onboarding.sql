-- RTTRACK milestone 01: clinician registration + approval only.
-- Execute once in a NEW Supabase project using SQL Editor.
-- No patient tables or clinical data in this milestone.
create table public.clinician_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  registration_number text not null,
  institution text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);

alter table public.clinician_applications enable row level security;
revoke all on table public.clinician_applications from anon, authenticated;
grant select on table public.clinician_applications to authenticated;
create policy "Clinician reads only own application"
  on public.clinician_applications for select to authenticated
  using ((select auth.uid()) = user_id);

-- The database, not the browser, creates the pending application.
-- The browser cannot set approval status or change an existing application.
create function public.create_clinician_application()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ->> 'account_type' = 'clinician' then
    insert into public.clinician_applications
      (user_id, email, full_name, registration_number, institution)
    values (
      new.id, new.email,
      left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120),
      left(trim(coalesce(new.raw_user_meta_data ->> 'registration_number', '')), 80),
      left(trim(coalesce(new.raw_user_meta_data ->> 'institution', '')), 160)
    );
  end if;
  return new;
end;
$$;
revoke all on function public.create_clinician_application() from public, anon, authenticated;
create trigger rttrack_auth_clinician_signup
  after insert on auth.users for each row
  execute function public.create_clinician_application();

-- IMPORTANT: Only an authenticated project administrator can approve through
-- the Supabase dashboard SQL editor. The application has no approval API.
-- SAMPLE REVIEW QUERY (run separately, read only):
-- select user_id, email, full_name, registration_number, institution, status
-- from public.clinician_applications order by submitted_at desc;
-- SAMPLE APPROVAL (replace with a VERIFIED user UUID, after checking credentials):
-- update public.clinician_applications set status = 'approved',
-- reviewed_at = now(), review_note = 'Credentials verified by project administrator'
-- where user_id = 'REPLACE_WITH_VERIFIED_USER_UUID' and status = 'pending';
-- To reject, set status = 'rejected' instead.
