-- Fingerprint uploaded PDF bytes to skip re-parsing duplicates per user.
alter table public.user_statements
  add column if not exists content_sha256 text;

comment on column public.user_statements.content_sha256 is 'SHA-256 hex of raw PDF bytes; used to reject duplicate uploads before parsing.';

create unique index if not exists user_statements_user_id_content_sha256_uniq
  on public.user_statements (user_id, content_sha256)
  where content_sha256 is not null;
