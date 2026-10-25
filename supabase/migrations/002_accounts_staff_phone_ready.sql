-- Aesthetic Manager v0.8 incremental upgrade. Existing customers / reservations / shop / auth users are preserved.
-- Run after 001_ongeol_initial.sql. Do NOT drop the existing shop_members or shop_states tables.

create table if not exists public.staff_profiles (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid not null references public.shops(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 80),
 title text not null default '피부관리사' check (char_length(btrim(title)) between 1 and 80),
 access_role text not null default 'therapist' check (access_role in ('manager','therapist')),
 auth_user_id uuid references auth.users(id) on delete set null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(shop_id,id)
);
create unique index if not exists aesthetic_one_profile_per_account on public.staff_profiles(shop_id,auth_user_id) where auth_user_id is not null;
create index if not exists aesthetic_staff_shop_idx on public.staff_profiles(shop_id,active);
alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon,authenticated;
grant select on public.staff_profiles to authenticated;
drop policy if exists aesthetic_staff_member_read on public.staff_profiles;
create policy aesthetic_staff_member_read on public.staff_profiles for select to authenticated
  using(public.ongeol_is_member(shop_id));

alter table public.shop_invites add column if not exists staff_id uuid references public.staff_profiles(id) on delete set null;

-- First authenticated user creates the shop; 'owner' is an ACCOUNT permission, never an employee title.
-- Optional first staff person can be linked to the creator account or remain an unlinked offline employee.
create or replace function public.aesthetic_create_shop(
 p_name text, p_staff_name text, p_staff_title text, p_link_creator boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_staff uuid; v_name text:=nullif(btrim(coalesce(p_staff_name,'')),'');
begin
 if v_name is not null and (char_length(v_name)>80 or char_length(btrim(coalesce(p_staff_title,''))) not between 1 and 80)
   then raise exception 'invalid_staff_name_or_title'; end if;
 if coalesce(p_link_creator,false) and v_name is null then raise exception 'staff_name_required_for_link'; end if;
 v_shop:=public.ongeol_create_shop(p_name);
 if v_name is not null then
   insert into public.staff_profiles(shop_id,name,title,access_role,auth_user_id)
    values(v_shop,v_name,btrim(p_staff_title),case when p_link_creator then 'manager' else 'therapist' end,
    case when p_link_creator then auth.uid() else null end) returning id into v_staff;
 end if;
 update public.shop_states set data=jsonb_set(data,'{staffNames}',
   to_jsonb(case when v_name is null then array['미지정']::text[] else array[v_name]::text[] end),true)
   where shop_id=v_shop;
 return v_shop;
end;$$;

create or replace function public.aesthetic_create_staff(
 p_shop uuid,p_name text,p_title text,p_access_role text default 'therapist'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text:=btrim(coalesce(p_name,''));
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(v_name) not between 1 and 80 or char_length(btrim(coalesce(p_title,''))) not between 1 and 80 then raise exception 'invalid_staff'; end if;
 if p_access_role not in ('manager','therapist') then raise exception 'invalid_access_role'; end if;
 insert into public.staff_profiles(shop_id,name,title,access_role)
 values(p_shop,v_name,btrim(p_title),p_access_role) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.aesthetic_update_staff(
 p_shop uuid,p_staff uuid,p_name text,p_title text,p_access_role text,p_active boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_staff public.staff_profiles%rowtype;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 80 or
    char_length(btrim(coalesce(p_title,''))) not between 1 and 80 or
    p_access_role not in ('manager','therapist') then raise exception 'invalid_staff'; end if;
 select * into v_staff from public.staff_profiles where id=p_staff and shop_id=p_shop for update;
 if not found then raise exception 'staff_not_found'; end if;
 -- Never remove the owner account's membership even when changing the linked staff profile.
 if not coalesce(p_active,false) and v_staff.auth_user_id is not null and
    not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=v_staff.auth_user_id and role='owner') then
   delete from public.shop_members where shop_id=p_shop and user_id=v_staff.auth_user_id;
 end if;
 if v_staff.auth_user_id is not null and coalesce(p_active,false) and
    not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=v_staff.auth_user_id) then
   insert into public.shop_members(shop_id,user_id,role) values(p_shop,v_staff.auth_user_id,p_access_role);
 end if;
 if v_staff.auth_user_id is not null and p_access_role<>v_staff.access_role and
    exists(select 1 from public.shop_members where shop_id=p_shop and user_id=v_staff.auth_user_id and role<>'owner') then
   update public.shop_members set role=p_access_role where shop_id=p_shop and user_id=v_staff.auth_user_id;
 end if;
 update public.staff_profiles set name=btrim(p_name),title=btrim(p_title),access_role=p_access_role,
   active=coalesce(p_active,false),updated_at=now() where id=p_staff and shop_id=p_shop;
 return true;
end;$$;

-- One-time invitation for a pre-created staff profile, no email/SMS delivery by Aesthetic Manager.
-- Code is shared manually through a trusted channel. Expiry 48 hours.
create or replace function public.aesthetic_invite_staff(p_shop uuid,p_staff uuid)
 returns text language plpgsql security definer set search_path = '' as $$
declare v_staff public.staff_profiles%rowtype; v_code uuid;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 select * into v_staff from public.staff_profiles where id=p_staff and shop_id=p_shop and active for update;
 if not found then raise exception 'staff_not_found_or_inactive'; end if;
 if v_staff.auth_user_id is not null then raise exception 'staff_already_linked'; end if;
 insert into public.shop_invites(shop_id,role,created_by,staff_id)
 values(p_shop,v_staff.access_role,auth.uid(),p_staff) returning code into v_code;
 return v_code::text;
end;$$;

create or replace function public.aesthetic_join_shop(p_code text)
 returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.shop_invites%rowtype; v_user uuid:=auth.uid(); v_staff public.staff_profiles%rowtype;
begin
 if v_user is null then raise exception 'login_required'; end if;
 if exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'already_belongs_to_shop'; end if;
 if p_code is null or p_code !~ '^[0-9a-fA-F-]{36}$' then raise exception 'invalid_invite_code'; end if;
 select * into v_inv from public.shop_invites where code=p_code::uuid for update;
 if not found or v_inv.redeemed_at is not null or v_inv.expires_at<=now() then raise exception 'invalid_or_expired_invite'; end if;
 if v_inv.staff_id is not null then
   select * into v_staff from public.staff_profiles where id=v_inv.staff_id and shop_id=v_inv.shop_id for update;
   if not found or not v_staff.active or v_staff.auth_user_id is not null then raise exception 'staff_not_available'; end if;
 end if;
 insert into public.shop_members(shop_id,user_id,role) values(v_inv.shop_id,v_user,v_inv.role);
 if v_inv.staff_id is not null then
  update public.staff_profiles set auth_user_id=v_user,updated_at=now() where id=v_inv.staff_id and shop_id=v_inv.shop_id;
 end if;
 update public.shop_invites set redeemed_at=now(),redeemed_by=v_user where code=v_inv.code;
 return v_inv.shop_id;
end;$$;

-- Current state JSON contains the entire client dataset. Until per-row customer permissions are implemented,
-- therapist logins are READ ONLY at the database layer. Admin/manager roles may save full state.
create or replace function public.ongeol_save_state(p_shop uuid,p_expected_revision bigint,p_data jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_revision bigint;
begin
 if v_user is null or not exists(
   select 1 from public.shop_members where shop_id=p_shop and user_id=v_user and role in ('owner','manager')
 ) then raise exception 'write_permission_denied' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'customers')<>'array' or jsonb_typeof(p_data->'reservations')<>'array'
   then raise exception 'invalid_state_payload'; end if;
 if pg_column_size(p_data)>2000000 then raise exception 'state_too_large'; end if;
 select revision into v_revision from public.shop_states where shop_id=p_shop for update;
 if not found then raise exception 'shop_not_found'; end if;
 if v_revision<>p_expected_revision then raise exception 'stale_revision' using errcode='P0001'; end if;
 update public.shop_states set data=p_data,revision=revision+1,updated_at=now(),updated_by=v_user where shop_id=p_shop;
 return v_revision+1;
end;$$;

revoke all on function public.aesthetic_create_shop(text,text,text,boolean) from public,anon;
revoke all on function public.aesthetic_create_staff(uuid,text,text,text) from public,anon;
revoke all on function public.aesthetic_update_staff(uuid,uuid,text,text,text,boolean) from public,anon;
revoke all on function public.aesthetic_invite_staff(uuid,uuid) from public,anon;
revoke all on function public.aesthetic_join_shop(text) from public,anon;
grant execute on function public.aesthetic_create_shop(text,text,text,boolean) to authenticated;
grant execute on function public.aesthetic_create_staff(uuid,text,text,text) to authenticated;
grant execute on function public.aesthetic_update_staff(uuid,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.aesthetic_invite_staff(uuid,uuid) to authenticated;
grant execute on function public.aesthetic_join_shop(text) to authenticated;

-- Staff member reads remain shared at shop level for now, but photo uploads/deletes require admin edit permission.
-- Existing named storage policies are replaced in-place without deleting objects.
drop policy if exists ongeol_storage_insert on storage.objects;
create policy ongeol_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='ongeol-private' and exists(
 select 1 from public.shop_members m where m.shop_id::text=split_part(name,'/',1)
 and m.user_id=auth.uid() and m.role in ('owner','manager')));
drop policy if exists ongeol_storage_delete on storage.objects;
create policy ongeol_storage_delete on storage.objects for delete to authenticated
using(bucket_id='ongeol-private' and exists(
 select 1 from public.shop_members m where m.shop_id::text=split_part(name,'/',1)
 and m.user_id=auth.uid() and m.role in ('owner','manager')));

-- Shop display-name update and Cloudflare brand heading consistency.
create or replace function public.aesthetic_rename_shop(p_shop uuid,p_name text)
 returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'invalid_shop_name'; end if;
 update public.shops set name=btrim(p_name) where id=p_shop;
 if not found then raise exception 'shop_not_found'; end if;
 return true;
end;$$;
revoke all on function public.aesthetic_rename_shop(uuid,text) from public,anon;
grant execute on function public.aesthetic_rename_shop(uuid,text) to authenticated;
