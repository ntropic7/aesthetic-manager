import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteState,configurationReady,serverMode} from '../web/sync.js';
const sessionStore=new Map();
globalThis.localStorage={getItem:k=>sessionStore.get(k)||null,setItem:(k,v)=>sessionStore.set(k,v),removeItem:k=>sessionStore.delete(k)};
globalThis.window={ONGEOL_CONFIG:{apiMode:'supabase',supabaseUrl:'https://test123.supabase.co',supabasePublishableKey:'sb_publishable_test123'}};
let member=false, revision=0, state={customers:[],reservations:[],photos:[]},expectedAuth=[];
globalThis.fetch=async (url,opts={})=>{
 const u=String(url), body=opts.body&&!(opts.body instanceof Blob)?JSON.parse(opts.body):{};
 const fail=(msg,s=400)=>new Response(JSON.stringify({message:msg}),{status:s,headers:{'Content-Type':'application/json'}});
 let data;
 if(u.includes('/auth/v1/token?grant_type=password'))data={access_token:'token-a',refresh_token:'refresh-a',expires_in:3600,user:{id:'u1',email:'u@test.example'}};
 else if(u.endsWith('/auth/v1/user'))data={id:'u1',email:'u@test.example'};
 else if(u.includes('/rest/v1/shop_members?'))data=member?[{shop_id:'11111111-1111-4111-8111-111111111111',role:'owner'}]:[];
 else if(u.includes('/rest/v1/rpc/ongeol_create_shop')){member=true;data='11111111-1111-4111-8111-111111111111';}
 else if(u.includes('/rest/v1/shops?'))data=[{name:'테스트샵'}];
 else if(u.includes('/rest/v1/shop_states?'))data=[{revision,data:structuredClone(state)}];
 else if(u.includes('/rest/v1/rpc/ongeol_save_state')){
   assert.equal(opts.headers.Authorization,'Bearer token-a');
   if(body.p_expected_revision!==revision)return fail('stale_revision');
   state=body.p_data;revision+=1;data=revision;
 }else if(u.includes('/storage/v1/object/sign'))data={signedURL:'/object/sign/ongeol-private/x.jpg?token=mock'};
 else if(u.includes('/storage/v1/object/ongeol-private/'))data={Key:'uploaded'};
 else throw Error('unexpected URL '+url);
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
test('Supabase configuration checks valid, unsafe keys rejected',()=>{
 assert.equal(configurationReady(),true);assert.equal(serverMode(),true);
 window.ONGEOL_CONFIG.supabasePublishableKey='service_role_danger';assert.equal(configurationReady(),false);
 window.ONGEOL_CONFIG.supabasePublishableKey='sb_publishable_test123';
});
test('password login, owner onboarding, shop data read and persisted state CAS',async()=>{
 const errors=[],r=new RemoteState(m=>errors.push(m));
 await r.login('u@test.example','anything'); assert.equal(r.token,'token-a');
 assert.equal(await r.membership(),null);await r.createShop('테스트샵');
 assert.equal((await r.membership()).role,'owner');
 assert.deepEqual(await r.read(),state);assert.equal(r.shopName,'테스트샵');
 r.write({customers:[{id:'C1',name:'가상 고객'}],reservations:[],photos:[{id:'PH1',storagePath:'x.jpg',dataUrl:'sensitive data'}]});
 while(r.running)await new Promise(res=>setTimeout(res,5));
 assert.equal(revision,1);assert.equal(state.customers[0].name,'가상 고객');assert.equal(state.photos[0].dataUrl,undefined);
 assert.equal(errors.length,0);
});
test('remote overwrite conflict is not silently accepted',async()=>{
 const errors=[],r=new RemoteState(m=>errors.push(m));r.shopId='11111111-1111-4111-8111-111111111111';
 await r.read();revision += 1; // 다른 기기가 먼저 저장했다고 가정
 r.write({customers:[],reservations:[]});while(r.running)await new Promise(res=>setTimeout(res,5));
 assert.equal(r.failed,true);assert.match(errors[0],/다른 기기/);
});
