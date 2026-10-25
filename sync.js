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
  constructor(onError){this.onError=onError;this.session=null;this.shopId=null;this.role=null;this.shopName='';this.revision=0;this.pending=null;this.running=false;this.failed=false;this.refreshing=null;this.dirty=false;
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
  async logout(){try{if(this.session)await this.raw('/auth/v1/logout',{method:'POST'});}catch{}this.storeSession(null);this.shopId=null;this.revision=0;this.pending=null;this.failed=false;}
  async rpc(name,parameters){await this.ensureSession();return this.raw('/rest/v1/rpc/'+name,{method:'POST',payload:parameters});}
  async membership(){await this.ensureSession();const r=await this.raw('/rest/v1/shop_members?select=shop_id,role&user_id=eq.'+enc(this.user?.id||'')+'&limit=1');
    const m=r?.[0];if(m){this.shopId=m.shop_id;this.role=m.role;return m}return null;
  }
  async createShop(name){const id=await this.rpc('ongeol_create_shop',{p_name:name});this.shopId=id;this.role='owner';return id;}
  async joinShop(code){const id=await this.rpc('ongeol_join_shop',{p_code:code});this.shopId=id;return this.membership();}
  async invite(role='therapist'){return this.rpc('ongeol_create_invite',{p_shop:this.shopId,p_role:role});}
  async read(){if(!this.shopId)throw new ApiFailure('매장 선택이 필요합니다.');await this.ensureSession();
    const [rows,shops]=await Promise.all([
      this.raw('/rest/v1/shop_states?select=revision,data&shop_id=eq.'+enc(this.shopId)+'&limit=1'),
      this.raw('/rest/v1/shops?select=name&id=eq.'+enc(this.shopId)+'&limit=1')
    ]);
    if(!rows?.length)throw new ApiFailure('매장 데이터에 접근할 수 없습니다. 관리자에게 문의하세요.',403);
    this.revision=Number(rows[0].revision);this.shopName=shops?.[0]?.name||'내 피부관리샵';
    const data=rows[0].data||{};await this.hydratePhotos(data);return data;
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
