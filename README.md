# Bayview AI admin dashboard

A responsive hotel knowledge assistant dashboard built with Next.js App Router, TypeScript, Tailwind CSS, Recharts, Lucide, and Supabase.

## Run locally

Requires Node.js 20.9 or newer (Node.js 22 recommended).

```sh
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase environment variables, the dashboard runs in **clearly labeled demo mode** with 248 employees, 12,864 conversations, and sample knowledge records. All data totals and charts derive from those records, and profile edits persist in local storage.

## Pages and interactions

- `/` — overview, date ranges, daily/weekly/monthly activity, system status, active users, department question totals, recent conversations, report export.
- `/users` — name/nickname search, department and assistant-access filters, question-count sorting, synchronized pagination, and an administrator-only employee editor for department, position, and Enabled/Disabled access.
- `/users/[id]` — employee details, searchable conversation history, source links, history export.
- `/chat-logs` — question/answer search, department/status/date filters, newest/oldest sorting, details dialog, CSV export of filtered results.
- `/documents` — knowledge base uploads, search and category/department/status/date filters, sorting, document details, downloads, reprocessing, and confirmed deletion of linked knowledge records.
- `/settings` — admin profile, assistant configuration, role management, connection health checks.
- `/login`, `/reset-password` — Supabase email/password authentication and password recovery. The demo has a separate explicit entry button.
- The topbar keeps the page breadcrumb and administrator profile menu. Page-specific search, navigation and dialogs support keyboard access, and layouts adapt down to 375 px.

## Connect Supabase

Employee editing additionally requires schema inspection and
`supabase/migrations/003_user_management.sql`. See [Employee setup](docs/user-management.md)
for the real position-data requirement and the LINE/n8n pre-AI access gate.
The dashboard alone does not enforce access in an external workflow that ignores
that field; connect and test the gate before relying on Disable user in production.

1. For a new Supabase project, run `supabase/migrations/001_initial.sql` followed by `supabase/migrations/002_document_management.sql` in the SQL editor. For the existing Bayview project, run only 002. The document migration extends the existing file metadata and reuses the storage bucket and vector tables. See [Documents setup](docs/document-management.md) for the migration and workflow requirements.
2. Copy `.env.example` to `.env.local` and set **both** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These are public client credentials, protected by RLS. Do not place service-role keys in public environment variables.
3. Create the first administrator in **Supabase Authentication → Users**, then run this SQL with that account’s actual ID/email:

   ```sql
   insert into public.admins (id, email, display_name, role)
   values ('AUTH-USER-UUID', 'admin@your-hotel.com', 'Your Name', 'admin');
   ```

4. Set the Supabase Auth **Site URL** to your app origin. Add `http://localhost:3000/auth/callback` and your deployed `/auth/callback` URL to the allowed redirect URLs. For recovery links that work across browsers, customize the password recovery email to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. Otherwise the default PKCE recovery link should be opened in the browser where the reset was requested.
5. Restart the app. All dashboard routes now require a verified Supabase user with an entry in `admins`. A normal authenticated user without an admin record has no dashboard access.
6. Provision HR, IT, and Training accounts through Supabase Auth and add them to `admins`. Administrators can update other users’ roles in Settings. Self role changes and self-service privilege escalation are blocked at the database level.

**No service-role key is used by this web application.** Its server routes use the signed-in user’s cookie session and enforce RLS. New administrator provisioning and trusted LINE/n8n ingestion happen outside the browser using your backend credentials.

## Connect the existing LINE / n8n / Gemini workflow

The dashboard is the administration layer; it does not deploy the LINE bot or an n8n instance. Configure the existing workflow to:

1. Upsert employees into `users` by `line_user_id`, updating `last_seen` on activity.
2. Insert completed interactions into `chat_logs`, with `response_status` set to `success` or `failed` and a category for reporting.
3. Read `system_settings` for the hotel name, default response language, and retrieval limit if you want those settings to influence the assistant.
4. For document processing, set server-only `N8N_DOCUMENT_WEBHOOK_URL` and `N8N_WEBHOOK_SECRET`. The dashboard sends:

   ```json
   { "document_id": "DOCUMENT-UUID", "action": "reprocess" }
   ```

   Validate the `x-webhook-secret` request header in n8n. Fetch the `document_files` row and its private Storage object (`file_url` contains a storage path). Extract text, generate embeddings, and transactionally replace that source’s existing vectors in the current RAG table. The live project uses `documents` with `metadata.file_id`; include `metadata.document_id` for dashboard uploads so source linking and late-job protection apply. Update `processing_status` to `ready` after indexing, or `failed` with `processing_error` on failure. The legacy `document_embeddings` table is also supported. See [Documents setup](docs/document-management.md) for the full contract.

   Use idempotent processing and serialize jobs per document. If a document was deleted while a job was running, abort the job; the document foreign key prevents orphan embeddings. Deleting a document cascades to its stored embeddings. Existing chat source labels remain in conversation history.

5. Set optional `LINE_CHANNEL_ACCESS_TOKEN`, `GEMINI_API_KEY`, and `N8N_HEALTH_URL` for server-side health checks. The n8n health endpoint should return an HTTP 2xx response when healthy. Unconfigured services display **Not set**. Checks verify service reachability and credentials, not the entire message delivery pipeline.

Live data updates through Supabase Realtime. The API pages through Supabase’s 1,000-row response limit so counts and CSV exports are complete. This first implementation loads the authorized workspace dataset into memory for interactive filtering; for very large conversation archives, replace this with server-side paginated queries and aggregate reporting RPCs before scaling.

## Validation

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

The Playwright suite covers navigation, user search and filters, conversation details, exports, document uploads and metadata, original downloads, confirmed deletion, document filters and API behavior, settings persistence, demo login, mobile layout, and rejection of unauthenticated API access. It uses installed Chrome by default; set `PLAYWRIGHT_CHANNEL=msedge` for Edge, or install Chromium with `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`.

Supabase integration and RLS require a configured project for end-to-end verification. A transactional SQL policy check is provided in `supabase/tests/rls.sql`; run it against a development project after applying the migration. Review deployment settings, configure HTTPS and Auth URL allowlists, and connect the actual ingestion workflow before using this with real employee data.

Implementation references: [Next.js App Router](https://nextjs.org/docs/app/getting-started), [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side), and [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
