import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteState,configurationReady,serverMode} from '../web/sync.js';
const sessionStore=new Map();
globalThis.localStorage={getItem:k=>sessionStore.get(k)||null,setItem:(k,v)=>sessionStore.set(k,v),removeItem:k=>sessionStore.delete(k)};
globalThis.window={ONGEOL_CONFIG:{apiMode:'supabase',supabaseUrl:'https://test123.supabase.co',supabasePublishableKey:'sb_publishable_test123'}};
let member=false, revision=0, staff=[], positions=[], state={customers:[],reservations:[],photos:[]},expectedAuth=[];
globalThis.fetch=async (url,opts={})=>{
 const u=String(url), body=opts.body&&!(opts.body instanceof Blob)?JSON.parse(opts.body):{};
 const fail=(msg,s=400)=>new Response(JSON.stringify({message:msg}),{status:s,headers:{'Content-Type':'application/json'}});
 let data;
 if(u.includes('/auth/v1/token?grant_type=password'))data={access_token:'token-a',refresh_token:'refresh-a',expires_in:3600,user:{id:'u1',email:'u@test.example'}};
 else if(u.endsWith('/auth/v1/user')&&opts.method==='PUT')data={id:'u1',email:'u@test.example',user_metadata:body.data||{}};
 else if(u.endsWith('/auth/v1/user'))data={id:'u1',email:'u@test.example'};
 else if(u.includes('/rest/v1/shop_members?'))data=member?[{shop_id:'11111111-1111-4111-8111-111111111111',role:'owner'}]:[];
 else if(u.includes('/rest/v1/rpc/aesthetic_create_shop')){member=true;data='11111111-1111-4111-8111-111111111111';}
 else if(u.includes('/rest/v1/rpc/aesthetic_add_position')){const x={id:'pos-1',name:body.p_name};positions.push(x);data=x.id;}
 else if(u.includes('/rest/v1/rpc/aesthetic_create_staff_v2')){const x={id:'staff-1',name:body.p_name,position_id:body.p_position_id,access_role:body.p_access_role,active:true};staff.push(x);data=x.id;}
 else if(u.includes('/rest/v1/rpc/aesthetic_invite_staff'))data='11111111-aaaa-4aaa-8aaa-111111111111';
 else if(u.includes('/rest/v1/staff_profiles?'))data=staff;
 else if(u.includes('/rest/v1/staff_positions?'))data=positions;
 else if(u.endsWith('/auth/v1/otp')){assert.equal(body.phone,'+821012345678');data={};}
 else if(u.endsWith('/auth/v1/verify')){
   assert.equal(body.phone,'+821012345678');
   data=body.type==='phone_change'?{user:{id:'u1',phone:body.phone}}:{access_token:'token-phone',refresh_token:'refresh-phone',expires_in:3600,user:{id:'u1',phone:body.phone}};
 }
 else if(u.endsWith('/auth/v1/user')&&opts.method==='PUT') {assert.equal(body.phone,'+821012345678');data={user:{id:'u1',phone:body.phone}};}
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
 assert.equal((await r.read()).customers.length,0);assert.equal(r.staff.length,0);assert.equal(r.positions.length,0);
 const pos=await r.addPosition('실장');await r.addStaff('김민지',pos,'therapist');await r.listStaff();
 assert.equal(r.staff.length,1);assert.equal(r.staff[0].position_id,pos);assert.equal(r.positions[0].name,'실장');assert.equal(r.shopName,'테스트샵');
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

test('personal contact is optional metadata, not SMS login',async()=>{
 const r=new RemoteState(()=>{});
 await r.login('u@test.example','anything');
 const user=await r.updateContactPhone('010-1111-2222');
 assert.equal(user.user_metadata.contact_phone,'010-1111-2222');
 assert.rejects(()=>r.updateContactPhone('bad-phone'),/연락처/);
});
