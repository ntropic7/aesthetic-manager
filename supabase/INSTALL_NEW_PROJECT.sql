-- Fresh Supabase project only. Existing installations: use incremental migration 003.

-- ===== START 001_ongeol_initial.sql =====
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

-- ===== END 001_ongeol_initial.sql =====

-- ===== START 002_accounts_staff_phone_ready.sql =====
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

-- ===== END 002_accounts_staff_phone_ready.sql =====

-- ===== START 003_positions_email_only.sql =====
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

-- ===== END 003_positions_email_only.sql =====