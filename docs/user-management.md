# Employee management setup

The Users page keeps the existing users table, stable user IDs,
activity timestamps, and question history. It adds a department/position editor
and independent assistant-access controls. Only workspace administrators with
role admin can make these changes; other workspace members retain read access.

## Inspect before applying SQL

In Supabase, open the project, then Table Editor, then users. Check the column
names, particularly nickname, position/job_title/position_id, and access fields.
Alternatively paste `docs/inspect-employee-schema.sql` into SQL Editor and run
it. It only lists schema definitions, not employee records or secrets. Share the
result so existing position tables/relationships can be reused where present.

The checked-in schema has no position registry or department-position foreign
key. The current editor derives department options from existing employee values
and the dashboard's department configuration, and position options from actual
users.position values. It does not populate a live dropdown with fictitious hotel
job titles. Empty position data needs the actual position list before editing can
work. If the deployed database uses a position table or different columns, align
the options loader and validation to those relationships before installing.

## Apply the migration manually

After verifying the actual schema, apply only
`supabase/migrations/003_user_management.sql` in the existing Supabase project.
Do not rerun the initial schema. The migration is rerunnable, adds missing
nickname/position/access_enabled fields without replacing users, and stops if a
known alternative position/access column needs review. Access is not derived
from active/inactive. Explicit disabled values are preserved.

`PATCH /api/users` uses the verified administrator session and a stable user UUID.
Profile changes update department, position and an explicitly changed department-head flag.
Enabling changes only access_enabled. Names, activity timestamps, and history are not
rewritten. Disabling intentionally clears the employee's LINE/email linkage (see below).
RLS and a trigger also protect direct Data API mutations. No service
role key is added to the web application.

## Disable and reset LINE linkage (migration 018)

After migrations 003, 006 and 008 are installed, run
`supabase/migrations/018_disable_employee_reset_link.sql` in Supabase SQL Editor.
It is rerunnable and does not bulk-modify existing employees. This migration has
not been applied to the live database by the dashboard implementation.

Disable requires confirmation and calls the administrator-only
`disable_employee_and_reset_link` RPC. One database transaction sets
`access_enabled = false`, clears `auth_user_id`, `line_user_id`, `claimed_at`,
`line_id` and `email`, and revokes the employee's pending invite code. It preserves
the employee row, profile fields, question history and Supabase Auth account.
If the RPC fails or is not installed, the API returns an error without falling
back to a partial access-only update.

Enabling never restores a previous LINE/email link. Issue a fresh invite code
and have the employee complete the existing LINE sign-up flow again. The account
will display Unverified until then. Disabling does not globally revoke an Auth
session or block the LINE account itself; it removes the employee association.

## Required LINE/n8n gate (not deployed by the dashboard)

The actual assistant workflow is not in this repository. Export its JSON so the
gate can be inserted at the correct point. Disabling access in the dashboard is
not sufficient to stop an external workflow that ignores that field.

1. Verify the LINE webhook signature using the existing workflow.
2. Find/register the user by the stable LINE sender ID. Routine upserts must not
   send access_enabled, department, or position defaults for existing users.
3. With the workflow's existing trusted Supabase credential, call the RPC:

   ```json
   { "p_line_user_id": "THE_VERIFIED_LINE_SENDER_ID" }
   ```

   Endpoint: `/rest/v1/rpc/can_assistant_respond`.

4. Continue to retrieval and the AI model only if the returned JSON value is
   literally true. False, unknown users, timeouts, and errors must stop the AI
   path. An optional fixed access-denied reply may be sent without calling AI.
5. Check again immediately before replying if long processing is possible, so a
   disable action during model execution is honored. Do not log a new assistant
   question after a denial.

The migration grants this RPC only to service_role, not browser sessions or anon.
A chat_logs insert trigger is a backstop against bypasses/races; it is not a
replacement for the pre-model gate. Existing history remains stored and readable.
After a disable/reset, re-enabling alone cannot make the old LINE identity pass
the gate; the employee must complete sign-up again first.

## UI behavior and validation

The Access badge has three display states. `Disabled` takes precedence whenever
`access_enabled` is false, including employees who have not completed sign-up.
For employees with access enabled, `Unverified` is displayed until
the existing LINE sign-up flow records both a non-empty `line_user_id` and a
valid `claimed_at` timestamp. A LINE ID, activity, or an enabled access flag on
its own is not proof that sign-up was completed. After verification, the badge
shows `Enabled` when access is enabled. All
three states are available in the access filter. This is a derived UI state,
not a new database status, and displaying a badge does not rewrite records or change the
LINE workflow's authorization gate. The editor retains the independent access
setting while an employee is Unverified; sign-up never enables access itself.

The table shows name/nickname, department, position, computed questions, access,
and one Edit button. Existing user-details/history navigation stays on the name
link. Search, department/access filters, sorting and both pagination controls
remain synchronized. Empty/load-error states have clear/retry actions.

Desktop uses a side-by-side editor; smaller screens use a native modal drawer.
Cancel, close, Escape, and changing the selected user require confirmation when
draft values would be discarded. Access actions do not save or erase draft
department/position changes. Duplicate network submissions are blocked and failed
saves keep the draft intact. Demo edits persist only in the existing demo store;
fictional demo job titles do not seed the live database.
