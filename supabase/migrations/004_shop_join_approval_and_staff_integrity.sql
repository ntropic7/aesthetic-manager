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
