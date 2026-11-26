import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.argv[2]
    ? pathToFileURL(resolve(process.argv[2])).href
    : "@electric-sql/pglite"
);
const migration = await readFile(
  new URL("../supabase/migrations/003_user_management.sql", import.meta.url),
  "utf8",
);
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const hr = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const employee = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('test.role',true),''),'service_role')$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.admins(id uuid primary key, role text);
    insert into public.admins values('${admin}','admin'),('${hr}','hr');
    create table public.users(id uuid primary key, line_user_id text unique, display_name text,
      department text, first_seen timestamptz default now(), last_seen timestamptz default now(),
      created_at timestamptz default now(), status text default 'inactive');
    create table public.chat_logs(id integer primary key, user_id uuid references public.users(id),question text);
    insert into public.users(id,line_user_id,display_name,department) values('${employee}','line-employee','Employee','Front Office');
    insert into public.chat_logs values(1,'${employee}','Existing question');
    grant select on public.users,public.admins to authenticated;
    create policy "Members read employees" on public.users for select to authenticated using (true);
    grant select,insert,update on public.users to service_role;
    grant select,insert on public.chat_logs to service_role;
  `);
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(
    (await db.query("select access_enabled from public.users")).rows[0]
      .access_enabled,
    true,
  );
  await db.exec(
    `select set_config('test.uid','${admin}',false),set_config('test.role','authenticated',false); set role authenticated;`,
  );
  await db.query(
    "update public.users set department='Housekeeping',position='Room attendant',access_enabled=false where id=$1",
    [employee],
  );
  const snapshot = (await db.query("select * from public.users")).rows[0];
  assert.equal(snapshot.department, "Housekeeping");
  assert.equal(snapshot.status, "inactive");
  assert.equal(snapshot.access_enabled, false);
  await assert.rejects(
    db.query(
      "update public.users set line_user_id='another-line-id' where id=$1",
      [employee],
    ),
    /permission denied|Integration identifiers/,
  );
  await assert.rejects(
    db.query("select public.can_assistant_respond('line-employee')"),
    /permission denied/,
  );
  await db.exec(
    `reset role; select set_config('test.uid','${hr}',false),set_config('test.role','authenticated',false); set role authenticated;`,
  );
  const denied = await db.query(
    "update public.users set access_enabled=true where id=$1 returning id",
    [employee],
  );
  assert.equal(denied.rows.length, 0);
  await db.exec(
    "reset role; select set_config('test.uid','',false),set_config('test.role','service_role',false); set role service_role;",
  );
  assert.equal(
    (
      await db.query(
        "select public.can_assistant_respond('line-employee') as allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select public.can_assistant_respond('unknown-line-user') as allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await assert.rejects(
    db.query("insert into public.chat_logs values(2,$1,'Blocked question')", [
      employee,
    ]),
    /does not have access/,
  );
  await assert.rejects(
    db.query("update public.users set access_enabled=true where id=$1", [
      employee,
    ]),
    /Only workspace administrators/,
  );
  await db.query(
    "update public.users set display_name='Updated LINE name',last_seen=now() where id=$1",
    [employee],
  );
  assert.equal(
    (await db.query("select count(*)::int as total from public.chat_logs"))
      .rows[0].total,
    1,
  );
  await db.exec(
    `reset role; select set_config('test.uid','${admin}',false),set_config('test.role','authenticated',false); set role authenticated;`,
  );
  await db.query("update public.users set access_enabled=true where id=$1", [
    employee,
  ]);
  await db.exec(
    "reset role; select set_config('test.uid','',false),set_config('test.role','service_role',false); set role service_role;",
  );
  assert.equal(
    (
      await db.query(
        "select public.can_assistant_respond('line-employee') as allowed",
      )
    ).rows[0].allowed,
    true,
  );
  await db.query(
    "insert into public.chat_logs values(2,$1,'Enabled question')",
    [employee],
  );
  await db.exec("reset role;");
  await db.exec(migration);
  assert.equal(
    (await db.query("select count(*)::int as total from public.users")).rows[0]
      .total,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int as total from public.chat_logs"))
      .rows[0].total,
    2,
  );
  console.log(
    "User migration passed: rerunnable, protected administrator updates, independent access, preserved history, private pre-AI gate, and blocked disabled-user requests.",
  );
} finally {
  await db.close();
}
