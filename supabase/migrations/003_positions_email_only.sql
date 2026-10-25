-- Aesthetic Manager v0.9: empty initial staff + optional, reusable positions + email-only onboarding.
-- Run AFTER 001 and 002. Non-destructive for existing customer/reservation data.

create table if not exists public.staff_positions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id,id)
);
create unique index if not exists staff_positions_unique_name on public.staff_positions(shop_id,lower(name));
create index if not exists staff_positions_shop_idx on public.staff_positions(shop_id);
alter table public.staff_positions enable row level security;
revoke all on public.staff_positions from anon, authenticated;
grant select on public.staff_positions to authenticated;
drop policy if exists aesthetic_position_member_read on public.staff_positions;
create policy aesthetic_position_member_read on public.staff_positions for select to authenticated using(public.ongeol_is_member(shop_id));

-- Existing staff title is kept only as a legacy display fallback. A position is always optional.
alter table public.staff_profiles add column if not exists position_id uuid references public.staff_positions(id) on delete set null;
alter table public.staff_profiles alter column title drop not null;
alter table public.staff_profiles alter column title drop default;
alter table public.staff_profiles drop constraint if exists staff_profiles_title_check;
create index if not exists staff_profiles_position_idx on public.staff_profiles(shop_id,position_id);

create or replace function public.aesthetic_add_position(p_shop uuid, p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=btrim(coalesce(p_name,''));
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(v_name) not between 1 and 80 then raise exception 'invalid_position_name'; end if;
 insert into public.staff_positions(shop_id,name) values(p_shop,v_name) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.aesthetic_update_position(p_shop uuid, p_position uuid, p_name text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'invalid_position_name'; end if;
 update public.staff_positions set name=btrim(p_name),updated_at=now()
 where shop_id=p_shop and id=p_position;
 if not found then raise exception 'position_not_found'; end if;
 return true;
end;$$;

create or replace function public.aesthetic_delete_position(p_shop uuid, p_position uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if exists(select 1 from public.staff_profiles where shop_id=p_shop and position_id=p_position)
 then raise exception 'position_assigned_to_staff'; end if;
 delete from public.staff_positions where shop_id=p_shop and id=p_position;
 if not found then raise exception 'position_not_found'; end if;
 return true;
end;$$;

-- V2 procedures avoid overloading the old 002 RPC signatures and require a shop-matching position ID.
create or replace function public.aesthetic_create_staff_v2(
 p_shop uuid,p_name text,p_position_id uuid,p_access_role text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=btrim(coalesce(p_name,''));
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(v_name) not between 1 and 80 then raise exception 'invalid_staff_name'; end if;
 if p_access_role not in ('manager','therapist') then raise exception 'invalid_access_role'; end if;
 if p_position_id is not null and not exists(select 1 from public.staff_positions where id=p_position_id and shop_id=p_shop)
 then raise exception 'invalid_shop_position'; end if;
 insert into public.staff_profiles(shop_id,name,title,position_id,access_role)
 values(p_shop,v_name,null,p_position_id,p_access_role) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.aesthetic_update_staff_v2(
 p_shop uuid,p_staff uuid,p_name text,p_position_id uuid,p_access_role text,p_active boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_staff public.staff_profiles%rowtype;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 80 or p_access_role not in ('manager','therapist')
 then raise exception 'invalid_staff'; end if;
 if p_position_id is not null and not exists(select 1 from public.staff_positions where id=p_position_id and shop_id=p_shop)
 then raise exception 'invalid_shop_position'; end if;
 select * into v_staff from public.staff_profiles where id=p_staff and shop_id=p_shop for update;
 if not found then raise exception 'staff_not_found'; end if;
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
 update public.staff_profiles set name=btrim(p_name),position_id=p_position_id,title=null,
   access_role=p_access_role,active=coalesce(p_active,false),updated_at=now()
   where shop_id=p_shop and id=p_staff;
 return true;
end;$$;

-- First login starts with no staff. The owner account is not a staff profile.
create or replace function public.aesthetic_create_shop(
 p_name text,p_staff_name text,p_staff_title text,p_link_creator boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_shop uuid;
begin
 if coalesce(btrim(p_staff_name),'')<>'' or coalesce(p_link_creator,false) then
  raise exception 'create_staff_from_settings_after_shop_creation';
 end if;
 v_shop:=public.ongeol_create_shop(p_name);
 update public.shop_states set data=jsonb_set(data,'{staffNames}','[]'::jsonb,true)
 where shop_id=v_shop;
 return v_shop;
end;$$;

-- Optional link between the shop creator's admin account and one pre-created real staff profile.
-- The shop owner remains OWNER regardless of the staff profile's future invited-role preference.
create or replace function public.aesthetic_link_owner_staff(p_shop uuid, p_staff uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 if exists(select 1 from public.staff_profiles where shop_id=p_shop and auth_user_id=auth.uid())
 then raise exception 'owner_already_linked_staff'; end if;
 update public.staff_profiles set auth_user_id=auth.uid(),updated_at=now()
 where shop_id=p_shop and id=p_staff and auth_user_id is null and active;
 if not found then raise exception 'staff_unavailable'; end if;
 return true;
end;$$;
create or replace function public.aesthetic_unlink_owner_staff(p_shop uuid, p_staff uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 update public.staff_profiles set auth_user_id=null,updated_at=now()
 where shop_id=p_shop and id=p_staff and auth_user_id=auth.uid();
 if not found then raise exception 'not_linked_to_this_account'; end if;
 -- The owner shop_members row remains untouched.
 return true;
end;$$;
revoke all on function public.aesthetic_link_owner_staff(uuid,uuid) from public,anon;
revoke all on function public.aesthetic_unlink_owner_staff(uuid,uuid) from public,anon;
grant execute on function public.aesthetic_link_owner_staff(uuid,uuid) to authenticated;
grant execute on function public.aesthetic_unlink_owner_staff(uuid,uuid) to authenticated;

-- Avoid leaving legacy automatic "원장" defaults in freshly initialized shops.
revoke all on function public.aesthetic_add_position(uuid,text) from public,anon;
revoke all on function public.aesthetic_update_position(uuid,uuid,text) from public,anon;
revoke all on function public.aesthetic_delete_position(uuid,uuid) from public,anon;
revoke all on function public.aesthetic_create_staff_v2(uuid,text,uuid,text) from public,anon;
revoke all on function public.aesthetic_update_staff_v2(uuid,uuid,text,uuid,text,boolean) from public,anon;
grant execute on function public.aesthetic_add_position(uuid,text) to authenticated;
grant execute on function public.aesthetic_update_position(uuid,uuid,text) to authenticated;
grant execute on function public.aesthetic_delete_position(uuid,uuid) to authenticated;
grant execute on function public.aesthetic_create_staff_v2(uuid,text,uuid,text) to authenticated;
grant execute on function public.aesthetic_update_staff_v2(uuid,uuid,text,uuid,text,boolean) to authenticated;
