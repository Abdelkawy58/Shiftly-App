-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste -> Run

create table if not exists kv_store (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- Allow the app (using the public "anon" key) to read and write this table.
-- This is a small internal tool, so we keep this simple. The app itself still
-- gates access with the owner/viewer/employee passwords in Settings.
alter table kv_store enable row level security;

create policy "Allow anon read" on kv_store
  for select using (true);

create policy "Allow anon write" on kv_store
  for insert with check (true);

create policy "Allow anon update" on kv_store
  for update using (true);

create policy "Allow anon delete" on kv_store
  for delete using (true);
