window.__cloud={privacyAccount:[],privacyShop:[],privacyEvidence:[],member:false,rev:0,staff:[],positions:[],shop:'e6ab12ff-ffff-4f48-a98a-ccbca2d55ab4',data:{customers:[],reservations:[],consultations:[],followups:[],audits:[],photos:[],waitlist:[],inventory:[],treatments:[],membershipUsages:[],payments:[],messageDrafts:[],staffShifts:[],intakeForms:[],consents:[],campaigns:[],snapshots:[],messageQueue:[],hygieneTasks:[],shopTasks:[],staffNames:[],rooms:['공간 A'],services:[],weekSeeded:true,shopConfig:{name:'테스트 스튜디오',parkingMinutes:120,cancelHours:24,commissions:[]}}};
window.fetch=async(url,opts={})=>{
 const path=String(url);const b=opts.body&&typeof opts.body==='string'?JSON.parse(opts.body):{};
 const db=window.__cloud;let data,st=200;
 if(path.includes('/auth/v1/token?grant_type=password'))data={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'bb0ac294-cccc-4f48-955a-908bd270cee2',email:'test@example.com'}};
 else if(path.includes('/auth/v1/user'))data={id:'bb0ac294-cccc-4f48-955a-908bd270cee2',email:'test@example.com',user_metadata: b.data||{}};
 else if(path.includes('/rest/v1/privacy_account_documents?'))data=db.privacyAccount;
 else if(path.includes('/rest/v1/rpc/aesthetic_ack_account_doc')){db.privacyAccount.push({document_key:b.p_document,version:b.p_version});data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_accept_shop_doc')){db.privacyShop.push(b.p_document);data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_privacy_status'))data={processing_agreement:db.privacyShop.includes('processing_agreement'),shop_privacy_responsibility:db.privacyShop.includes('shop_privacy_responsibility'),evidence_count:db.privacyEvidence.length};
 else if(path.includes('/rest/v1/rpc/aesthetic_privacy_evidence')){db.privacyEvidence.push(b);data='ev-'+db.privacyEvidence.length;}
 else if(path.includes('/rest/v1/rpc/aesthetic_ack_own_staff_notice'))data=true;
 else if(path.includes('/rest/v1/shop_members?'))data=db.member?[{shop_id:db.shop,user_id:'bb0ac294-cccc-4f48-955a-908bd270cee2',role:'owner'}]:[];
 else if(path.includes('/rest/v1/rpc/aesthetic_create_shop_v3')){
   db.member=true;db.data.shopConfig.name=b.p_name;
   const pos=b.p_staff_position_name?{id:'pos-1',name:b.p_staff_position_name}:null;
   if(pos)db.positions.push(pos);
   db.staff.push({id:'staff-1',name:b.p_staff_name,position_id:pos?.id||null,access_role:'therapist',active:true,auth_user_id:b.p_link_creator?'bb0ac294-cccc-4f48-955a-908bd270cee2':null});
   db.data.staffNames=[b.p_staff_name];data=db.shop;
 }
 else if(path.includes('/rest/v1/rpc/aesthetic_get_connection_code'))data='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 else if(path.includes('/rest/v1/shop_join_requests?'))data=[];
 else if(path.includes('/rest/v1/rpc/aesthetic_staff_dependencies')){
    const profile=db.staff.find(x=>x.id===b.p_staff),n=profile?.name;
    const matches=db.data.reservations.filter(x=>x.staff===n).length;
    data=matches?{reservations:matches}:{};
 }
 else if(path.includes('/rest/v1/rpc/aesthetic_delete_staff')){
   const item=db.staff.find(x=>x.id===b.p_staff);
   if(db.staff.filter(x=>x.active).length<2){st=400;data={message:'at_least_one_staff_required'}}
   else if(item.auth_user_id){st=400;data={message:'linked_account_disconnect_first'}}
   else{db.staff=db.staff.filter(x=>x.id!==b.p_staff);db.data.staffNames=db.staff.filter(x=>x.active).map(x=>x.name);db.rev++;data=true}
 }
 else if(path.includes('/rest/v1/rpc/aesthetic_reassign_staff')){data=++db.rev;}
 else if(path.includes('/rest/v1/rpc/aesthetic_disconnect_staff')){db.staff.find(x=>x.id===b.p_staff).auth_user_id=null;data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_my_join_request'))data=null;
 else if(path.includes('/rest/v1/rpc/aesthetic_request_join'))data='pending';
 else if(path.includes('/rest/v1/rpc/aesthetic_review_join'))data=true;
 else if(path.includes('/rest/v1/rpc/aesthetic_add_position')){const item={id:'pos-'+(db.positions.length+1),name:b.p_name};db.positions.push(item);data=item.id;}
 else if(path.includes('/rest/v1/rpc/aesthetic_update_position')){const item=db.positions.find(x=>x.id===b.p_position);if(item)item.name=b.p_name;data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_delete_position')){db.positions=db.positions.filter(x=>x.id!==b.p_position);data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_create_staff_v2')){const item={id:'staff-'+(db.staff.length+1),name:b.p_name,position_id:b.p_position_id,title:null,access_role:b.p_access_role,auth_user_id:null,active:true};db.staff.push(item);data=item.id;}
 else if(path.includes('/rest/v1/rpc/aesthetic_update_staff_v2')){const item=db.staff.find(x=>x.id===b.p_staff); if(!item){st=404;data={message:'not found'}}else{Object.assign(item,{name:b.p_name,position_id:b.p_position_id,access_role:b.p_access_role,active:b.p_active});data=true}}
 else if(path.includes('/rest/v1/rpc/aesthetic_link_owner_staff')){const item=db.staff.find(x=>x.id===b.p_staff);if(item)item.auth_user_id='bb0ac294-cccc-4f48-955a-908bd270cee2';data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_unlink_owner_staff')){const item=db.staff.find(x=>x.id===b.p_staff);if(item)item.auth_user_id=null;data=true;}
 else if(path.includes('/rest/v1/rpc/aesthetic_invite_staff'))data='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 else if(path.includes('/rest/v1/staff_profiles?'))data=db.staff;
 else if(path.includes('/rest/v1/staff_positions?'))data=db.positions;
 else if(path.includes('/rest/v1/shops?'))data=[{name:'테스트 스튜디오'}];
 else if(path.includes('/rest/v1/shop_states?'))data=[{revision:db.rev,data:structuredClone(db.data)}];
 else if(path.includes('/rest/v1/rpc/ongeol_save_state')){if((b.p_data.customers||[]).length && !db.privacyShop.includes('processing_agreement')){st=403;data={message:'shop_privacy_documents_required'};}else if((b.p_data.customers||[]).some(c=>!db.privacyEvidence.some(e=>e.p_subject_ref===c.id&&e.p_purpose==='customer_basic'))){st=403;data={message:'customer_lawful_basis_missing'};}else if(b.p_expected_revision!==db.rev){st=400;data={message:'stale_revision'}}else {db.data=b.p_data;db.rev++;data=db.rev}}
 else if(path.includes('/storage/'))data={signedURL:'/object/sign/ongeol-private/x.jpg?token=mock'};
 else{st=400;data={message:'unexpected '+path}}
 return {ok:st===200,status:st,text:async()=>JSON.stringify(data)};
};
