import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let src=fs.readFileSync(new URL('./src/app.js',import.meta.url),'utf8');
src=src.replace(/^import .*;$/gm,'');
src=src.replace(/if\(serverMode\(\)\)enterRemote\(\);else render\(\);\s*$/,'');
const fields={};
const document={addEventListener(){},querySelector(key){if(key==='#modalRoot'||key==='#toastRoot')return {innerHTML:'',style:{}};return fields[key]||{value:'',checked:false,innerHTML:'',style:{}}},querySelectorAll(){return []}};
const storage={getItem(){return null},setItem(){}};
const context=vm.createContext({document,window:{},localStorage:storage,sessionStorage:storage,console,Date,Intl,Math,setTimeout(){},confirm(){return true},alert(){},RemoteState:class {},serverMode(){return false},bookingConflict(appts,proposal,ignore){const mins=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));if(proposal.archived||['CANCELLED','NO_SHOW'].includes(proposal.status))return null;return appts.find(r=>r.id!==ignore&&r.date===proposal.date&&!r.archived&&!['CANCELLED','NO_SHOW'].includes(r.status)&&mins(proposal.time)<mins(r.time)+r.minutes&&mins(proposal.time)+proposal.minutes>mins(r.time)&&(r.staff===proposal.staff||r.room===proposal.room))||null;}});
vm.runInContext(src,context,{timeout:1500});
vm.runInContext('toast=()=>{};save=()=>{};render=()=>{};closeModal=()=>{};openAfterTreatment=()=>{};',context);
const evalCode=expr=>vm.runInContext(expr,context);
const setField=(name,value,checked=false)=>fields['#'+name]={value,checked};

test('state seed, complete menus, marketing and timetable',()=>{
 assert.equal(evalCode('state.customers.length'),4);
 assert.ok(evalCode('ZOOM_LEVELS.includes(.12)'));
 assert.ok(evalCode("renderOperations().includes('대기예약')"));
 assert.ok(evalCode("renderMarketing().includes('CRM 고객')"));
 assert.ok(evalCode("renderReservations().includes('시간표 크기')"));
 assert.ok(evalCode('Array.isArray(state.photos)'));
});
test('holiday conflict and no-show recovery safety',()=>{
 evalCode("state.staffShifts.push({type:'OFF',staff:'김원장',date:'2026-11-16',reason:'휴가'})");
 assert.equal(evalCode("conflictFor({date:'2026-11-16',time:'10:00',minutes:60,staff:'김원장',room:'관리실 A',status:'CONFIRMED'})?.time"),'휴무');
 assert.equal(evalCode("conflictFor({...state.reservations[0],id:'R-OTHER',time:state.reservations[0].time},'R-OTHER')?.id"),'R001');
});
test('completion is idempotent and member use rolls back',()=>{
 const used=evalCode("state.customers.find(c=>c.id==='C001').membership.used");
 evalCode("window._treatmentId='R001'");
 setField('txPayType','membership');setField('txAmount','0');setField('txRebook','',false);
 for(const name of ['txBefore','txAfter','txProducts','txDevice','txNote'])setField(name,'시연');
 setField('txPressure','약하게');
 evalCode('saveTreatment()');
 assert.equal(evalCode("state.customers.find(c=>c.id==='C001').membership.used"),used+1);
 assert.equal(evalCode("state.treatments.filter(x=>x.reservationId==='R001'&&!x.voided).length"),1);
 evalCode('saveTreatment()');
 assert.equal(evalCode("state.customers.find(c=>c.id==='C001').membership.used"),used+1);
 evalCode("undoCompletion(state.reservations.find(x=>x.id==='R001'))");
 assert.equal(evalCode("state.customers.find(c=>c.id==='C001').membership.used"),used);
});
