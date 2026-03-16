-- Remove principal_remaining from user_statements (statement is metadata only).
alter table public.user_statements drop column if exists principal_remaining;
