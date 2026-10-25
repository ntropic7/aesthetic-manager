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
