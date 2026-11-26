# Sending a document's original file in LINE

For long procedures (for example "how to install TrueNAS") the assistant gives a
short overview and asks "Do you want the full step-by-step file?". When the
employee agrees, it replies with a temporary download link to the file that was
uploaded in **SOP Documents**.

How it works

1. n8n tool `get_document_link` (attached to the RAG AI Agent) calls the Supabase
   Edge Function `document-link` with the employee's LINE user id and the file
   name / keywords.
2. The function looks the employee up, lists the documents that employee may read
   (`public.accessible_documents`, same rule as the AI search: own position, own
   department, whole hotel, or everything in the department for department
   heads) and picks the best match. A PDF is preferred over a TXT of the same
   document. Answers saved from admin replies are never offered.
3. It returns a signed link (valid 24 hours, change `LINK_SECONDS` in
   `supabase/functions/document-link/index.ts`). The storage bucket stays private.

Setup (once)

1. Run `supabase/migrations/023_accessible_documents.sql` in the Supabase SQL Editor.
2. Supabase Dashboard → Edge Functions → Deploy a new function → **Via Editor**.
   Name it exactly `document-link`, paste `supabase/functions/document-link/index.ts`
   and deploy. In the function's settings turn **Verify JWT off** (the function
   checks its own secret instead).
3. Edge Functions → Secrets → add `DOCUMENT_LINK_SECRET`. Use the same value as
   `N8N_WEBHOOK_SECRET`.
4. In n8n, open the credential "Header Auth account 2" (used by the node
   `get_document_link`). Header name `x-webhook-secret`, value = the same secret.
5. Import the updated n8n workflow and keep it active.

Test it: ask the bot for a long guide, answer "ตกลง", and open the link.
