begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 組織・ユーザー
-- ============================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  default_llm text not null default 'claude-sonnet-4-6',
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table organization_members (
  organization_id uuid references organizations on delete cascade,
  user_id uuid references profiles on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations on delete cascade not null,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  token text unique not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 会議
-- ============================================================

create table meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations on delete cascade not null,
  title text not null,
  meeting_date timestamptz,
  audio_url text,
  duration_seconds int,
  status text not null default 'pending'
    check (status in ('pending', 'transcribing', 'generating', 'completed', 'failed')),
  llm_used text,
  raw_transcript text,
  corrected_transcript text,
  minutes_markdown text,
  decisions jsonb,
  todos jsonb,
  open_questions jsonb,
  detected_terms jsonb,
  new_term_candidates jsonb,
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meetings_organization_id_idx on meetings (organization_id);
create index meetings_created_at_desc_idx on meetings (created_at desc);

-- ============================================================
-- リアルタイムセッション
-- ============================================================

create table realtime_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings on delete cascade not null,
  organization_id uuid references organizations on delete cascade not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index realtime_sessions_organization_id_idx on realtime_sessions (organization_id);

-- ============================================================
-- 専門用語辞書（v3: 発音バリエーション対応）
-- ============================================================

create table glossary_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations on delete cascade not null,

  term text not null,
  reading text,
  pronunciation_variants text[],
  definition text,
  detailed_explanation text,
  full_form text,
  category text,
  aliases text[],

  occurrence_count int not null default 0,
  correction_count int not null default 0,
  last_used_at timestamptz,

  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, term)
);

create index glossary_terms_organization_id_idx on glossary_terms (organization_id);
create index glossary_terms_org_occurrence_idx on glossary_terms (organization_id, occurrence_count desc);

-- ============================================================
-- 訂正履歴（v3: 発音違いフラグ + 文脈キーワード）
-- ============================================================

create table transcription_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations on delete cascade not null,
  meeting_id uuid references meetings on delete set null,
  glossary_term_id uuid references glossary_terms on delete cascade,

  wrong_text text not null,
  correct_text text not null,
  context text,

  is_pronunciation_variant boolean not null default false,
  context_keywords text[],

  apply_globally boolean not null default true,

  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create index transcription_corrections_organization_id_idx on transcription_corrections (organization_id);
create index transcription_corrections_org_apply_idx on transcription_corrections (organization_id, apply_globally);

-- ============================================================
-- コメント機能
-- ============================================================

create table comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations on delete cascade not null,
  meeting_id uuid references meetings on delete cascade not null,
  parent_comment_id uuid references comments on delete cascade,

  block_id text,
  selected_text text,
  body text not null,
  mentioned_user_ids uuid[],

  is_resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references profiles,

  created_by uuid references profiles not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_meeting_id_idx on comments (meeting_id);
create index comments_meeting_block_id_idx on comments (meeting_id, block_id);
create index comments_parent_comment_id_idx on comments (parent_comment_id);

-- ============================================================
-- ユーティリティ関数
-- ============================================================

create or replace function set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger meetings_set_updated_at
before update on meetings
for each row
execute function set_updated_at_timestamp();

create trigger glossary_terms_set_updated_at
before update on glossary_terms
for each row
execute function set_updated_at_timestamp();

create trigger comments_set_updated_at
before update on comments
for each row
execute function set_updated_at_timestamp();

create or replace function is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
  );
$$;

grant execute on function is_org_member(uuid) to authenticated;

create or replace function has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.role = any (p_roles)
  );
$$;

grant execute on function has_org_role(uuid, text[]) to authenticated;

create or replace function object_org_id(object_name text)
returns uuid
language plpgsql
stable
as $$
declare
  org_folder text;
begin
  org_folder := (storage.foldername(object_name))[1];

  if org_folder is null then
    return null;
  end if;

  if org_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return org_folder::uuid;
end;
$$;

grant execute on function object_org_id(text) to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;
alter table invitations enable row level security;
alter table meetings enable row level security;
alter table realtime_sessions enable row level security;
alter table glossary_terms enable row level security;
alter table transcription_corrections enable row level security;
alter table comments enable row level security;

-- organizations
create policy "Members can view organizations"
  on organizations for select
  using (is_org_member(id));

create policy "Authenticated users can create organizations"
  on organizations for insert
  with check (auth.role() = 'authenticated');

create policy "Admins can update organizations"
  on organizations for update
  using (has_org_role(id, array['owner', 'admin']))
  with check (has_org_role(id, array['owner', 'admin']));

create policy "Owners can delete organizations"
  on organizations for delete
  using (has_org_role(id, array['owner']));

-- profiles
create policy "Users can view own profile"
  on profiles for select
  using (id = auth.uid());

create policy "Members can view shared organization profiles"
  on profiles for select
  using (
    exists (
      select 1
      from organization_members me
      join organization_members other
        on me.organization_id = other.organization_id
      where me.user_id = auth.uid()
        and other.user_id = profiles.id
    )
  );

create policy "Users can insert own profile"
  on profiles for insert
  with check (id = auth.uid());

create policy "Users can update own profile"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- organization_members
create policy "Members can view organization memberships"
  on organization_members for select
  using (is_org_member(organization_id));

create policy "Owners and admins can add members"
  on organization_members for insert
  with check (
    has_org_role(organization_id, array['owner', 'admin'])
    or (
      user_id = auth.uid()
      and role = 'owner'
      and not exists (
        select 1
        from organization_members existing
        where existing.organization_id = organization_members.organization_id
      )
    )
  );

create policy "Owners and admins can update members"
  on organization_members for update
  using (has_org_role(organization_id, array['owner', 'admin']))
  with check (has_org_role(organization_id, array['owner', 'admin']));

create policy "Owners and admins can remove members"
  on organization_members for delete
  using (has_org_role(organization_id, array['owner', 'admin']));

-- invitations
create policy "Members can view invitations in their organizations"
  on invitations for select
  using (
    is_org_member(organization_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Owners and admins can create invitations"
  on invitations for insert
  with check (has_org_role(organization_id, array['owner', 'admin']));

create policy "Owners and admins can update invitations"
  on invitations for update
  using (has_org_role(organization_id, array['owner', 'admin']))
  with check (has_org_role(organization_id, array['owner', 'admin']));

create policy "Owners and admins can delete invitations"
  on invitations for delete
  using (has_org_role(organization_id, array['owner', 'admin']));

-- meetings
create policy "Members can view meetings"
  on meetings for select
  using (is_org_member(organization_id));

create policy "Members can insert meetings"
  on meetings for insert
  with check (is_org_member(organization_id));

create policy "Members can update meetings"
  on meetings for update
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy "Owners and admins can delete meetings"
  on meetings for delete
  using (has_org_role(organization_id, array['owner', 'admin']));

-- realtime_sessions
create policy "Members can view realtime sessions"
  on realtime_sessions for select
  using (is_org_member(organization_id));

create policy "Members can insert realtime sessions"
  on realtime_sessions for insert
  with check (is_org_member(organization_id));

create policy "Members can update realtime sessions"
  on realtime_sessions for update
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy "Owners and admins can delete realtime sessions"
  on realtime_sessions for delete
  using (has_org_role(organization_id, array['owner', 'admin']));

-- glossary_terms
create policy "Members can view glossary terms"
  on glossary_terms for select
  using (is_org_member(organization_id));

create policy "Members can insert glossary terms"
  on glossary_terms for insert
  with check (is_org_member(organization_id));

create policy "Members can update glossary terms"
  on glossary_terms for update
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy "Owners and admins can delete glossary terms"
  on glossary_terms for delete
  using (has_org_role(organization_id, array['owner', 'admin']));

-- transcription_corrections
create policy "Members can view transcription corrections"
  on transcription_corrections for select
  using (is_org_member(organization_id));

create policy "Members can insert transcription corrections"
  on transcription_corrections for insert
  with check (is_org_member(organization_id));

create policy "Members can update transcription corrections"
  on transcription_corrections for update
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy "Owners and admins can delete transcription corrections"
  on transcription_corrections for delete
  using (has_org_role(organization_id, array['owner', 'admin']));

-- comments
create policy "Members can view comments"
  on comments for select
  using (is_org_member(organization_id));

create policy "Members can insert comments"
  on comments for insert
  with check (
    is_org_member(organization_id)
    and created_by = auth.uid()
  );

create policy "Members can update comments"
  on comments for update
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy "Authors can delete own comments"
  on comments for delete
  using (created_by = auth.uid());

-- ============================================================
-- Storage bucket (audio)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do update
set public = excluded.public;

-- storage.objects is managed by Supabase and already has RLS enabled.
-- Avoid ALTER here because migration role may not own the table.

create policy "Members can read audio objects"
  on storage.objects for select
  using (
    bucket_id = 'audio'
    and object_org_id(name) is not null
    and is_org_member(object_org_id(name))
  );

create policy "Members can upload audio objects"
  on storage.objects for insert
  with check (
    bucket_id = 'audio'
    and object_org_id(name) is not null
    and is_org_member(object_org_id(name))
  );

create policy "Members can update audio objects"
  on storage.objects for update
  using (
    bucket_id = 'audio'
    and object_org_id(name) is not null
    and is_org_member(object_org_id(name))
  )
  with check (
    bucket_id = 'audio'
    and object_org_id(name) is not null
    and is_org_member(object_org_id(name))
  );

create policy "Members can delete audio objects"
  on storage.objects for delete
  using (
    bucket_id = 'audio'
    and object_org_id(name) is not null
    and is_org_member(object_org_id(name))
  );

-- ============================================================
-- RPC関数
-- ============================================================

create or replace function increment_term_occurrence(
  p_organization_id uuid,
  p_term text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update glossary_terms
  set
    occurrence_count = occurrence_count + 1,
    last_used_at = now()
  where organization_id = p_organization_id
    and term = p_term;
end;
$$;

grant execute on function increment_term_occurrence(uuid, text) to authenticated;

create or replace function increment_term_correction(
  p_term_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update glossary_terms
  set correction_count = correction_count + 1
  where id = p_term_id;
end;
$$;

grant execute on function increment_term_correction(uuid) to authenticated;

commit;
