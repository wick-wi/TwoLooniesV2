-- Add tags array for flexible, cross-category grouping (e.g. waterloo-condo, ski-trip)
alter table public.transactions
  add column if not exists tags text[] not null default '{}';

-- RPC: return deduplicated, sorted tags for a user (avoids pulling all rows into Python)
create or replace function get_unique_user_tags(p_user_id uuid)
returns table(tag text) language sql stable security definer as $$
  select distinct unnest(tags) as tag
  from public.transactions
  where user_id = p_user_id
  order by tag;
$$;
