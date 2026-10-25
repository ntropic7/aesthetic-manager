/** Supabase REST adapter. No privileged keys, no npm dependency, no mock cloud writes. */
export const serverMode = () => window.ONGEOL_CONFIG?.apiMode === 'supabase';
const conf = () => window.ONGEOL_CONFIG || {};
export function configurationReady(){
  const c=conf();
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(c.supabaseUrl||'') &&
    !!c.supabasePublishableKey && !/REPLACE|YOUR_PROJECT|secret|service_role/i.test(c.supabasePublishableKey);
}
export class ApiFailure extends Error { constructor(msg,status=0){super(String(msg||'요청 실패'));this.status=status} }
const KEY='ongeol_supabase_session_v07';
const deepCopy = obj => JSON.parse(JSON.stringify(obj));
const enc = text => encodeURIComponent(text);
export class RemoteState {
  constructor(onError){this.onError=onError;this.session=null;this.shopId=null;this.role=null;this.shopName='';this.revision=0;this.staff=[];this.positions=[];this.privacy={};this.joinRequests=[];this.connectionCode="";this.pending=null;this.running=false;this.failed=false;this.refreshing=null;this.dirty=false;
    try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s?.access_token&&s?.refresh_token)this.session=s}catch{}}
  get token(){return this.session?.access_token||''}
  get base(){return (conf().supabaseUrl||'').replace(/\/$/,'')}
  get apikey(){return conf().supabasePublishableKey||''}
  get user(){return this.session?.user||null}
  storeSession(value){this.session=value;try{if(value)localStorage.setItem(KEY,JSON.stringify(value));else localStorage.removeItem(KEY)}catch{}}
  async raw(path,{method='GET',payload,token=this.token,headers={},retry=true}={}){
    if(!configurationReady())throw new ApiFailure('config.js에 Supabase URL과 publishable key를 설정하세요.');
    const body=payload===undefined?undefined:(payload instanceof Blob?payload:JSON.stringify(payload));
    const res=await fetch(this.base+path,{method,headers:{'apikey':this.apikey,...(token?{'Authorization':'Bearer '+token}:{}),...(payload!==undefined&&!(payload instanceof Blob)?{'Content-Type':'application/json'}:{}),...headers},body});
    const text=await res.text();let json;
    try{json=text?JSON.parse(text):null}catch{json=text}
    if(!res.ok){
      if(res.status===401&&retry&&this.session?.refresh_token&&token===this.token&&path!='/auth/v1/token?grant_type=refresh_token'){
        await this.refresh();return this.raw(path,{method,payload,token:this.token,headers,retry:false});
      }
      throw new ApiFailure(json?.message||json?.error_description||json?.msg||json?.hint||json?.details||json?.error||text||'서버 오류',res.status);
    }
    return json;
  }
  async signup(email,password){const r=await this.raw('/auth/v1/signup',{method:'POST',payload:{email,password},token:this.apikey});if(r?.access_token)this.accept(r);return r;}
  accept(r){const until=Math.floor(Date.now()/1000)+Number(r.expires_in||3600);this.storeSession({...r,expires_at:r.expires_at||until});}
  async login(email,password){const r=await this.raw('/auth/v1/token?grant_type=password',{method:'POST',payload:{email,password},token:this.apikey});this.accept(r);return r;}
  async refresh(){if(this.refreshing)return this.refreshing;
    const ref=this.session?.refresh_token;if(!ref)throw new ApiFailure('로그인 세션이 만료되었습니다. 다시 로그인하세요.',401);
    this.refreshing=(async()=>{try{const r=await this.raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',payload:{refresh_token:ref},token:this.apikey,retry:false});this.accept(r);return r;}catch(e){this.storeSession(null);throw e;}finally{this.refreshing=null;}})();return this.refreshing;
  }
  async ensureSession(){if(!this.session)return null;if((this.session.expires_at||0)*1000<Date.now()+120000)await this.refresh();return this.session;}
  async restore(){if(!this.session)return false;try{await this.ensureSession();const u=await this.raw('/auth/v1/user');if(u?.id){this.session.user=u;this.storeSession(this.session);return true}}catch{this.storeSession(null)}return false;}
  async logout(){try{if(this.session)await this.raw('/auth/v1/logout',{method:'POST'});}catch{}this.storeSession(null);this.shopId=null;this.revision=0;this.staff=[];this.positions=[];this.joinRequests=[];this.connectionCode="";this.pending=null;this.failed=false;}
  async rpc(name,parameters){await this.ensureSession();return this.raw('/rest/v1/rpc/'+name,{method:'POST',payload:parameters});}
  async membership(){await this.ensureSession();const r=await this.raw('/rest/v1/shop_members?select=shop_id,role&user_id=eq.'+enc(this.user?.id||'')+'&limit=1');
    const m=r?.[0];if(m){this.shopId=m.shop_id;this.role=m.role;return m}return null;
  }
  async createShop(name,staffName,positionName='',linkCreator=false){
    if(!String(staffName||'').trim())throw new ApiFailure('첫 직원 1명을 등록해 주세요.');
    const id=await this.rpc('aesthetic_create_shop_v3',{
      p_name:name,p_staff_name:staffName,p_staff_position_name:positionName||null,p_link_creator:!!linkCreator
    });this.shopId=id;this.role='owner';return id;
  }
  async listStaff(){if(!this.shopId)return [];
    const [staff,positions]=await Promise.all([
      this.raw('/rest/v1/staff_profiles?select=id,shop_id,name,title,position_id,access_role,auth_user_id,active&shop_id=eq.'+enc(this.shopId)+'&order=created_at.asc'),
      this.raw('/rest/v1/staff_positions?select=id,shop_id,name&shop_id=eq.'+enc(this.shopId)+'&order=created_at.asc')
    ]);
    this.staff=staff||[];this.positions=positions||[];
    return this.staff;
  }
  async acknowledgeMyStaffNotice(id,version){return this.rpc('aesthetic_ack_own_staff_notice',{p_shop:this.shopId,p_staff:id,p_version:version});}
  async accountDocuments(){
    await this.ensureSession();
    return this.raw('/rest/v1/privacy_account_documents?select=document_key,version&user_id=eq.'+enc(this.user?.id||''));
  }
  async acknowledgeAccountDocument(key,version){return this.rpc('aesthetic_ack_account_doc',{p_document:key,p_version:version});}
  async privacyStatus(){
    if(!this.shopId)return {};
    this.privacy=await this.rpc('aesthetic_privacy_status',{p_shop:this.shopId});return this.privacy;
  }
  async acceptShopDocument(key,version){return this.rpc('aesthetic_accept_shop_doc',{p_shop:this.shopId,p_document:key,p_version:version});}
  async recordPrivacyEvidence(subjectKind,subjectRef,purpose,basis,method,version,reference='',action='RECORDED'){
    return this.rpc('aesthetic_privacy_evidence',{
      p_shop:this.shopId,p_subject_kind:subjectKind,p_subject_ref:subjectRef,p_purpose:purpose,
      p_basis:basis,p_method:method,p_version:version,p_reference:reference,p_action:action
    });
  }
  async addStaff(name,positionId=null,role='therapist'){
    return this.rpc('aesthetic_create_staff_v2',{p_shop:this.shopId,p_name:name,p_position_id:positionId||null,p_access_role:role});
  }
  async editStaff(id,name,positionId,role,active){
    return this.rpc('aesthetic_update_staff_v2',{p_shop:this.shopId,p_staff:id,p_name:name,p_position_id:positionId||null,p_access_role:role,p_active:!!active});
  }
  async addPosition(name){return this.rpc('aesthetic_add_position',{p_shop:this.shopId,p_name:name});}
  async editPosition(id,name){return this.rpc('aesthetic_update_position',{p_shop:this.shopId,p_position:id,p_name:name});}
  async deletePosition(id){return this.rpc('aesthetic_delete_position',{p_shop:this.shopId,p_position:id});}
  async updateContactPhone(value){
    await this.ensureSession();
    const phone=String(value||'').trim();
    if(phone && !/^[+0-9\-\s()]{8,22}$/.test(phone))throw new ApiFailure('연락처 형식을 확인해 줘.');
    const user=await this.raw('/auth/v1/user',{method:'PUT',payload:{data:{...(this.user?.user_metadata||{}),contact_phone:phone}}});
    if(!user?.id||user.id!==this.user?.id)throw new ApiFailure('개인정보 업데이트 응답 확인 실패');
    this.session.user=user;this.storeSession(this.session);return user;
  }
  async linkOwnerStaff(id){return this.rpc('aesthetic_link_owner_staff',{p_shop:this.shopId,p_staff:id});}
  async unlinkOwnerStaff(id){return this.rpc('aesthetic_unlink_owner_staff',{p_shop:this.shopId,p_staff:id});}
  async inviteStaff(id){return this.rpc('aesthetic_invite_staff',{p_shop:this.shopId,p_staff:id});}
  async renameShop(name){await this.rpc('aesthetic_rename_shop',{p_shop:this.shopId,p_name:name});this.shopName=name;}
  async requestJoin(code){return this.rpc('aesthetic_request_join',{p_code:code});}
  async myJoinRequest(){return this.rpc('aesthetic_my_join_request',{});}
  async loadJoinRequests(){if(this.role!=='owner')return [];
    const [code,requests]=await Promise.all([
      this.rpc('aesthetic_get_connection_code',{p_shop:this.shopId}),
      this.raw('/rest/v1/shop_join_requests?select=id,shop_id,user_email,status,created_at&shop_id=eq.'+enc(this.shopId)+'&order=created_at.desc')
    ]);
    this.connectionCode=code;this.joinRequests=requests||[];return this.joinRequests;
  }
  async rotateConnectionCode(){this.connectionCode=await this.rpc('aesthetic_rotate_connection_code',{p_shop:this.shopId});return this.connectionCode;}
  async reviewJoin(params){return this.rpc('aesthetic_review_join',{
    p_request:params.p_request,p_action:params.p_action,p_staff:params.p_staff||null,
    p_staff_name:params.p_staff_name||null,p_position:params.p_position||null,p_access_role:params.p_access_role||'therapist'
  });}
  async staffDependencies(staffId){return this.rpc('aesthetic_staff_dependencies',{p_shop:this.shopId,p_staff:staffId});}
  async reassignStaff(fromId,toId){return this.rpc('aesthetic_reassign_staff',{p_shop:this.shopId,p_from:fromId,p_to:toId});}
  async deleteStaff(staffId){return this.rpc('aesthetic_delete_staff',{p_shop:this.shopId,p_staff:staffId});}
  async disconnectStaff(staffId){return this.rpc('aesthetic_disconnect_staff',{p_shop:this.shopId,p_staff:staffId});}
  async joinShop(){throw new ApiFailure('기존 매장 가입은 관리자 승인 후 가능합니다.');}
  async invite(role='therapist'){return this.rpc('ongeol_create_invite',{p_shop:this.shopId,p_role:role});}
  async read(){if(!this.shopId)throw new ApiFailure('매장 선택이 필요합니다.');await this.ensureSession();
    const [rows,shops]=await Promise.all([
      this.raw('/rest/v1/shop_states?select=revision,data&shop_id=eq.'+enc(this.shopId)+'&limit=1'),
      this.raw('/rest/v1/shops?select=name&id=eq.'+enc(this.shopId)+'&limit=1')
    ]);
    if(!rows?.length)throw new ApiFailure('매장 데이터에 접근할 수 없습니다. 관리자에게 문의하세요.',403);
    this.revision=Number(rows[0].revision);this.shopName=shops?.[0]?.name||'내 매장';
    const data=rows[0].data||{};
    if(data.staffNames?.length===1&&data.staffNames[0]==='원장'&&
       !(data.reservations||[]).some(r=>r.staff==='원장'))data.staffNames=[];
    const staff=await this.listStaff();
    // DB staff profiles are authoritative. Zero profiles means zero real employees.
    data.staffNames=staff.filter(x=>x.active).map(x=>x.name);
    await this.hydratePhotos(data);return data;
  }
  sanitized(state){const result=deepCopy(state);if(Array.isArray(result.photos))result.photos=result.photos.map(({dataUrl,...rest})=>rest);return result;}
  write(state){if(this.failed||!this.shopId)return;this.pending=this.sanitized(state);this.dirty=true;if(!this.running)void this.flush();}
  async flush(){if(this.running)return;this.running=true;
    while(this.pending&&!this.failed){const next=this.pending;this.pending=null;
      try{const r=await this.rpc('ongeol_save_state',{p_shop:this.shopId,p_expected_revision:this.revision,p_data:next});this.revision=Number(r);}
      catch(e){this.failed=true;this.pending=next;
        this.onError(e.status===409||/stale_revision/i.test(e.message)?'다른 기기에서 매장 데이터가 변경됐어. 이 기기의 미저장 수정사항은 서버에 반영되지 않았어. 다른 기기 작업을 확인한 뒤 새로고침해야 해.':'서버 저장 실패: '+e.message);
      }
    }
    this.running=false;this.dirty=!!this.pending;
  }
  async uploadPhoto(cid,blob){if(!this.shopId)throw new ApiFailure('매장 선택이 필요합니다.');if(blob.size>3*1024*1024)throw new ApiFailure('사진은 3MB 이하로 압축해서 저장하세요.');
    const p=this.shopId+'/'+String(cid).replace(/[^A-Za-z0-9_-]/g,'')+'/'+crypto.randomUUID()+'.jpg';
    await this.ensureSession();await this.raw('/storage/v1/object/ongeol-private/'+p,{method:'POST',payload:blob,headers:{'Content-Type':'image/jpeg','x-upsert':'false'}});return p;
  }
  async photoUrl(path){await this.ensureSession();const j=await this.raw('/storage/v1/object/sign/ongeol-private/'+path,{method:'POST',payload:{expiresIn:3600}});
    const url=j?.signedURL||j?.signedUrl||'';if(!url)return '';
    if(url.startsWith('https://'))return url;
    return this.base+(url.startsWith('/storage/v1')?'':'/storage/v1')+(url.startsWith('/')?'':'/')+url;
  }
  async hydratePhotos(data){if(!Array.isArray(data.photos))return;
    await Promise.all(data.photos.map(async p=>{if(p.storagePath){try{p.dataUrl=await this.photoUrl(p.storagePath)}catch{p.dataUrl='';}}}));
  }
  async analyze(){throw new ApiFailure('LLM 연결은 다음 단계에서 활성화합니다. 상담 내용은 직접 입력할 수 있습니다.');}
  async transcribe(){throw new ApiFailure('STT 연결은 다음 단계에서 활성화합니다. 녹음은 파일로 보관할 수 있습니다.');}
}
