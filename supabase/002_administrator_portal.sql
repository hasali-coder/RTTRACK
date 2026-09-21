-- RTTRACK Milestone 02: additive migration. Run once AFTER 001_clinician_onboarding.sql.
-- Development use with fictional accounts only. No patient tables are created.
begin;

create table public.rttrack_administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  added_at timestamptz not null default now()
);
alter table public.rttrack_administrators enable row level security;
revoke all on public.rttrack_administrators from public, anon, authenticated;
grant select on public.rttrack_administrators to authenticated;
create policy "Admin reads own membership" on public.rttrack_administrators
  for select to authenticated using (user_id = (select auth.uid()));

-- Membership is database-controlled; user_metadata never grants admin privileges.
create function public.rttrack_is_administrator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rttrack_administrators a
    join auth.users u on u.id = a.user_id
    where a.user_id = (select auth.uid()) and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.rttrack_is_administrator() from public, anon, authenticated;
grant execute on function public.rttrack_is_administrator() to authenticated;

-- Add an administrative SELECT path without altering the existing own-record policy.
create policy "Administrators read clinician applications"
  on public.clinician_applications for select to authenticated
  using ((select public.rttrack_is_administrator()));

create table public.rttrack_application_reviews (
  id bigint generated always as identity primary key,
  application_user_id uuid not null references public.clinician_applications(user_id),
  reviewer_user_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved', 'rejected')),
  evidence_note text not null check (char_length(btrim(evidence_note)) >= 15),
  decided_at timestamptz not null default now()
);
alter table public.rttrack_application_reviews enable row level security;
revoke all on public.rttrack_application_reviews from public, anon, authenticated;
grant select on public.rttrack_application_reviews to authenticated;
create policy "Administrators read review log" on public.rttrack_application_reviews
  for select to authenticated using ((select public.rttrack_is_administrator()));

-- The ONLY browser-accessible approval path. Locked to confirmed administrator,
-- requires explicit evidence attestation, and rejects stale/concurrent decisions.
create function public.rttrack_review_clinician(
  p_user_id uuid, p_decision text, p_evidence_note text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer uuid := (select auth.uid());
  v_updated integer;
begin
  if v_reviewer is null or not public.rttrack_is_administrator() then
    raise exception 'Not authorised to review clinician applications';
  end if;
  if p_user_id is null or p_user_id = v_reviewer then
    raise exception 'Select another applicant';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid review decision';
  end if;
  if p_evidence_note is null or char_length(btrim(p_evidence_note)) < 15
       or char_length(p_evidence_note) > 2000 then
    raise exception 'Provide a review note of 15 to 2000 characters';
  end if;
  if p_decision = 'approved' and not exists (
      select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
    ) then
    raise exception 'Applicant must confirm email before approval';
  end if;

  update public.clinician_applications
     set status = p_decision, reviewed_at = now(), review_note = btrim(p_evidence_note)
   where user_id = p_user_id and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Application is not pending or does not exist. Refresh and retry.';
  end if;

  insert into public.rttrack_application_reviews
    (application_user_id, reviewer_user_id, decision, evidence_note)
  values (p_user_id, v_reviewer, p_decision, btrim(p_evidence_note));
end;
$$;
revoke all on function public.rttrack_review_clinician(uuid,text,text) from public, anon, authenticated;
grant execute on function public.rttrack_review_clinician(uuid,text,text) to authenticated;
commit;

-- Bootstrap founding administrators ONLY from the trusted Supabase SQL Editor,
-- AFTER each founder has registered as a clinician and confirmed their email.
-- The founder's clinician_application row may remain pending; admin access is separate.
-- IMPORTANT: Replace every placeholder, inspect matching emails first, and run only once.
-- select id, email, email_confirmed_at from auth.users
-- where email in ('FOUNDER_ONE_EMAIL', 'FOUNDER_TWO_EMAIL');
-- insert into public.rttrack_administrators (user_id)
-- select id from auth.users
-- where email in ('FOUNDER_ONE_EMAIL', 'FOUNDER_TWO_EMAIL')
--   and email_confirmed_at is not null
-- on conflict (user_id) do nothing;
-- Verify the INSERT returned exactly the expected accounts (use SELECT below).
-- select a.user_id, u.email from public.rttrack_administrators a
-- join auth.users u on u.id = a.user_id;
