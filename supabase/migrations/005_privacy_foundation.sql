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
