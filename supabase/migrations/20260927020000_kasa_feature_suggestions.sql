-- Feature suggestion system
-- Users can submit ideas for improvements and new features

create table if not exists public.feature_suggestions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('feature', 'improvement', 'reporting', 'other')),
  title text not null,
  description text not null,
  email text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'planned', 'in_progress', 'completed', 'rejected')),
  votes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  admin_notes text
);

-- RLS: Anyone can submit, only service role can update/view all
alter table public.feature_suggestions enable row level security;

do $$
begin
  create policy "anon_can_submit" on public.feature_suggestions
    for insert
    to public, anon, authenticated
    with check (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "service_role_can_manage" on public.feature_suggestions
    for all
    to service_role
    using (true)
    with check (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "anyone_can_view_approved" on public.feature_suggestions
    for select
    to public, anon, authenticated
    using (status != 'submitted');  -- Don't show unreviewed suggestions publicly yet
exception when duplicate_object then null;
end $$;

create index if not exists idx_feature_suggestions_status on public.feature_suggestions(status);
create index if not exists idx_feature_suggestions_category on public.feature_suggestions(category);
create index if not exists idx_feature_suggestions_created on public.feature_suggestions(created_at desc);

-- RPC: Submit a suggestion (anyone can call)
create or replace function public.kasa_submit_suggestion(
  p_category text,
  p_title text,
  p_description text,
  p_email text default null
)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_title is null or trim(p_title) = '' then
    return jsonb_build_object('success', false, 'error', 'Title is required');
  end if;

  if p_description is null or trim(p_description) = '' then
    return jsonb_build_object('success', false, 'error', 'Description is required');
  end if;

  if p_category not in ('feature', 'improvement', 'reporting', 'other') then
    return jsonb_build_object('success', false, 'error', 'Invalid category');
  end if;

  if length(p_title) > 100 then
    return jsonb_build_object('success', false, 'error', 'Title too long');
  end if;

  if length(p_description) > 1000 then
    return jsonb_build_object('success', false, 'error', 'Description too long');
  end if;

  insert into public.feature_suggestions (category, title, description, email)
  values (p_category, trim(p_title), trim(p_description), nullif(trim(p_email), ''))
  returning id into v_id;

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'message', 'Thank you for your suggestion'
  );
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end $$;

-- RPC: Get approved suggestions (public)
create or replace function public.kasa_get_suggestions(
  p_limit int default 50,
  p_offset int default 0,
  p_category text default null
)
returns table(id uuid, category text, title text, description text, status text, votes int, created_at timestamptz) language sql stable security definer set search_path = '' as $$
  select id, category, title, description, status, votes, created_at
  from public.feature_suggestions
  where status != 'submitted'
    and (p_category is null or category = p_category)
  order by votes desc, created_at desc
  limit p_limit
  offset p_offset;
$$;

-- RPC: Upvote a suggestion
create or replace function public.kasa_vote_suggestion(p_suggestion_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_updated int;
begin
  update public.feature_suggestions
  set votes = votes + 1
  where id = p_suggestion_id
  returning votes into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Suggestion not found');
  end if;

  return jsonb_build_object('success', true, 'votes', v_updated);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end $$;

-- Grant permissions
grant execute on function public.kasa_submit_suggestion(text, text, text, text) to anon, authenticated;
grant execute on function public.kasa_get_suggestions(int, int, text) to anon, authenticated;
grant execute on function public.kasa_vote_suggestion(uuid) to anon, authenticated;
