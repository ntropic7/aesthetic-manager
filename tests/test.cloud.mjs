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
 else if(u.includes('/rest/v1/shop_members?'))data=member?[{shop_id:'11111111-1111-4111-8111-111111111111',user_id:'u1',role:'owner'}]:[];
 else if(u.includes('/rest/v1/rpc/aesthetic_create_shop_v3')){member=true;staff.push({id:'staff-first',name:body.p_staff_name,position_id:'pos-first',access_role:'therapist',auth_user_id:body.p_link_creator?'u1':null,active:true});positions.push({id:'pos-first',name:body.p_staff_position_name});data='11111111-1111-4111-8111-111111111111';}
 else if(u.includes('/rest/v1/rpc/aesthetic_add_position')){const x={id:'pos-1',name:body.p_name};positions.push(x);data=x.id;}
 else if(u.includes('/rest/v1/rpc/aesthetic_get_connection_code'))data='12345678-1234-4234-8234-123456789abc';
 else if(u.includes('/rest/v1/rpc/aesthetic_rotate_connection_code'))data='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 else if(u.includes('/rest/v1/shop_join_requests?'))data=[{id:'req-1',user_email:'new@shop.example',status:'pending',created_at:'2026-10-25T11:00:00Z'}];
 else if(u.includes('/rest/v1/rpc/aesthetic_review_join')){assert.equal(body.p_request,'req-1');assert.equal(body.p_action,'approve');assert.equal(body.p_staff,'staff-1');data=true;}
 else if(u.includes('/rest/v1/rpc/aesthetic_my_join_request'))data={status:'pending',shop_name:'테스트샵'};
 else if(u.includes('/rest/v1/rpc/aesthetic_request_join')){assert.equal(body.p_code,'12345678-1234-4234-8234-123456789abc');data='pending';}
 else if(u.includes('/rest/v1/rpc/aesthetic_staff_dependencies'))data={reservations:2};
 else if(u.includes('/rest/v1/rpc/aesthetic_reassign_staff'))data=revision+1;
 else if(u.includes('/rest/v1/rpc/aesthetic_delete_staff'))data=true;
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
 assert.equal(await r.membership(),null);await r.createShop('테스트샵','첫 직원','원장',true);
 assert.equal((await r.membership()).role,'owner');
 assert.equal((await r.read()).customers.length,0);assert.equal(r.staff.length,1);assert.equal(r.positions.length,1);assert.equal(r.staff[0].linked_role,'owner');assert.equal(r.staff[0].access_role,'therapist');
 const pos=await r.addPosition('실장');await r.addStaff('김민지',pos,'therapist');await r.listStaff();
 assert.equal(r.staff.length,2);assert.equal(r.staff[1].position_id,pos);assert.equal(r.positions[1].name,'실장');assert.equal(r.shopName,'테스트샵');
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

test('new shop cannot be created without first staff',async()=>{
 const r=new RemoteState(()=>{});await assert.rejects(r.createShop('매장',''),/첫 직원/);
});

test('join requires a pending request, and only manager approval connects an existing profile',async()=>{
 const r=new RemoteState(()=>{});await r.login('u@test.example','pw');await r.membership();
 const requests=await r.loadJoinRequests();assert.equal(requests.length,1);
 assert.match(r.connectionCode,/^[0-9a-f-]{36}$/);
 assert.equal(await r.requestJoin('12345678-1234-4234-8234-123456789abc'),'pending');
 assert.equal((await r.myJoinRequest()).status,'pending');
 await r.reviewJoin({p_request:'req-1',p_action:'approve',p_staff:'staff-1'});
 assert.equal(await r.rotateConnectionCode(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 assert.deepEqual(await r.staffDependencies('staff-1'),{reservations:2});
 await r.reassignStaff('staff-1','staff-2');await r.deleteStaff('staff-2');
 await assert.rejects(()=>r.joinShop('fake'),/관리자 승인/);
});
