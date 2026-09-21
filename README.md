# RTTRACK

**Radiotherapy care continuity · Development prototype**

RTTRACK is a web application being developed to support communication, record visibility and continuity between people receiving radiotherapy and their care teams. It provides separate patient, clinician and administrator experiences, with patient-controlled sharing for connected clinicians.

**Live prototype:** [rttrack.vercel.app](https://rttrack.vercel.app)  
**Status:** In development. Use fictional test identities and records only. RTTRACK has not been validated for clinical use and is not an emergency service.

## What the prototype includes

| Area | Current functionality |
| --- | --- |
| Accounts and access | Email/password sign-in; patient registration; clinician application and administrator approval; administrator invitation flow. Sign-in is the default entry screen. |
| Patient portal | Patient profile, care connections and controls for sharing treatment and symptom information. |
| Clinician workspace | Dashboard, a directory of actively connected and consenting patients, and permission-scoped treatment and symptom views. |
| Treatment records | Treatment plans, fraction/session records and plan lifecycle management. Recorded activity is not a measure of clinical outcome or treatment adherence. |
| Symptom reporting | Patient-submitted symptom entries and clinician review subject to separate sharing consent. |
| Reminders | In-app reminder records and notification preferences. Automated email delivery and SMS are **not active**. |
| Education | An education library with review and publication controls. |

Some navigation items are placeholders or works in progress. **Zora AI**, a proposed educational assistant, is a future feature—not an integrated AI service in this version.

## Technology

- **Frontend:** React, TypeScript and Vite
- **Authentication and database:** Supabase Auth and PostgreSQL, with row-level security and permission-checked database functions
- **Hosting:** Vercel, connected to this GitHub repository

## Run locally

Use the existing RTTRACK project; you do not need to start a new application or database.

1. Install a supported Node.js version and open this repository in VS Code.
2. Install dependencies: `npm install`.
3. Create a local `.env` file in the project root with values from your **existing RTTRACK Supabase project**:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

4. Start the development server: `npm run dev`. Open the URL printed in the terminal.
5. Before committing changes, run `npm run build`.

**Never commit `.env` or put a Supabase secret/service-role key, database password, SMTP password or other private credential in a `VITE_` variable.** Vite exposes `VITE_` values in the browser. The publishable key is designed for client use; database access must still be protected by server-side permissions.

## Database setup

The `supabase/` directory contains numbered SQL migrations, `001` through `013`, covering account onboarding, administration, patient connections, treatment records, symptom reporting, reminders, notification preferences and the education library.

For an existing deployment, **do not rerun all migrations**. Apply only migrations that have not already been installed, in order, using the relevant project change procedure. Changes to the database and access policies should be tested with fictional accounts before deployment. The SQL files in this repository do not themselves deploy the database when Vercel builds the frontend.

## Deploy to Vercel

Import this repository into Vercel and configure it as a Vite project with:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Root directory | Repository root (`./`) |

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in **Vercel → Project → Environment Variables** for the appropriate deployment environments, using values from the *same Supabase project* as local development. The Supabase integration may create similarly named variables without the `VITE_` prefix; those names alone do not configure this frontend. Redeploy after adding or changing build-time variables.

Under **Supabase → Authentication → URL Configuration**, configure the deployed site's actual URL for authentication redirects while retaining the localhost redirect used for development. Do not upload local `.env` files to GitHub or Vercel.

## Safety and privacy

RTTRACK is a prototype for development and demonstration, **not** a medical device, clinical decision-support tool or replacement for a treating team. It must not be used to prescribe treatment, make emergency decisions or manage real patient care in its current state.

Patient–clinician connections and permissions to view treatment or symptom records are separate. The browser must not bypass the existing database-enforced access checks. Before any real-world pilot, the project requires professional and institutional review, privacy and security assessments, verified clinical workflows, accessibility and reliability testing, incident-response planning, and appropriate approvals.

## Project direction

Current work focuses on refining the patient and clinician experience, confirming permission boundaries, and making the deployed prototype reliable. Potential later work includes a carefully scoped, clinician-reviewed educational assistant called **Zora**. Proposed features are not described here as implemented functionality.

---

**Repository:** [hasali-coder/RTTRACK](https://github.com/hasali-coder/RTTRACK) · **Prototype:** [rttrack.vercel.app](https://rttrack.vercel.app)
