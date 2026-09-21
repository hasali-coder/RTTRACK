# RTTRACK

RTTRACK is a patient-centred, AI-enabled digital platform designed to support radiotherapy adherence, symptom monitoring, health literacy, treatment awareness, and continuity of care in Kenya.

## Project

**Full Title:**  
RTTRACK: A Patient Centred, AI Enabled Mobile Application for Supporting Radiotherapy Adherence in Kenya, A Feasibility and Acceptability Evaluation



## Overview

Radiotherapy non-adherence can be influenced by geographical access barriers, health literacy challenges, fragmented patient support, logistical difficulties, and limited continuity of care.

RTTRACK is designed as a digital companion throughout the radiotherapy journey, bringing treatment information, reminders, symptom monitoring, education, communication, and support into a single platform.

The system is being developed as a fully functional, database-connected application rather than a static prototype or presentation-only demonstration.

## Objectives

The primary objective of RTTRACK is to support radiotherapy adherence, symptom monitoring, health literacy, and continuity of care through a patient-centred digital platform.

The system aims to:

1. Support patients in tracking their radiotherapy treatment sessions.
2. Provide visibility of treatment progress and cumulative radiation dose.
3. Provide appointment and treatment reminders.
4. Enable patients to record and monitor treatment-related symptoms.
5. Provide accessible patient education resources.
6. Provide a plain-language radiotherapy glossary.
7. Support English and Kiswahili interfaces and content.
8. Provide AI-enabled educational and navigation support.
9. Facilitate structured patient community discussions.
10. Provide expert-facilitated Q&A functionality.
11. Provide authorised healthcare professionals with relevant patient monitoring tools.
12. Provide administrators with system management and analytics capabilities.
13. Maintain a separate research and evaluation dataset for RTTRACK research activities.

## Core Features

### Patient Application

The patient application provides:

- Patient dashboard
- Treatment plan overview
- Radiotherapy session tracking
- Treatment progress monitoring
- Appointment management
- Symptom tracking
- Symptom history and trends
- Medication reminders
- Patient education library
- Radiotherapy glossary
- Multilingual support
- RTTRACK AI Assistant
- Patient community
- Expert Q&A
- Notifications
- Patient profile and settings

### Treatment Tracking

Treatment plans contain information such as:

- Treatment centre
- Treatment start date
- Expected treatment end date
- Prescribed number of fractions
- Dose per fraction
- Total prescribed dose
- Treatment status
- Assigned healthcare professional

Individual treatment sessions can be recorded as:

- Scheduled
- Completed
- Missed
- Rescheduled
- Cancelled

Treatment progress is calculated from actual database records and is not hardcoded.

### Symptom Monitoring

Patients can complete symptom check-ins and record:

- Symptom
- Severity
- Date
- Optional notes

The system maintains symptom history and provides trend visualisations.

Severe symptom submissions may trigger appropriate safety messaging directing the patient to contact their treatment team or seek urgent medical care where necessary.

RTTRACK does not provide diagnosis or replace professional clinical assessment.

### Medication Reminders

Patients can create and manage medication reminders including:

- Medication name
- Dose
- Frequency
- Reminder time
- Start date
- End date
- Reminder status
- Medication history

The system provides reminders based on information entered through the application or provided through an authorised workflow.

RTTRACK does not prescribe or recommend medication.

### Education Library

The education library provides accessible resources covering areas such as:

- Understanding radiotherapy
- Preparing for treatment
- Managing side effects
- Nutrition
- Emotional wellbeing
- Treatment adherence
- After treatment

Education content is database-driven and can be managed by authorised content managers.

### Radiotherapy Glossary

The glossary provides plain-language explanations of common radiotherapy terminology.

Examples include:

- Fraction
- Simulation
- Linear Accelerator
- Radiation Dose
- Treatment Planning
- Radiotherapy

Glossary content is database-driven and supports future multilingual expansion.

### AI Assistant

The RTTRACK Assistant provides general educational and navigation support.

The assistant may help users:

- Understand radiotherapy terminology
- Understand approved RTTRACK educational material
- Navigate the RTTRACK application
- Access relevant educational resources
- Understand general treatment preparation information
- Understand general symptom-related information
- Identify when contacting their treatment team may be appropriate

The AI assistant must not:

- Diagnose medical conditions
- Prescribe medication
- Modify treatment plans
- Recommend radiation doses
- Interpret medical imaging
- Replace healthcare professionals
- Present itself as a clinician
- Provide emergency diagnosis

AI credentials are handled server-side and must never be exposed in client-side code.

### Community

The community module provides:

- Discussion categories
- Patient posts
- Comments
- Replies
- Search
- Filtering
- Content reporting
- Moderation

### Expert Q&A

Verified healthcare professionals can participate in dedicated expert Q&A discussions.

Healthcare professional accounts require administrator verification.

Verified professionals are clearly identified within the platform.

### Healthcare Professional Portal

Authorised healthcare professionals can access relevant patient information based on their assigned permissions.

The professional portal includes:

- Patient dashboard
- Assigned patients
- Treatment plans
- Treatment sessions
- Treatment progress
- Symptom submissions
- Appointments
- Relevant alerts
- Expert Q&A

### Administration Portal

The administration portal provides system management capabilities including:

- User management
- Role management
- Treatment centre management
- Healthcare professional verification
- Education content management
- Glossary management
- Community moderation
- Notification management
- Research data management
- Analytics
- Audit logs
- System configuration

## User Roles

RTTRACK supports role-based access for:

- Patient
- Healthcare Professional
- Content Manager
- Community Moderator
- Administrator
- Super Administrator

Access permissions are enforced at the database level using Row Level Security rather than relying solely on frontend controls.

## Research Data

RTTRACK originated from a feasibility and acceptability evaluation involving 47 respondents.

The preliminary evaluation reported:

- 71% reported daily access to RTTRACK.
- 86% used the symptom tracker.
- 100% found the educational content useful.
- 71% rated navigation as very easy.
- 29% rated navigation as easy.
- 57% requested expert-facilitated Q&A.
- 43% requested improved topic organisation.
- 71% suggested interface layout refinements.

These findings represent the research evaluation and must remain separate from live RTTRACK operational data.

The 47 research respondents must not be represented as live patients unless independently and legitimately registered within the production system.

## Data Architecture

The system uses a relational database architecture built around entities including:

- Profiles
- Roles
- User roles
- Treatment centres
- Healthcare professionals
- Patient-professional assignments
- Treatment plans
- Treatment sessions
- Appointments
- Symptoms
- Symptom logs
- Medications
- Medication schedules
- Medication logs
- Education categories
- Education articles
- Education translations
- Glossary terms
- Glossary translations
- Community categories
- Community posts
- Community comments
- Expert profiles
- Notifications
- Notification preferences
- AI conversations
- AI messages
- Feedback
- Audit logs
- Research projects
- Research respondents
- Research responses
- Research metrics
- Patient consents
- System settings

## Technology Stack

### Frontend

React  
TypeScript  
Tailwind CSS  
shadcn/ui

### Backend

Supabase  
PostgreSQL  
Supabase Authentication  
Supabase Storage  
Supabase Edge Functions

### Security

Supabase Row Level Security  
Role-based access control  
Server-side handling of sensitive operations  
Secure authentication and session management  
Audit logging  
Input validation

### AI

Server-side AI integration through protected backend services.

AI API credentials must never be committed to the repository or exposed through frontend code.

## Development Principles

RTTRACK is being developed with the following principles:

1. Patient-centred design.
2. Database-first functionality.
3. Security by design.
4. Privacy by design.
5. Accessibility.
6. Mobile-first development.
7. Low-bandwidth awareness.
8. Maintainable architecture.
9. Clear separation between research and production data.
10. Evidence-aligned functionality.
11. Safe and responsible AI use.

## No Mock Clinical Data

The production application must not depend on mock clinical data to appear functional.

The following must be generated from actual database records:

- Patient information
- Treatment plans
- Treatment sessions
- Treatment progress
- Symptoms
- Medication records
- Appointments
- Notifications
- Community activity
- Professional assignments
- Dashboard metrics
- Analytics

Reference content such as education categories, glossary definitions, symptom definitions, and system configuration may be seeded as official RTTRACK content.

Research findings must be stored separately from production patient records.

## Security and Privacy

RTTRACK handles potentially sensitive patient information and therefore follows a privacy and security-oriented architecture.

Database access must be restricted using Row Level Security.

Patients must only access information belonging to their account.

Healthcare professionals must only access patients they are authorised to manage.

Administrative access must be controlled according to assigned roles.

Sensitive actions must be recorded through audit logging.

Secrets and API credentials must never be committed to the repository.

Environment variables must be used for protected configuration.

## Repository Structure

The repository contains the RTTRACK application source code, configuration, database-related resources, research resources, and supporting documentation.

A typical structure includes:

```text
rttrack/
├── src/
├── public/
├── supabase/
├── docs/
├── research/
├── tests/
├── .env.example
├── package.json
├── README.md
└── ...
