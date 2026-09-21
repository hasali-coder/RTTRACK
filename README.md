# RTTRACK — Clinician onboarding · Milestone 01

This milestone implements a real Supabase clinician registration and login flow, email confirmation, database-enforced pending status, and a verified clinician shell. The reference navy/white palette is preserved. It **does not** contain patient data, patient creation, hospital scoping, AI, live email reminders, SMS or operational emergency services. DO NOT use with real patients.

## Start on Windows (VS Code)
1. Install Node.js LTS and VS Code if you have not already.
2. Extract the ZIP. In VS Code use File > Open Folder and select `rttrack-clinician-m01`.
3. Create a **new, development-only** Supabase project at https://supabase.com/dashboard. Never place real patient data into this project.
4. Open Supabase > SQL Editor > New query. Paste `supabase/001_clinician_onboarding.sql` and click Run **once**. Confirm it succeeds. The SQL creates an application table and a signup trigger; patient records are not created.
5. In Supabase > Authentication > Providers > Email, enable email signup and email confirmation. Under Authentication > URL Configuration set Site URL to `http://localhost:5173` and add `http://localhost:5173/**` to allowed redirect URLs. Supabase's default email sending has restrictions; use a configured email provider later for production.
6. In Supabase > Project Settings / Connect / API Keys, copy the **Project URL** and **publishable key**. Do NOT use a secret/service_role key.
7. Copy `.env.example` to a file named `.env` in the same folder. Replace the two placeholder values with your project URL and publishable key. Never upload `.env`, passwords, or secret keys to this chat or GitHub.
8. In VS Code Terminal > New Terminal, run `npm install`, then `npm run dev`. Open the URL displayed (normally `http://localhost:5173`).
9. Register a clinician using fictional/test details and an email account you control. Confirm the email from your inbox, sign in, and check that the screen says **Verification pending**. Email confirmation and clinician approval are different steps.
10. To simulate *legitimate* manual approval: in Supabase SQL Editor run `select user_id, email, full_name, registration_number, institution, status from public.clinician_applications order by submitted_at desc;`. Only after verifying the clinician's credentials and affiliation independently, copy the exact UUID. Run `update public.clinician_applications set status='approved', reviewed_at=now(), review_note='Credentials verified by project administrator' where user_id='THE_VERIFIED_UUID' and status='pending';`. Return to the app and select **Refresh approval status**. For a test account, approval is strictly a demonstration, not real credential verification.
11. To verify the access boundary, create a second test account and leave it pending. It must not see the verified workspace or any other user's application. Never use a browser field or signup metadata as proof of approval.

## If something fails
- `npm` not recognised: install Node.js LTS and restart VS Code.
- Setup required: check `.env` naming and restart `npm run dev` after edits.
- No confirmation email: check spam, Supabase Authentication > Users, email confirmation settings, and Supabase email quota/provider limits.
- Error inserting account: verify the SQL editor ran successfully and inspect Supabase Auth logs.
- Login works but application missing: confirm the auth trigger was installed *before* registering. Do not manually change statuses until the trigger issue is fixed.

## Security boundaries
- Publishable browser key + RLS; zero browser write privilege to clinician applications.
- A user cannot self-approve via this app or change another clinician's record. Administrative approval currently occurs manually through Supabase's privileged SQL Editor.
- The authentication trigger reads untrusted registration fields only as an application for review, never as proof of professional status.
- Before a clinical pilot: independent professional credential verification, hospital authorization/isolation, privacy and consent review, documented clinical escalation, RLS allow/deny tests, audit trails, production email delivery, backup/restore and institutional/ethics approvals where applicable.
