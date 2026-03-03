-- Add address to profiles
alter table public.profiles add column if not exists address text;
