-- Enforce per-user access for private statement PDF objects.
-- Expected object key shape: "<auth.uid()>/<uuid>.pdf"

-- Idempotent cleanup
drop policy if exists "Users can read own statement pdf objects" on storage.objects;
drop policy if exists "Users can insert own statement pdf objects" on storage.objects;
drop policy if exists "Users can update own statement pdf objects" on storage.objects;
drop policy if exists "Users can delete own statement pdf objects" on storage.objects;

-- Read
create policy "Users can read own statement pdf objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'statement-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Insert
create policy "Users can insert own statement pdf objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'statement-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Update
create policy "Users can update own statement pdf objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'statement-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'statement-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Delete
create policy "Users can delete own statement pdf objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'statement-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
