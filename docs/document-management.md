# Documents page setup

The rebuilt `/documents` page uses the application's existing `document_files`
metadata table, private `knowledge-base` Storage bucket, `/api/documents` API,
and `N8N_DOCUMENT_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` configuration.

## Department-based interface

Documents are presented in exactly nine full-width department accordions:
Human Resources, Executive Office, Accounting, Front Office, Housekeeping,
Food & Beverage, Main Kitchen, Engineering, and IT. Both the list and upload
dropdown use this configuration in `src/lib/documents.ts`; employee departments
do not add extra groups. The existing schema stores names in
`document_files.department`, not separate department IDs; no department table
or synthetic IDs are created. Files with an old or missing department remain
searchable and accessible under Documents to organize. Their original metadata
and files are preserved, not deleted or automatically reassigned.

Only one Upload file button appears in the page header. The upload dialog
requires a department and one PDF/DOCX/TXT file up to the backend's shared 20 MB
limit. It supplies the existing required category as Other, retains the original
filename, and sends the file through the unchanged API and RAG workflow. The
server, not the form, determines uploader identity. The dialog reports transfer
progress, blocks repeated submissions, and retains the selection on failure.

The Uploaded by column resolves the current administrator profile by uploaded_by,
then uses its saved name snapshot if available, otherwise Unknown user. Updated
uses the latest recorded updated_at, last_processed_at, or uploaded_at timestamp
and displays it in Asia/Bangkok time. No update dates are fabricated.

Search matches department names and filenames and expands matching departments.
Sections keep their full document counts; matching results are paginated at ten
per department when needed. Zero-document departments remain visible. Processing
status is not a table column; ingestion errors and Reprocess remain available
under document details. The menu supports PDF/TXT preview, details, download,
and confirmed deletion. DOCX can be downloaded, not rendered in-browser. Rename
is omitted because the existing API does not support it.

## Apply the migration

In the **existing Bayview Supabase project**, run
`supabase/migrations/002_document_management.sql` in the SQL editor. Do not rerun
`001_initial.sql` on that project. For a fresh database, run 001 then 002.

The migration adds metadata columns to `document_files`, enables its realtime
publication and authenticated workspace access, and reuses the private bucket.
It preserves any existing bucket configuration and files. Verify the existing
bucket is private, allows PDF/DOCX/TXT, and has a file size limit of at least
20 MB. An anonymous storage listing cannot confirm private bucket configuration.

The original repository SQL used `documents` for file metadata. On fresh installs,
002 renames that metadata table to `document_files`, preserving its foreign keys.
The deployed project instead already has `document_files`, while `documents`
contains n8n vector rows with `content`, `embedding`, and JSON `metadata`.
002 leaves that vector table in place and adds a nullable `source_document_id`
foreign key to connect rows to their original files. No second vector store is
created. If the old `document_embeddings` table is present, it is also supported.

## Existing workflow contract

Uploads and reprocessing send the unchanged payload and secret header:

```json
{ "document_id": "DOCUMENT-UUID", "action": "reprocess" }
```

The workflow must:

1. Validate `x-webhook-secret`, then fetch the `document_files` row. Abort if the
   row no longer exists. `file_url` is the object's path in `knowledge-base`.
2. Read the original, extract text, chunk it, and create embeddings using the
   existing model and vector dimension.
3. Serialize jobs per document. Transactionally replace that source's existing
   chunks rather than appending duplicate embeddings. For the live `documents`
   table, retain the existing metadata fields and include both
   `metadata.document_id` and `metadata.file_id`, using the `document_files.id`
   for new dashboard uploads. The source-link trigger then fills
   `source_document_id`. The explicit `document_id` also rejects a late insert
   from a job whose file was deleted.
4. After vectors are committed, update `document_files.processing_status` to
   `ready`. The migration records the completion date and counts linked chunks
   and embeddings. On error, set `processing_status` to `failed` and write a
   useful, non-sensitive `processing_error` for the administrator.

The n8n workflow definition is not checked into this repository. Its configuration
was found locally, but its extraction/embedding nodes could not be inspected or
executed without workflow access. Verify the source metadata above in the
existing workflow before a live upload. The UI never labels an unprocessed live
upload Ready, and a missing/rejected webhook is recorded as Failed.

The upload API accepts PDF, DOCX, and TXT up to 20 MB, saves the optional title,
original filename, category, department, notes, and verified uploader identity.
It checks that the migration exists before uploading a Storage object. Reprocess
uses a conditional status update so two requests cannot claim the same job.

## Legacy source linking and deletion

The migration links existing vector rows only by exact `metadata.document_id`
or `metadata.file_id`. It never guesses using a document title.

For a legacy file whose vectors use a different source ID (for example a Google
Drive ID), set `document_files.rag_source_id` to the existing `metadata.file_id`
in the SQL editor. This value must identify exactly one original document.
Existing unrelated vector records are preserved. Unknown department, uploader,
and completion dates appear as not recorded rather than invented values.

Confirmed deletion invokes `delete_knowledge_document` to remove linked vector
rows, old `document_embeddings` rows if present, and file metadata in one database
transaction. A Ready document, or one that claims existing embeddings, cannot be
deleted if no vectors are linked until its source ID is corrected. Original-file cleanup
follows vector deletion, so a storage outage does not keep the source retrievable.
If cleanup fails, the API reports that separately; an administrator can remove
the leftover original at `<document UUID>/original.<extension>` in Storage.

Realtime refreshes the workspace. While processing, the Documents page also
polls every five seconds when visible, and refreshes on window focus. Upload,
reprocess, and deletion refresh immediately.

## Local validation

`npm test` includes document UI and isolated API tests. To run the migration
against both supported schema layouts without touching Supabase:

```sh
npm install --prefix .tmp-document-validation --no-save --no-package-lock @electric-sql/pglite
node scripts/validate-document-migration.mjs .tmp-document-validation/node_modules/@electric-sql/pglite/dist/index.js
```

This checks rerunnability, source links, status metadata/counts, administrator
authorization, linked-vector deletion, preservation of unrelated records, and
rejection of late jobs and unlinked legacy deletion. It does not verify the live
n8n extraction or embedding pipeline.

In the existing clearly marked demo workspace, file uploads use the preexisting
local file store. They remain Failed with an explanation that AI processing needs
a connected workspace; the demo does not fabricate successful RAG indexing.
