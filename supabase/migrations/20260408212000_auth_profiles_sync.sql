begin;

create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);

  return new;
end;
$$;

drop trigger if exists on_auth_user_synced on auth.users;

create trigger on_auth_user_synced
after insert or update on auth.users
for each row
execute procedure public.handle_auth_user_sync();

commit;
