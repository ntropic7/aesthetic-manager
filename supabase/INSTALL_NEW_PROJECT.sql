-- 온결 v0.7: Supabase SQL Editor에서 전체 실행합니다. 최초 설치 1회용.
-- 로그인한 사용자의 매장만 읽을 수 있으며, 변경은 revision 검사 RPC로만 허용.
-- 아직 예약/회원권까지 정규화된 상용 스키마는 아닙니다.

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table if not exists public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','manager','therapist')),
  joined_at timestamptz not null default now(),
  primary key (shop_id,user_id)
);
create index if not exists shop_members_user_idx on public.shop_members(user_id);
create table if not exists public.shop_states (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table if not exists public.shop_invites (
  code uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  role text not null check(role in ('manager','therapist')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now() + interval '48 hours'),
  redeemed_by uuid references auth.users(id),
  redeemed_at timestamptz
);
create index if not exists shop_invites_shop_idx on public.shop_invites(shop_id);

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_states enable row level security;
alter table public.shop_invites enable row level security;

-- SECURITY DEFINER 함수는 shop_members RLS 자체 참조를 피하기 위한 전용 권한 체크.
create or replace function public.ongeol_is_member(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.shop_members m where m.shop_id=p_shop and m.user_id=auth.uid());
$$;
create or replace function public.ongeol_is_owner(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.shop_members m where m.shop_id=p_shop and m.user_id=auth.uid() and m.role='owner');
$$;
revoke all on function public.ongeol_is_member(uuid) from public, anon;
revoke all on function public.ongeol_is_owner(uuid) from public, anon;
grant execute on function public.ongeol_is_member(uuid) to authenticated;
grant execute on function public.ongeol_is_owner(uuid) to authenticated;

-- 읽기는 RLS, 쓰기는 아래 전용 RPC만. anon은 모든 테이블 접근 불가.
revoke all on public.shops,public.shop_members,public.shop_states,public.shop_invites from anon,authenticated;
grant select on public.shops,public.shop_members,public.shop_states to authenticated;
-- policies (if re-running during upgrade, drop named policies first)
drop policy if exists ongeol_shops_read on public.shops;
create policy ongeol_shops_read on public.shops for select to authenticated using(public.ongeol_is_member(id));
drop policy if exists ongeol_members_read on public.shop_members;
create policy ongeol_members_read on public.shop_members for select to authenticated using(public.ongeol_is_member(shop_id));
drop policy if exists ongeol_states_read on public.shop_states;
create policy ongeol_states_read on public.shop_states for select to authenticated using(public.ongeol_is_member(shop_id));

-- 신규 가입자의 본인 매장 1개 개설. 실사용 앱에 샘플 고객/예약을 만들지 않는다.
create or replace function public.ongeol_create_shop(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'login_required'; end if;
  if exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'already_belongs_to_shop'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then raise exception 'invalid_shop_name'; end if;
  insert into public.shops(name) values(btrim(p_name)) returning id into v_id;
  insert into public.shop_members(shop_id,user_id,role) values(v_id,v_user,'owner');
  insert into public.shop_states(shop_id,revision,data,updated_by)
  values(v_id,0,jsonb_build_object(
   'customers','[]'::jsonb, 'reservations','[]'::jsonb,
   'consultations','[]'::jsonb, 'followups','[]'::jsonb,'audits','[]'::jsonb,
   'photos','[]'::jsonb,'waitlist','[]'::jsonb,'inventory','[]'::jsonb,
   'treatments','[]'::jsonb,'membershipUsages','[]'::jsonb,'payments','[]'::jsonb,
   'messageDrafts','[]'::jsonb,'staffShifts','[]'::jsonb,'intakeForms','[]'::jsonb,
   'consents','[]'::jsonb,'campaigns','[]'::jsonb,'snapshots','[]'::jsonb,
   'messageQueue','[]'::jsonb,'hygieneTasks','[]'::jsonb,'shopTasks','[]'::jsonb,
   'staffNames',jsonb_build_array('원장'),
   'rooms',jsonb_build_array('관리실 A'),
   'services','[]'::jsonb,
   'weekSeeded',true,
   'shopConfig',jsonb_build_object('name',btrim(p_name),'parkingMinutes',120,'cancelHours',24,'commissions','[]'::jsonb)
  ),v_user);
  return v_id;
end;
$$;

-- 전체 상태 저장의 원자적 optimistic concurrency 검사. 여러 기기 덮어쓰기 방지.
create or replace function public.ongeol_save_state(p_shop uuid,p_expected_revision bigint,p_data jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_revision bigint;
begin
  if v_user is null or not public.ongeol_is_member(p_shop) then raise exception 'access_denied' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or
    jsonb_typeof(p_data->'customers')<>'array' or
    jsonb_typeof(p_data->'reservations')<>'array' then raise exception 'invalid_state_payload'; end if;
  if pg_column_size(p_data)>2000000 then raise exception 'state_too_large'; end if;
  select revision into v_revision from public.shop_states where shop_id=p_shop for update;
  if not found then raise exception 'shop_not_found'; end if;
  if v_revision<>p_expected_revision then raise exception 'stale_revision' using errcode='P0001'; end if;
  update public.shop_states set data=p_data,revision=revision+1,updated_at=now(),updated_by=v_user where shop_id=p_shop;
  return v_revision+1;
end;
$$;

-- 다른 직원 초대: 원장만 초대 생성, 코드는 48시간/1회 사용.
create or replace function public.ongeol_create_invite(p_shop uuid,p_role text default 'therapist')
returns text language plpgsql security definer set search_path = '' as $$
declare v_code uuid;
begin
  if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
  if p_role not in ('manager','therapist') then raise exception 'invalid_role'; end if;
  insert into public.shop_invites(shop_id,role,created_by) values(p_shop,p_role,auth.uid()) returning code into v_code;
  return v_code::text;
end;
$$;
create or replace function public.ongeol_join_shop(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.shop_invites%rowtype; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'login_required'; end if;
  if exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'already_belongs_to_shop'; end if;
  if p_code is null or p_code !~ '^[0-9a-fA-F-]{36}$' then raise exception 'invalid_invite_code'; end if;
  select * into v_inv from public.shop_invites where code=p_code::uuid for update;
  if not found or v_inv.redeemed_at is not null or v_inv.expires_at<=now() then raise exception 'invalid_or_expired_invite'; end if;
  insert into public.shop_members(shop_id,user_id,role) values(v_inv.shop_id,v_user,v_inv.role);
  update public.shop_invites set redeemed_at=now(),redeemed_by=v_user where code=v_inv.code;
  return v_inv.shop_id;
end;
$$;
revoke all on function public.ongeol_create_shop(text) from public,anon;
revoke all on function public.ongeol_save_state(uuid,bigint,jsonb) from public,anon;
revoke all on function public.ongeol_create_invite(uuid,text) from public,anon;
revoke all on function public.ongeol_join_shop(text) from public,anon;
grant execute on function public.ongeol_create_shop(text) to authenticated;
grant execute on function public.ongeol_save_state(uuid,bigint,jsonb) to authenticated;
grant execute on function public.ongeol_create_invite(uuid,text) to authenticated;
grant execute on function public.ongeol_join_shop(text) to authenticated;

-- Supabase Storage: 비공개 버킷. 고객 사진의 서명 URL만 임시 사용.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ongeol-private','ongeol-private',false,3145728,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=3145728,allowed_mime_types=array['image/jpeg'];

drop policy if exists ongeol_storage_read on storage.objects;
create policy ongeol_storage_read on storage.objects for select to authenticated
using (bucket_id='ongeol-private' and exists(
  select 1 from public.shop_members m
  where m.shop_id::text=split_part(name,'/',1) and m.user_id=auth.uid()
));
drop policy if exists ongeol_storage_insert on storage.objects;
create policy ongeol_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='ongeol-private' and exists(
  select 1 from public.shop_members m
  where m.shop_id::text=split_part(name,'/',1) and m.user_id=auth.uid()
));
drop policy if exists ongeol_storage_delete on storage.objects;
create policy ongeol_storage_delete on storage.objects for delete to authenticated
using (bucket_id='ongeol-private' and exists(
  select 1 from public.shop_members m
  where m.shop_id::text=split_part(name,'/',1) and m.user_id=auth.uid()
));


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


-- Aesthetic Manager v1.0 : approval-only shop enrollment, mandatory initial employee,
-- staff foreign-reference checks and atomic staff reassignment.
-- Run after 001, 002, 003. Works with an existing shop; no DROP TABLE.

-- The access code is an unguessable, revocable, shop-scoped credential. Do not publicize it.
alter table public.shops add column if not exists connection_code uuid default gen_random_uuid();
update public.shops set connection_code=gen_random_uuid() where connection_code is null;
create unique index if not exists shops_connection_code_uq on public.shops(connection_code);

create table if not exists public.shop_join_requests (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid not null references public.shops(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 user_email text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id),
 assigned_staff_id uuid references public.staff_profiles(id) on delete set null
);
create unique index if not exists shop_join_requests_one_pending on public.shop_join_requests(user_id) where status='pending';
create index if not exists shop_join_requests_shop_pending on public.shop_join_requests(shop_id,status,created_at);
alter table public.shop_join_requests enable row level security;
revoke all on public.shop_join_requests from public,anon,authenticated;
grant select on public.shop_join_requests to authenticated;
drop policy if exists shop_join_request_visible on public.shop_join_requests;
create policy shop_join_request_visible on public.shop_join_requests for select to authenticated
 using(user_id=auth.uid() or public.ongeol_is_owner(shop_id));

create or replace function public.aesthetic_create_shop_v3(
 p_name text,p_staff_name text,p_staff_position_name text default null,p_link_creator boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_shop uuid; v_staff uuid; v_position uuid; v_name text:=btrim(coalesce(p_staff_name,'')); v_title text:=btrim(coalesce(p_staff_position_name,''));
begin
 if char_length(v_name) not between 1 and 80 then raise exception 'first_staff_required'; end if;
 if char_length(v_title)>80 then raise exception 'invalid_position_name'; end if;
 v_shop:=public.ongeol_create_shop(p_name);
 if v_title<>'' then
  insert into public.staff_positions(shop_id,name) values(v_shop,v_title) returning id into v_position;
 end if;
 insert into public.staff_profiles(shop_id,name,title,position_id,access_role,auth_user_id)
 values(v_shop,v_name,null,v_position,'therapist',case when p_link_creator then auth.uid() else null end)
 returning id into v_staff;
 update public.shop_states
 set data=jsonb_set(data,'{staffNames}',jsonb_build_array(v_name),true)
 where shop_id=v_shop;
 return v_shop;
end;$$;

create or replace function public.aesthetic_get_connection_code(p_shop uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_code uuid;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 select connection_code into v_code from public.shops where id=p_shop;
 return v_code::text;
end;$$;
create or replace function public.aesthetic_rotate_connection_code(p_shop uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_code uuid;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 update public.shops set connection_code=gen_random_uuid() where id=p_shop returning connection_code into v_code;
 return v_code::text;
end;$$;

create or replace function public.aesthetic_request_join(p_code text)
returns text language plpgsql security definer set search_path='' as $$
declare v_shop uuid; v_email text; v_user uuid:=auth.uid(); v_code uuid;
begin
 if v_user is null then raise exception 'login_required' using errcode='42501'; end if;
 if exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'already_belongs_to_shop'; end if;
 if exists(select 1 from public.shop_join_requests where user_id=v_user and status='pending') then raise exception 'already_pending'; end if;
 if (select count(*) from public.shop_join_requests where user_id=v_user and created_at>now()-interval '1 day')>=5 then
  raise exception 'daily_request_limit'; end if;
 if p_code is null or p_code !~ '^[0-9a-fA-F-]{36}$' then raise exception 'invalid_connection_code'; end if;
 v_code:=p_code::uuid;
 select id into v_shop from public.shops where connection_code=v_code;
 if v_shop is null then raise exception 'invalid_connection_code'; end if;
 select email into v_email from auth.users where id=v_user;
 insert into public.shop_join_requests(shop_id,user_id,user_email)
 values(v_shop,v_user,coalesce(v_email,''));
 return 'pending';
end;$$;

-- Sensitive shop names aren't exposed by a public directory. Only the submitter can view their own request.
create or replace function public.aesthetic_my_join_request()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb;
begin
 select jsonb_build_object('id',r.id,'status',r.status,'shop_name',s.name,'created_at',r.created_at)
 into v_data from public.shop_join_requests r join public.shops s on s.id=r.shop_id
 where r.user_id=auth.uid() order by r.created_at desc limit 1;
 return v_data;
end;$$;

create or replace function public.aesthetic_review_join(
 p_request uuid,p_action text,p_staff uuid default null,p_staff_name text default null,
 p_position uuid default null,p_access_role text default 'therapist'
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_req public.shop_join_requests%rowtype; v_staff public.staff_profiles%rowtype; v_staff_id uuid;
begin
 select * into v_req from public.shop_join_requests where id=p_request for update;
 if not found then raise exception 'request_not_found'; end if;
 if not public.ongeol_is_owner(v_req.shop_id) then raise exception 'owner_only' using errcode='42501'; end if;
 if v_req.status<>'pending' then raise exception 'request_already_reviewed'; end if;
 if p_action='reject' then
  update public.shop_join_requests set status='rejected',reviewed_at=now(),reviewed_by=auth.uid() where id=p_request;
  return true;
 end if;
 if p_action<>'approve' then raise exception 'invalid_action'; end if;
 if exists(select 1 from public.shop_members where user_id=v_req.user_id) then raise exception 'applicant_already_joined'; end if;
 if p_staff is not null then
  select * into v_staff from public.staff_profiles where shop_id=v_req.shop_id and id=p_staff for update;
  if not found or not v_staff.active or v_staff.auth_user_id is not null then raise exception 'staff_unavailable'; end if;
  v_staff_id:=v_staff.id;
 else
  if char_length(btrim(coalesce(p_staff_name,''))) not between 1 and 80 then raise exception 'staff_name_required'; end if;
  if exists(select 1 from public.staff_profiles where shop_id=v_req.shop_id and lower(name)=lower(btrim(p_staff_name)) and active) then raise exception 'duplicate_staff_name'; end if;
  if p_access_role not in ('manager','therapist') then raise exception 'invalid_access_role'; end if;
  if p_position is not null and not exists(select 1 from public.staff_positions where id=p_position and shop_id=v_req.shop_id)
    then raise exception 'invalid_position'; end if;
  insert into public.staff_profiles(shop_id,name,title,position_id,access_role)
  values(v_req.shop_id,btrim(p_staff_name),null,p_position,p_access_role)
  returning * into v_staff;
  v_staff_id:=v_staff.id;
 end if;
 insert into public.shop_members(shop_id,user_id,role)
 values(v_req.shop_id,v_req.user_id,v_staff.access_role);
 update public.staff_profiles set auth_user_id=v_req.user_id,updated_at=now() where id=v_staff_id;
 update public.shop_join_requests set status='approved',reviewed_at=now(),reviewed_by=auth.uid(),assigned_staff_id=v_staff_id
 where id=p_request;
 -- The names array is kept for backwards-compatible timetable rendering.
 update public.shop_states set data=jsonb_set(data,'{staffNames}',
   (select coalesce(jsonb_agg(name order by created_at),'[]'::jsonb) from public.staff_profiles
    where shop_id=v_req.shop_id and active),true),
   revision=revision+1,updated_at=now(),updated_by=auth.uid()
 where shop_id=v_req.shop_id;
 return true;
end;$$;

-- Apply recursively so every persisted staff reference, including nested future documents, is accounted for.
-- Only semantic staff-reference keys are considered: no substitution in freeform notes or customer names.
create or replace function public.aesthetic_staff_ref_count(p_value jsonb,p_name text)
returns integer language plpgsql immutable set search_path='' as $$
declare v jsonb; k text; n integer:=0;
begin
 if jsonb_typeof(p_value)='object' then
  for k,v in select key,value from jsonb_each(p_value) loop
   if k=any(array['staff','staffName','staff_name','assignedStaff','assigned_to','employee','employeeName'])
      and jsonb_typeof(v)='string' and (v#>>'{}')=p_name then n:=n+1;
   end if;
   n:=n+public.aesthetic_staff_ref_count(v,p_name);
  end loop;
 elsif jsonb_typeof(p_value)='array' then
  for v in select value from jsonb_array_elements(p_value) loop
   n:=n+public.aesthetic_staff_ref_count(v,p_name);
  end loop;
 end if;
 return n;
end;$$;
create or replace function public.aesthetic_staff_replace_refs(p_value jsonb,p_old text,p_new text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; result jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  result:='{}'::jsonb;
  for k,v in select key,value from jsonb_each(p_value) loop
   if k=any(array['staff','staffName','staff_name','assignedStaff','assigned_to','employee','employeeName'])
       and jsonb_typeof(v)='string' and (v#>>'{}')=p_old then v:=to_jsonb(p_new);
   else v:=public.aesthetic_staff_replace_refs(v,p_old,p_new);end if;
   result:=result||jsonb_build_object(k,v);
  end loop;
  return result;
 elsif jsonb_typeof(p_value)='array' then
  result:='[]'::jsonb;
  for v in select value from jsonb_array_elements(p_value) loop
   result:=result||jsonb_build_array(public.aesthetic_staff_replace_refs(v,p_old,p_new));
  end loop;
  return result;
 end if;
 return p_value;
end;$$;

create or replace function public.aesthetic_staff_dependencies(p_shop uuid,p_staff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text; v_data jsonb; v_key text; v_count integer; v_out jsonb:='{}'::jsonb;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 select name into v_name from public.staff_profiles where shop_id=p_shop and id=p_staff;
 if v_name is null then raise exception 'staff_not_found'; end if;
 select data into v_data from public.shop_states where shop_id=p_shop;
 for v_key in select key from jsonb_each(v_data) loop
  v_count:=public.aesthetic_staff_ref_count(v_data->v_key,v_name);
  if v_count>0 then v_out:=v_out||jsonb_build_object(v_key,v_count); end if;
 end loop;
 return v_out;
end;$$;

create or replace function public.aesthetic_reassign_staff(p_shop uuid,p_from uuid,p_to uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_old text; v_new text; v_data jsonb; v_rev bigint;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 if p_from=p_to then raise exception 'different_staff_required'; end if;
 select name into v_old from public.staff_profiles where shop_id=p_shop and id=p_from;
 select name into v_new from public.staff_profiles where shop_id=p_shop and id=p_to and active;
 if v_old is null or v_new is null then raise exception 'staff_not_found'; end if;
 select data,revision into v_data,v_rev from public.shop_states where shop_id=p_shop for update;
 update public.shop_states set data=public.aesthetic_staff_replace_refs(v_data,v_old,v_new),
 revision=v_rev+1,updated_at=now(),updated_by=auth.uid() where shop_id=p_shop;
 return v_rev+1;
end;$$;

create or replace function public.aesthetic_delete_staff(p_shop uuid,p_staff uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_name text; v_user uuid; v_count integer; v_data jsonb; v_newnames jsonb;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 -- Lock the store-state row so simultaneous employee deletes/reassignment serialize.
 select data into v_data from public.shop_states where shop_id=p_shop for update;
 select name,auth_user_id into v_name,v_user from public.staff_profiles where shop_id=p_shop and id=p_staff for update;
 if v_name is null then raise exception 'staff_not_found'; end if;
 select count(*) into v_count from public.staff_profiles where shop_id=p_shop and active;
 if exists(select 1 from public.staff_profiles where shop_id=p_shop and id=p_staff and active) and v_count<=1 then raise exception 'at_least_one_staff_required'; end if;
 if v_user is not null then raise exception 'linked_account_disconnect_first'; end if;
 if public.aesthetic_staff_ref_count(v_data,v_name)>0 then raise exception 'staff_has_dependencies_reassign_first'; end if;
 delete from public.staff_profiles where shop_id=p_shop and id=p_staff;
 select coalesce(jsonb_agg(name order by created_at),'[]'::jsonb) into v_newnames
 from public.staff_profiles where shop_id=p_shop and active;
 update public.shop_states set data=jsonb_set(data,'{staffNames}',v_newnames,true),
 revision=revision+1,updated_at=now(),updated_by=auth.uid() where shop_id=p_shop;
 return true;
end;$$;

create or replace function public.aesthetic_disconnect_staff(p_shop uuid,p_staff uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 select auth_user_id into v_user from public.staff_profiles where shop_id=p_shop and id=p_staff for update;
 if v_user is null then raise exception 'staff_account_not_linked'; end if;
 if exists(select 1 from public.shop_members where user_id=v_user and shop_id=p_shop and role='owner')
 then raise exception 'owner_use_owner_unlink'; end if;
 delete from public.shop_members where shop_id=p_shop and user_id=v_user;
 update public.staff_profiles set auth_user_id=null,updated_at=now() where shop_id=p_shop and id=p_staff;
 return true;
end;$$;

-- Deactivation and rename must not bypass referential checks or the at-least-one-employee rule.
create or replace function public.aesthetic_update_staff_v2(
 p_shop uuid,p_staff uuid,p_name text,p_position_id uuid,p_access_role text,p_active boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_staff public.staff_profiles%rowtype; v_data jsonb; v_count integer;
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'admin_only' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 80 or p_access_role not in ('manager','therapist')
 then raise exception 'invalid_staff'; end if;
 if p_position_id is not null and not exists(select 1 from public.staff_positions where id=p_position_id and shop_id=p_shop)
 then raise exception 'invalid_shop_position'; end if;
 select data into v_data from public.shop_states where shop_id=p_shop for update;
 select * into v_staff from public.staff_profiles where id=p_staff and shop_id=p_shop for update;
 if not found then raise exception 'staff_not_found'; end if;
 if coalesce(p_active,false) and exists(
  select 1 from public.staff_profiles where shop_id=p_shop and id<>p_staff and lower(name)=lower(btrim(p_name)) and active
 ) then raise exception 'duplicate_staff_name'; end if;
 if not coalesce(p_active,false) and v_staff.active then
  select count(*) into v_count from public.staff_profiles where shop_id=p_shop and active;
  if v_count<=1 then raise exception 'at_least_one_staff_required'; end if;
  if public.aesthetic_staff_ref_count(v_data,v_staff.name)>0 then raise exception 'staff_has_dependencies_reassign_first'; end if;
 end if;
 if btrim(p_name)<>v_staff.name and public.aesthetic_staff_ref_count(v_data,v_staff.name)>0
 then raise exception 'staff_name_in_use_reassign_first'; end if;
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
 update public.shop_states set data=jsonb_set(data,'{staffNames}',
  (select coalesce(jsonb_agg(name order by created_at),'[]'::jsonb) from public.staff_profiles where shop_id=p_shop and active),true),
  revision=revision+1,updated_at=now(),updated_by=auth.uid() where shop_id=p_shop;
 return true;
end;$$;

-- Name-keyed history requires unique active employee names per shop until staff_id migration.
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
 if exists(select 1 from public.staff_profiles where shop_id=p_shop and lower(name)=lower(v_name) and active)
 then raise exception 'duplicate_staff_name'; end if;
 insert into public.staff_profiles(shop_id,name,title,position_id,access_role)
 values(p_shop,v_name,null,p_position_id,p_access_role) returning id into v_id;
 return v_id;
end;$$;

-- Server-side authorization. The browser's read-only controls are not a security boundary.
create or replace function public.ongeol_save_state(p_shop uuid,p_expected_revision bigint,p_data jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_revision bigint;
begin
 if auth.uid() is null or not exists(
  select 1 from public.shop_members
  where shop_id=p_shop and user_id=auth.uid() and role in ('owner','manager')
 ) then raise exception 'edit_access_denied' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or
  jsonb_typeof(p_data->'customers')<>'array' or jsonb_typeof(p_data->'reservations')<>'array'
  then raise exception 'invalid_state_payload'; end if;
 if pg_column_size(p_data)>2000000 then raise exception 'state_too_large'; end if;
 select revision into v_revision from public.shop_states where shop_id=p_shop for update;
 if not found then raise exception 'shop_not_found'; end if;
 if v_revision<>p_expected_revision then raise exception 'stale_revision' using errcode='P0001'; end if;
 update public.shop_states set data=p_data,revision=v_revision+1,updated_at=now(),updated_by=auth.uid()
 where shop_id=p_shop;
 return v_revision+1;
end;$$;

-- Legacy direct-join and create-with-zero-staff entrypoints are intentionally disabled.
revoke all on function public.ongeol_join_shop(text) from public,anon,authenticated;
revoke all on function public.aesthetic_join_shop(text) from public,anon,authenticated;
revoke all on function public.ongeol_create_invite(uuid,text) from public,anon,authenticated;
revoke all on function public.aesthetic_invite_staff(uuid,uuid) from public,anon,authenticated;
revoke all on function public.ongeol_create_shop(text) from public,anon,authenticated;
revoke all on function public.aesthetic_create_shop(text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.aesthetic_update_staff(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.aesthetic_create_staff(uuid,text,text,text) from public,anon,authenticated;

-- Privileged write and read procedures are only for authenticated sessions.
do $$ declare v_signature text; begin
 foreach v_signature in array array[
 'aesthetic_create_shop_v3(text,text,text,boolean)',
 'aesthetic_get_connection_code(uuid)', 'aesthetic_rotate_connection_code(uuid)',
 'aesthetic_request_join(text)', 'aesthetic_my_join_request()',
 'aesthetic_review_join(uuid,text,uuid,text,uuid,text)',
 'aesthetic_staff_dependencies(uuid,uuid)', 'aesthetic_reassign_staff(uuid,uuid,uuid)',
 'aesthetic_delete_staff(uuid,uuid)','aesthetic_disconnect_staff(uuid,uuid)',
 'aesthetic_update_staff_v2(uuid,uuid,text,uuid,text,boolean)'
 ] loop
  execute format('revoke all on function public.%s from public,anon',v_signature);
  execute format('grant execute on function public.%s to authenticated',v_signature);
 end loop;
end $$;

-- Internal recursive JSON helpers must never be remotely callable by untrusted clients.
revoke all on function public.aesthetic_staff_ref_count(jsonb,text) from public,anon,authenticated;
revoke all on function public.aesthetic_staff_replace_refs(jsonb,text,text) from public,anon,authenticated;


-- ===== Privacy foundation v1.1 =====
-- Aesthetic Manager v1.1 privacy foundation — 2026-10-26
-- REVIEW REQUIRED: Technical controls only; not a certification of legal compliance.
-- Apply AFTER 001–004. Never insert actual customer data before legal and security review.
create table if not exists public.privacy_account_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null check (document_key in ('platform_terms','platform_privacy_notice')),
  version text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, document_key, version)
);
create table if not exists public.privacy_shop_documents (
  shop_id uuid not null references public.shops(id) on delete cascade,
  document_key text not null check (document_key in ('processing_agreement','shop_privacy_responsibility')),
  version text not null,
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  primary key (shop_id, document_key, version)
);
create table if not exists public.privacy_subject_evidence (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('customer','staff')),
  subject_ref text not null check (length(subject_ref) between 1 and 100),
  purpose text not null check (purpose in ('customer_basic','customer_sensitive','photo','recording','marketing','staff_notice')),
  lawful_basis text not null check (lawful_basis in ('consent','contract','legitimate_interest')),
  evidence_method text not null check (evidence_method in ('signed_paper','signed_electronic','documented_notice','contract_necessity','shop_attestation')),
  document_version text not null check (length(document_version) between 1 and 80),
  -- IMPORTANT: A manager's recording is a CLAIM, not verification of the subject's signature.
  attestation_only boolean not null default true,
  event_action text not null check (event_action in ('RECORDED','WITHDRAWN')),
  evidence_reference text not null default '' check(length(evidence_reference)<=120),
  acted_by uuid not null references auth.users(id),
  acted_at timestamptz not null default now()
);
create index if not exists privacy_subject_lookup on public.privacy_subject_evidence(shop_id,subject_kind,subject_ref,purpose,acted_at desc,id desc);
create index if not exists privacy_shop_documents_lookup on public.privacy_shop_documents(shop_id,document_key);
alter table public.privacy_account_documents enable row level security;
alter table public.privacy_shop_documents enable row level security;
alter table public.privacy_subject_evidence enable row level security;
revoke all on table public.privacy_account_documents, public.privacy_shop_documents, public.privacy_subject_evidence from anon;
revoke insert,update,delete on table public.privacy_account_documents, public.privacy_shop_documents, public.privacy_subject_evidence from authenticated;
grant select on table public.privacy_account_documents, public.privacy_shop_documents, public.privacy_subject_evidence to authenticated;
drop policy if exists privacy_account_self on public.privacy_account_documents;
create policy privacy_account_self on public.privacy_account_documents for select to authenticated using (user_id=auth.uid());
drop policy if exists privacy_shop_owner_read on public.privacy_shop_documents;
create policy privacy_shop_owner_read on public.privacy_shop_documents for select to authenticated using (public.ongeol_is_owner(shop_id));
drop policy if exists privacy_evidence_owner_read on public.privacy_subject_evidence;
create policy privacy_evidence_owner_read on public.privacy_subject_evidence for select to authenticated using (public.ongeol_is_owner(shop_id));

create or replace function public.aesthetic_ack_account_doc(p_document text,p_version text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if p_document not in ('platform_terms','platform_privacy_notice') or length(p_version) not between 1 and 80 then raise exception 'invalid_document'; end if;
 insert into public.privacy_account_documents(user_id,document_key,version) values(auth.uid(),p_document,p_version)
 on conflict do nothing;
 return true;
end;$$;

create or replace function public.aesthetic_accept_shop_doc(p_shop uuid,p_document text,p_version text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ongeol_is_owner(p_shop) then raise exception 'owner_only' using errcode='42501'; end if;
 if p_document not in ('processing_agreement','shop_privacy_responsibility') or length(p_version) not between 1 and 80 then raise exception 'invalid_document'; end if;
 insert into public.privacy_shop_documents(shop_id,document_key,version,accepted_by) values(p_shop,p_document,p_version,auth.uid())
 on conflict do nothing;
 return true;
end;$$;

create or replace function public.aesthetic_privacy_evidence(
 p_shop uuid,p_subject_kind text,p_subject_ref text,p_purpose text,
 p_basis text,p_method text,p_version text,p_reference text default '',p_action text default 'RECORDED')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and role in ('owner','manager'))
 then raise exception 'privacy_edit_access_denied' using errcode='42501'; end if;
 if p_action not in ('RECORDED','WITHDRAWN') or p_subject_kind not in ('customer','staff') or p_purpose not in ('customer_basic','customer_sensitive','photo','recording','marketing','staff_notice')
 or p_basis not in ('consent','contract','legitimate_interest') or p_method not in ('signed_paper','signed_electronic','documented_notice','contract_necessity','shop_attestation')
 or length(p_subject_ref) not between 1 and 100 or length(p_version) not between 1 and 80 or length(coalesce(p_reference,''))>120 then raise exception 'invalid_privacy_evidence'; end if;
 if (p_subject_kind='staff') <> (p_purpose='staff_notice') then raise exception 'wrong_subject_purpose'; end if;
 if p_action='RECORDED' and p_purpose in ('customer_sensitive','photo','recording','marketing') and p_basis<>'consent' then raise exception 'separate_consent_required'; end if;
 if p_action='RECORDED' and p_basis='consent' and p_method not in ('signed_paper','signed_electronic') then raise exception 'consent_document_evidence_required'; end if;
 if p_action='RECORDED' and p_purpose='customer_basic' and p_basis='contract' and p_method<>'contract_necessity' then raise exception 'contract_necessity_evidence_required'; end if;
 insert into public.privacy_subject_evidence(shop_id,subject_kind,subject_ref,purpose,lawful_basis,evidence_method,document_version,evidence_reference,event_action,acted_by)
 values(p_shop,p_subject_kind,p_subject_ref,p_purpose,p_basis,p_method,p_version,coalesce(p_reference,''),p_action,auth.uid()) returning id into v_id;
 return v_id;
end;$$;

-- A manager may attest a basis and evidence location; this does NOT prove they obtained consent.
create or replace function public.aesthetic_privacy_status(p_shop uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid()) then raise exception 'shop_access_denied' using errcode='42501'; end if;
 return jsonb_build_object(
 'processing_agreement',exists(select 1 from public.privacy_shop_documents where shop_id=p_shop and document_key='processing_agreement'),
 'shop_privacy_responsibility',exists(select 1 from public.privacy_shop_documents where shop_id=p_shop and document_key='shop_privacy_responsibility'),
 'evidence_count',(select count(*) from public.privacy_subject_evidence where shop_id=p_shop)
 );
end;$$;


create or replace function public.aesthetic_has_privacy_evidence(p_shop uuid,p_subject text,p_purpose text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select e.event_action='RECORDED' from public.privacy_subject_evidence e
  where e.shop_id=p_shop and e.subject_kind='customer' and e.subject_ref=p_subject and e.purpose=p_purpose
  order by e.acted_at desc,e.id desc limit 1),false);
$$;
create or replace function public.aesthetic_ack_own_staff_notice(p_shop uuid,p_staff uuid,p_version text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staff_profiles where id=p_staff and shop_id=p_shop and auth_user_id=auth.uid())
 then raise exception 'self_staff_only' using errcode='42501'; end if;
 if length(p_version) not between 1 and 80 then raise exception 'invalid_document'; end if;
 insert into public.privacy_subject_evidence(shop_id,subject_kind,subject_ref,purpose,lawful_basis,evidence_method,
 document_version,attestation_only,event_action,evidence_reference,acted_by)
 values(p_shop,'staff',p_staff::text,'staff_notice','contract','documented_notice',p_version,false,'RECORDED','직원 본인 계정 확인',auth.uid());
 return true;
end;$$;

-- SECURITY: a document must be accepted before the first customer is persisted.
-- Each customer requires a recorded basis. Sensitive/contact data enforcement is PARTIAL
-- because the legacy JSONB blob can contain arbitrary free text. Before production
-- it must be replaced with normalized, typed, independently permissioned tables.
create or replace function public.ongeol_save_state(p_shop uuid,p_expected_revision bigint,p_data jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_revision bigint; v_customer jsonb; v_cid text;
begin
 if auth.uid() is null or not exists(
  select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and role in ('owner','manager')
 ) then raise exception 'edit_access_denied' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or
  jsonb_typeof(p_data->'customers')<>'array' or jsonb_typeof(p_data->'reservations')<>'array'
  then raise exception 'invalid_state_payload'; end if;
 if pg_column_size(p_data)>2000000 then raise exception 'state_too_large'; end if;
 if jsonb_array_length(p_data->'customers')>0 then
  if not exists(select 1 from public.privacy_shop_documents where shop_id=p_shop and document_key='processing_agreement')
   or not exists(select 1 from public.privacy_shop_documents where shop_id=p_shop and document_key='shop_privacy_responsibility')
  then raise exception 'shop_privacy_documents_required' using errcode='42501'; end if;
  for v_customer in select value from jsonb_array_elements(p_data->'customers') loop
    v_cid:=v_customer->>'id';
    if v_cid is null or not exists(
      select 1 from public.privacy_subject_evidence e
      where e.shop_id=p_shop and e.subject_kind='customer' and e.subject_ref=v_cid and e.purpose='customer_basic'
       and e.event_action='RECORDED' and not exists(
          select 1 from public.privacy_subject_evidence e2 where e2.shop_id=e.shop_id and e2.subject_ref=e.subject_ref
          and e2.purpose=e.purpose and (e2.acted_at,e2.id)>(e.acted_at,e.id) and e2.event_action='WITHDRAWN')
    ) then raise exception 'customer_lawful_basis_missing' using errcode='42501'; end if;
    if (jsonb_array_length(coalesce(v_customer->'allergies','[]'::jsonb))>0 or
        jsonb_array_length(coalesce(v_customer->'concerns','[]'::jsonb))>0 or
        jsonb_array_length(coalesce(v_customer->'precautions','[]'::jsonb))>0 or
        length(coalesce(v_customer->>'intake',''))>0)
       and not public.aesthetic_has_privacy_evidence(p_shop,v_cid,'customer_sensitive')
    then raise exception 'separate_sensitive_consent_evidence_required' using errcode='42501'; end if;
    if coalesce((v_customer->>'recordingConsent')::boolean,false) and not public.aesthetic_has_privacy_evidence(p_shop,v_cid,'recording')
    then raise exception 'recording_consent_evidence_required' using errcode='42501'; end if;
    if coalesce((v_customer->>'photoConsent')::boolean,false) and not public.aesthetic_has_privacy_evidence(p_shop,v_cid,'photo')
    then raise exception 'photo_consent_evidence_required' using errcode='42501'; end if;
    if coalesce((v_customer->>'marketingConsent')::boolean,false) and not public.aesthetic_has_privacy_evidence(p_shop,v_cid,'marketing')
    then raise exception 'marketing_consent_evidence_required' using errcode='42501'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(p_data->'photos','[]'::jsonb)) p
      where not public.aesthetic_has_privacy_evidence(p_shop,p->>'cid','photo'))
  then raise exception 'photo_consent_evidence_required' using errcode='42501'; end if;
 end if;
 select revision into v_revision from public.shop_states where shop_id=p_shop for update;
 if not found then raise exception 'shop_not_found'; end if;
 if v_revision<>p_expected_revision then raise exception 'stale_revision' using errcode='P0001'; end if;
 update public.shop_states set data=p_data,revision=v_revision+1,updated_at=now(),updated_by=auth.uid() where shop_id=p_shop;
 return v_revision+1;
end;$$;

revoke all on function public.aesthetic_has_privacy_evidence(uuid,text,text) from public,anon;
revoke all on function public.aesthetic_ack_own_staff_notice(uuid,uuid,text) from public,anon;
revoke all on function public.aesthetic_ack_account_doc(text,text) from public,anon;
revoke all on function public.aesthetic_accept_shop_doc(uuid,text,text) from public,anon;
revoke all on function public.aesthetic_privacy_evidence(uuid,text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.aesthetic_privacy_status(uuid) from public,anon;
revoke all on function public.ongeol_save_state(uuid,bigint,jsonb) from public,anon;
grant execute on function public.aesthetic_ack_own_staff_notice(uuid,uuid,text) to authenticated;
grant execute on function public.aesthetic_ack_account_doc(text,text) to authenticated;
grant execute on function public.aesthetic_accept_shop_doc(uuid,text,text) to authenticated;
grant execute on function public.aesthetic_privacy_evidence(uuid,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.aesthetic_privacy_status(uuid) to authenticated;
grant execute on function public.ongeol_save_state(uuid,bigint,jsonb) to authenticated;

-- Storage security: previous policy let every shop member read customer photos.
-- Until per-employee permissions are normalized, restrict reads to owner/manager.
drop policy if exists ongeol_storage_read on storage.objects;
create policy ongeol_storage_read on storage.objects for select to authenticated
using (bucket_id='ongeol-private' and exists(
 select 1 from public.shop_members m
 where m.shop_id::text=split_part(name,'/',1) and m.user_id=auth.uid() and m.role in ('owner','manager')
));
drop policy if exists ongeol_storage_insert on storage.objects;
create policy ongeol_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='ongeol-private' and exists(
 select 1 from public.shop_members m
 where m.shop_id::text=split_part(name,'/',1) and m.user_id=auth.uid() and m.role in ('owner','manager')
 and public.aesthetic_has_privacy_evidence(m.shop_id,split_part(name,'/',2),'photo')
));
drop policy if exists ongeol_storage_delete on storage.objects;
create policy ongeol_storage_delete on storage.objects for delete to authenticated
using (bucket_id='ongeol-private' and exists(
 select 1 from public.shop_members m
 where m.shop_id::text=split_part(name,'/',1) and m.user_id=auth.uid() and m.role in ('owner','manager')
));
grant execute on function public.aesthetic_has_privacy_evidence(uuid,text,text) to authenticated;

-- Worker accounts must not get every customer's JSONB profile before entity-level RLS exists.
-- They retain membership, but shop_states payload is owner/manager-only in the privacy pilot.
drop policy if exists ongeol_states_read on public.shop_states;
create policy ongeol_states_read on public.shop_states for select to authenticated
using (exists(select 1 from public.shop_members m where m.shop_id=shop_states.shop_id and m.user_id=auth.uid() and m.role in ('owner','manager')));
