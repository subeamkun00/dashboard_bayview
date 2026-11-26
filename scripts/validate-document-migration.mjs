import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// An optional, isolated test dependency; never connects to Supabase.
const { PGlite } = await import(
  process.argv[2]
    ? pathToFileURL(resolve(process.argv[2])).href
    : "@electric-sql/pglite"
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/002_document_management.sql",
    import.meta.url,
  ),
  "utf8",
);
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const unknown = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
for (const layout of ["live", "original"]) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id', true), '')::uuid$$;
      create table public.admins(id uuid primary key references auth.users(id));
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text);
      create table public.${layout === "live" ? "document_files" : "documents"}(
        id uuid primary key, document_name text not null,
        document_type text check(document_type in ('SOP','Job Description','Internal Policy','Training')),
        file_url text not null, file_size bigint default 0, uploaded_at timestamptz default now(),
        processing_status text default 'processing', embeddings_count integer default 0);
      create table public.document_embeddings(id uuid primary key, document_id uuid references public.${layout === "live" ? "document_files" : "documents"}(id) on delete cascade, content text, embedding real[]);
      insert into auth.users values('${admin}');
      insert into public.admins values('${admin}');
    `);
    if (layout === "live")
      await db.exec(
        "create table public.documents(id bigint generated always as identity primary key, title text, content text, metadata jsonb default '{}'::jsonb, embedding real[]);",
      );
    await db.exec(migration);
    // Rerunning must preserve tables, records, bucket config and publication.
    await db.exec(migration);
    await db.query("select set_config('test.user_id', $1, false)", [admin]);
    await db.query(
      "insert into public.document_files(id,document_name,document_type,file_url,rag_source_id) values($1::uuid,'Policy','Policy','test/original.txt',($1::uuid)::text)",
      [source],
    );
    if (layout === "live") {
      await db.query(
        "insert into public.documents(content,metadata,embedding) values('Chunk', jsonb_build_object('document_id',$1::text,'file_id',$1::text),array[1.0]::real[])",
        [source],
      );
      await db.exec(
        "insert into public.documents(content,metadata) values('Unrelated legacy chunk','{\"file_id\":\"unrelated-drive-file\"}')",
      );
      assert.equal(
        (
          await db.query(
            "select source_document_id from public.documents where metadata->>'document_id' = $1",
            [source],
          )
        ).rows[0].source_document_id,
        source,
      );
    } else
      await db.query(
        "insert into public.document_embeddings(id,document_id,content,embedding) values(gen_random_uuid(),$1,'Chunk',array[1.0]::real[])",
        [source],
      );
    await db.query(
      "update public.document_files set processing_status='ready' where id=$1",
      [source],
    );
    const ready = (
      await db.query(
        "select chunks_count,embeddings_count,last_processed_at from public.document_files where id=$1",
        [source],
      )
    ).rows[0];
    assert.equal(ready.chunks_count, 1);
    assert.equal(ready.embeddings_count, 1);
    assert.ok(ready.last_processed_at);
    await db.query(
      "update public.document_files set processing_status='processing' where id=$1",
      [source],
    );
    const processing = (
      await db.query(
        "select processing_started_at from public.document_files where id=$1",
        [source],
      )
    ).rows[0];
    assert.ok(processing.processing_started_at);
    await db.query("select set_config('test.user_id', '', false)");
    await assert.rejects(
      () => db.query("select public.delete_knowledge_document($1)", [source]),
      /Administrator access required/,
    );
    await db.query("select set_config('test.user_id', $1, false)", [admin]);
    assert.equal(
      (
        await db.query("select public.delete_knowledge_document($1) as path", [
          source,
        ])
      ).rows[0].path,
      "test/original.txt",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from public.document_files where id=$1",
          [source],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from public.document_embeddings where document_id=$1",
          [source],
        )
      ).rows[0].count,
      0,
    );
    if (layout === "live") {
      assert.equal(
        (await db.query("select count(*)::int as count from public.documents"))
          .rows[0].count,
        1,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into public.documents(content,metadata) values('Late chunk',jsonb_build_object('document_id',$1::text))",
            [source],
          ),
        /source does not exist/,
      );
      // Preserve the deployed metadata.file_id convention for older Drive
      // sources whose IDs differ from the dashboard's UUID.
      await db.query(
        "insert into public.document_files(id,document_name,document_type,file_url,rag_source_id,embeddings_count) values($1,'Drive policy','SOP','drive.txt','legacy-drive-source',1)",
        [source],
      );
      await db.exec(
        "insert into public.documents(content,metadata,embedding) values('Drive chunk','{\"file_id\":\"legacy-drive-source\"}',array[1.0]::real[])",
      );
      assert.equal(
        (
          await db.query(
            "select source_document_id from public.documents where metadata->>'file_id' = 'legacy-drive-source'",
          )
        ).rows[0].source_document_id,
        source,
      );
      await db.query("select public.delete_knowledge_document($1)", [source]);
      assert.equal(
        (await db.query("select count(*)::int as count from public.documents"))
          .rows[0].count,
        1,
      );
    }
    await db.query(
      "insert into public.document_files(id,document_name,document_type,file_url,embeddings_count) values($1,'Unlinked','SOP','legacy.txt',5)",
      [unknown],
    );
    await assert.rejects(
      () => db.query("select public.delete_knowledge_document($1)", [unknown]),
      /not linked/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from public.document_files where id=$1",
          [unknown],
        )
      ).rows[0].count,
      1,
    );
    await db.query(
      "update public.document_files set embeddings_count=0, processing_status='ready' where id=$1",
      [unknown],
    );
    await assert.rejects(
      () => db.query("select public.delete_knowledge_document($1)", [unknown]),
      /not linked/,
    );
    console.log(
      `${layout}: migration rerun, source linking, processing timestamps/counts, authorized atomic deletion, and legacy protection passed.`,
    );
  } finally {
    await db.close();
  }
}
