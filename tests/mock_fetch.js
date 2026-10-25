window.__cloud={member:false,rev:0,shop:'e6ab12ff-ffff-4f48-a98a-ccbca2d55ab4',data:{customers:[],reservations:[],consultations:[],followups:[],audits:[],photos:[],waitlist:[],inventory:[],treatments:[],membershipUsages:[],payments:[],messageDrafts:[],staffShifts:[],intakeForms:[],consents:[],campaigns:[],snapshots:[],messageQueue:[],hygieneTasks:[],shopTasks:[],staffNames:['원장'],rooms:['관리실 A'],services:[],weekSeeded:true,shopConfig:{name:'테스트 스킨샵',parkingMinutes:120,cancelHours:24,commissions:[]}}};
window.fetch=async(url,opts={})=>{
 const path=String(url);const b=opts.body&&typeof opts.body==='string'?JSON.parse(opts.body):{};
 const db=window.__cloud;let data,st=200;
 if(path.includes('/auth/v1/token?grant_type=password'))data={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'bb0ac294-cccc-4f48-955a-908bd270cee2',email:'test@example.com'}};
 else if(path.includes('/auth/v1/user'))data={id:'bb0ac294-cccc-4f48-955a-908bd270cee2',email:'test@example.com'};
 else if(path.includes('/rest/v1/shop_members?'))data=db.member?[{shop_id:db.shop,role:'owner'}]:[];
 else if(path.includes('/rest/v1/rpc/ongeol_create_shop')){db.member=true;data=db.shop}
 else if(path.includes('/rest/v1/shops?'))data=[{name:'테스트 스킨샵'}];
 else if(path.includes('/rest/v1/shop_states?'))data=[{revision:db.rev,data:structuredClone(db.data)}];
 else if(path.includes('/rest/v1/rpc/ongeol_save_state')){if(b.p_expected_revision!==db.rev){st=400;data={message:'stale_revision'}}else {db.data=b.p_data;db.rev++;data=db.rev}}
 else if(path.includes('/storage/'))data={signedURL:'/object/sign/ongeol-private/x.jpg?token=mock'};
 else{st=400;data={message:'unexpected '+path}}
 return {ok:st===200,status:st,text:async()=>JSON.stringify(data)};
};
