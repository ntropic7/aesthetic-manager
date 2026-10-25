import { bookingConflict } from './domain.js';
import { RemoteState, serverMode, configurationReady } from './sync.js';

'use strict';
const KEY='ongeol_platform_v06';
const remote = new RemoteState((message)=>{
  let n=document.getElementById('cloudError');if(!n){n=document.createElement('div');n.className='cloud-banner';n.id='cloudError';document.body.appendChild(n)}
  n.textContent=message+' ';const btn=document.createElement('button');btn.textContent='서버에서 다시 불러오기';btn.onclick=()=>location.reload();n.appendChild(btn);
});
const TODAY = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateAdd = (day,n) => {const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const datePretty = d => new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',month:'long',day:'numeric',weekday:'long'}).format(new Date(d+'T00:00:00Z'));
const weekdayShort = d => new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',weekday:'short'}).format(new Date(d+'T00:00:00Z'));
const weekStart = d => {const day=new Date(d+'T00:00:00Z').getUTCDay();return dateAdd(d,-((day+6)%7))};
const toHHMM = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const snap15 = m => Math.round(m/15)*15;
const ZOOM_LEVELS=[.12,.16,.22,.3,.42,.55,.75,.95,1.25];
let scheduleDate=TODAY(),scheduleMode='timetable',staffFilter='ALL',weekStaff='미지정',statusFilter='ALL',scheduleZoom=0.30,weekFit=true,editingReservationId=null,dragIntent=null,pointerBooking=null,afterCompletionId=null,suppressBookingClickUntil=0;
const nav=[['today','◫','오늘'],['reservations','▦','예약'],['customers','♙','고객'],['ai','✧','상담 AI'],['memberships','◉','회원권·결제'],['operations','▧','운영 도구'],['marketing','↗','마케팅'],['analytics','▥','매출·분석'],['settings','⚙','설정']];
const seed=()=>({customers:[
 {id:'C001',name:'김하린',phone:'010-****-1248',joined:'2025-12-03',last:'2026-10-08',type:'복합성',concerns:['홍조'],pressure:'보통',precautions:['성분 사용 전 확인 필요'],vehicle:'12가****',tags:['VIP'],membership:{name:'수분 집중관리 10회권',total:10,used:4,expire:'2027-03-31'},events:[],notes:'볼 부위 반응을 주의 깊게 확인',history:[{date:'2026-10-08',label:'수분 집중관리',note:'진정 팩 사용'}]},
 {id:'C002',name:'이지안',phone:'010-****-3821',joined:'2026-09-05',last:'2026-09-29',type:'건성',concerns:['탄력'],pressure:'보통',precautions:[],vehicle:'',tags:['신규'],membership:{name:'탄력관리 5회권',total:5,used:1,expire:'2027-02-28'},events:[],notes:'',history:[{date:'2026-09-29',label:'탄력관리',note:'첫 관리'}]},
 {id:'C003',name:'박서윤',phone:'010-****-0635',joined:'2025-08-14',last:'2026-10-12',type:'민감성',concerns:['건조함','트러블'],pressure:'약하게',precautions:['향이 강한 제품 주의'],vehicle:'29나****',tags:['재방문'],membership:{name:'진정관리 5회권',total:5,used:4,expire:'2026-11-30'},events:[],notes:'',history:[{date:'2026-10-12',label:'진정관리',note:'사용제품 기록'}]},
 {id:'C004',name:'정유리',phone:'010-****-7092',joined:'2026-10-17',last:'',type:'미확인',concerns:[],pressure:'미확인',precautions:[],allergies:[],photoConsent:false,recordingConsent:false,marketingConsent:false,vehicle:'',tags:['신규'],membership:null,events:[],notes:'첫 상담 예정',history:[]}
 ],reservations:[
 {date:TODAY(),id:'R001',cid:'C001',time:'10:00',minutes:90,service:'수분 집중관리',staff:'김원장',room:'관리실 A',status:'CONFIRMED',parking:false},
 {date:TODAY(),id:'R002',cid:'C002',time:'11:30',minutes:60,service:'탄력 집중관리',staff:'이관리사',room:'관리실 B',status:'CONFIRMED',parking:true},
 {date:TODAY(),id:'R003',cid:'C004',time:'14:00',minutes:60,service:'신규 상담 + 피부관리',staff:'김원장',room:'관리실 A',status:'CONFIRMED',parking:false},
 {date:TODAY(),id:'R004',cid:'C003',time:'16:00',minutes:90,service:'진정 집중관리',staff:'이관리사',room:'관리실 B',status:'ARRIVED',parking:true}
 ,{date:dateAdd(TODAY(),1),id:'R005',cid:'C001',time:'13:00',minutes:90,service:'수분 집중관리',staff:'김원장',room:'관리실 A',status:'CONFIRMED',parking:false}
 ],followups:[],audits:[]});
let state;try{state=JSON.parse(localStorage.getItem(KEY)||localStorage.getItem('ongeol_prototype_v05')||localStorage.getItem('ongeol_prototype_v04')||localStorage.getItem('ongeol_prototype_v03'))||seed()}catch(e){state=seed()}
function ensureDemoState(){
 if(serverMode()){
   state.consultations ||= [];state.followups ||= [];state.audits ||= [];
   state.treatments ||= [];state.membershipUsages ||= [];state.payments ||= [];state.messageDrafts ||= [];
   state.weekSeeded = true;state.reservations.forEach(r=>r.archived=!!r.archived);
   state.customers.forEach(c=>{c.events ||= [];c.history ||= [];c.concerns ||= [];c.precautions ||= [];c.tags ||= [];});
   return;
 }
 state.consultations ||= [
   {id:'CO-DEMO-1',cid:'C001',date:'2026-10-08',status:'APPROVED',note:'볼 부위의 일시적인 민감도를 확인하고 진정 관리 위주로 진행. 다음 방문 시 강도 확인 예정.',transcript:'시연용 과거 상담 예시',appliedChanges:0,source:'SAMPLE'},
   {id:'CO-DEMO-2',cid:'C003',date:'2026-10-12',status:'APPROVED',note:'관리 후 피부 반응 확인. 향이 강한 제품은 피하는 방향으로 상담.',transcript:'시연용 과거 상담 예시',appliedChanges:0,source:'SAMPLE'}
 ];
  state.followups ||= [];state.audits ||= [];state.treatments ||= [];state.membershipUsages ||= [];state.payments ||= [];state.messageDrafts ||= [];
  if(!state.weekSeeded){const monday=weekStart(TODAY());for(let i=0;i<7;i++){const date=dateAdd(monday,i);if(date===TODAY())continue;const examples=[{time:'10:00',cid:'C003',staff:'김원장',room:'관리실 A',minutes:60,service:'진정 집중관리'},{time:'13:30',cid:'C002',staff:'이관리사',room:'관리실 B',minutes:90,service:'탄력 집중관리'},{time:'16:30',cid:'C001',staff:'김원장',room:'관리실 A',minutes:60,service:'수분 집중관리'}];for(let j=0;j<examples.length;j++){const r=examples[j];if(!state.reservations.some(x=>x.date===date&&x.time===r.time&&x.staff===r.staff))state.reservations.push({...r,date,id:`R-W${i}-${j}`,status:'CONFIRMED',parking:false});}}state.weekSeeded=true;}
  state.reservations.forEach(r=>{r.archived=!!r.archived});
 state.customers.forEach(c=>{c.events ||= [];c.history ||= [];c.concerns ||= [];c.precautions ||= [];c.tags ||= [];});
}
ensureDemoState();
let view='customers',selectedCustomer='C001',customerTab='overview',customerMobileDetail=false,analysisResult=null,activeConsultCid='C001',aiCase='visit';
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){if(serverMode()){if(remote.role==='therapist'){toast('직원 계정은 현재 조회 전용이야. 상세 업무별 권한 적용 후 편집이 가능해져.');return;}remote.write(state);return}try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){toast('저장공간이 제한된 환경입니다.')}}
function toast(msg){$('#toastRoot').innerHTML=`<div class="toast">${esc(msg)}</div>`;setTimeout(()=>$('#toastRoot').innerHTML='',2900)}
const customer=id=>state.customers.find(c=>c.id===id);
const staffLabel = name => {const member=remote.staff?.find(x=>x.name===name);const position=remote.positions?.find(p=>p.id===member?.position_id)?.name||member?.title||'';return position?`${name} · ${position}`:name;};
function button(label,action,extra=''){return `<button type="button" class="btn ${extra}" data-act="${action}">${label}</button>`}
function header(eyebrow,title,subtitle,right=''){return `<div class="pagehead"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtle">${subtitle}</p></div><div>${right}</div></div>`}
function setView(v){view=v;render();window.scrollTo(0,0)}
function render(){const n=nav.find(x=>x[0]===view);$('#breadcrumb').textContent=n?.[2]||'오늘';$('#sidebarNav').innerHTML=nav.map(x=>`<button class="navlink ${view===x[0]?'active':''}" data-nav="${x[0]}"><span class="ico">${x[1]}</span><span class="navlabel">${x[2]}</span>${''}</button>`).join('');$('#mobileNav').innerHTML=[nav[0],nav[1],nav[2],nav[5],nav[6]].map(x=>`<button data-nav="${x[0]}" class="${view===x[0]?'active':''}"><span>${x[1]}</span>${x[2]}</button>`).join('');const funcs={today:renderToday,reservations:renderReservations,customers:renderCustomers,ai:renderAI,memberships:renderMemberships,operations:renderOperations,marketing:renderMarketing,analytics:renderAnalytics,settings:renderSettings};$('#main').innerHTML=funcs[view]();}
function stat(label,value,hint){return `<div class="stat"><div class="caption">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`}
const statusText={CONFIRMED:'예약 확정',ARRIVED:'방문 접수',IN_SERVICE:'관리 중',COMPLETED:'관리 완료',CANCELLED:'취소',NO_SHOW:'노쇼'};
const CONSUMING = x => !['CANCELLED','NO_SHOW'].includes(x.status)&&!x.archived;
const SLOT_START=9*60,SLOT_END=21*60;
const STAFf=['미지정'];
const statusKind = code => ['CANCELLED','NO_SHOW'].includes(code)?'is-muted':code==='COMPLETED'?'is-done':code==='ARRIVED'?'is-arrived':'is-active';
const todayReservations=() => state.reservations.filter(r=>(r.date||TODAY())===TODAY());
const filteredReservations=() => {const first=scheduleMode==='week'?weekStart(scheduleDate):scheduleDate,last=scheduleMode==='week'?dateAdd(first,6):scheduleDate;return state.reservations.filter(r=>r.date>=first&&r.date<=last&&(scheduleMode==='week'?r.staff===weekStaff:(staffFilter==='ALL'||r.staff===staffFilter))&&(statusFilter==='ARCHIVED'?r.archived:!r.archived&&(statusFilter==='ALL'||r.status===statusFilter))).sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time)||a.staff.localeCompare(b.staff))};
function renderToday(){const active=todayReservations().filter(r=>!['CANCELLED','NO_SHOW'].includes(r.status));const pendingCars=active.filter(r=>!r.parking&&customer(r.cid)?.vehicle).length;const completed=active.filter(r=>r.status==='COMPLETED').length;return header('DASHBOARD','좋은 하루의 시작, '+esc(state.shopConfig?.name||remote.shopName||'우리 매장'),TODAY()+' · 매장 운영 현황',button('＋ 예약 등록','newReservation','primary'))+`<div class="grid4">${stat('오늘 예약',active.length+'건','확정 및 방문 포함')}${stat('관리 완료',completed+'건','완료 버튼으로 갱신')}${stat('고객 수',state.customers.length+'명','등록된 고객 데이터')}${stat('미처리 주차',pendingCars+'건','차량 등록 고객 기준')}</div><div class="layout2"><section class="panel"><div class="panelhead"><h2>오늘의 예약</h2><span class="sectiontag">시간순</span></div>${active.length?active.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(r=>{const c=customer(r.cid);return `<div class="reservation"><div class="rtime">${r.time}<small>${r.minutes}분</small></div><div><p class="rname">${esc(c?.name)} <span class="status ${r.status==='COMPLETED'?'':'warn'}">${statusText[r.status]||r.status}</span></p><div class="rmeta">${esc(r.service)} · ${esc(staffLabel(r.staff))} · ${esc(r.room)}</div></div><button class="btn small" data-res-open="${r.id}">예약 상세 →</button></div>`}).join(''):'<div class="empty">등록된 예약이 없습니다.</div>'}<div style="text-align:right;margin-top:10px">${button('전체 예약 보기 →','goReservations','ghost small')}</div></section><div><section class="panel"><div class="panelhead"><h2>처리할 업무</h2><span class="sectiontag">매장 업무</span></div><div class="minirow"><div class="minidot">✧</div><div class="grow"><strong>상담 AI 검토</strong><span>${serverMode()?'상담 메모를 규칙 기반으로 정리하고 변경사항을 직접 검토하세요':'가상 상담을 분석하고 고객 정보 변경안을 승인해보세요'}</span></div><button data-act="goAI" class="btn small">시작</button></div><div class="minirow"><div class="minidot">🚗</div><div class="grow"><strong>주차 확인 ${pendingCars}건</strong><span>예약 카드에서 차량별 등록을 처리할 수 있어요</span></div><button data-act="goReservations" class="btn small">확인</button></div><div class="minirow"><div class="minidot">◷</div><div class="grow"><strong>잔여 횟수권 점검</strong><span>잔여 1회 고객 및 만료예정 고객 확인</span></div><button data-nav="memberships" class="btn small">보기</button></div></section><section class="panel"><div class="panelhead"><h2>AI 매장 인사이트</h2><span class="sectiontag">시연 카드</span></div><div class="callout">${serverMode()?'외부 검색과 AI 분석은 아직 연결되지 않았습니다. 예약·고객·수동 매출 현황은 실제 저장 데이터입니다.':'시연용 카드이며 외부 검색/AI 수치는 가상입니다.'}</div><div class="notice"><strong>예정 기능</strong><div style="margin-top:6px">재방문 지연 고객 탐색, 상담 키워드 추이, 채널별 마케팅 제안을 한 화면에서 확인합니다.</div></div></section></div></div>`}
function renderReservations(){
 const data=filteredReservations(),total=data.length,active=data.filter(r=>!['CANCELLED','NO_SHOW'].includes(r.status)).length,weekly=scheduleMode==='week';
 const desc=weekly?`${weekStart(scheduleDate)} ~ ${dateAdd(weekStart(scheduleDate),6)} · ${weekStaff}`:datePretty(scheduleDate);
 const dateBar=`<div class="schedule-toolbar"><div class="schedule-dates"><button class="btn small" data-day="-1" aria-label="이전 ${weekly?'주':'날'}">‹</button><strong>${esc(desc)}</strong><button class="btn small" data-day="1" aria-label="다음 ${weekly?'주':'날'}">›</button><input type="date" class="input schedule-date-input" id="scheduleDateInput" value="${scheduleDate}" aria-label="날짜 선택"><button class="btn small" data-act="scheduleToday">오늘</button></div><div class="schedule-controls"><div class="view-switch" role="group" aria-label="예약 표시 방식"><button class="${scheduleMode==='timetable'?'on':''}" data-schedule-view="timetable">▦ 일간 시간표</button><button class="${scheduleMode==='week'?'on':''}" data-schedule-view="week">▤ 주간 시간표</button><button class="${scheduleMode==='list'?'on':''}" data-schedule-view="list">☷ 목록</button></div>${weekly?`<label class="filter-inline">관리사<select id="scheduleWeekStaff" class="select">${STAFf.map(x=>`<option value="${esc(x)}" ${weekStaff===x?'selected':''}>${esc(staffLabel(x))}</option>`).join('')}</select></label>`:`<label class="filter-inline">관리사<select id="scheduleStaff" class="select"><option value="ALL">전체</option>${STAFf.map(x=>`<option value="${esc(x)}" ${staffFilter===x?'selected':''}>${esc(staffLabel(x))}</option>`).join('')}</select></label>`}<label class="filter-inline">상태<select id="scheduleStatus" class="select"><option value="ALL">전체</option>${Object.entries(statusText).map(([code,text])=>`<option value="${code}" ${statusFilter===code?'selected':''}>${text}</option>`).join('')}<option value="ARCHIVED" ${statusFilter==='ARCHIVED'?'selected':''}>삭제 보관함</option></select></label></div></div>`;
 const zoomBar=scheduleMode==='list'?'':`<div class="zoomline"><label for="scheduleZoom">시간표 크기</label><button class="btn small" data-zoom="down" title="더 작게">−</button><input id="scheduleZoom" type="range" min="0" max="8" step="1" value="${ZOOM_LEVELS.indexOf(scheduleZoom)}" aria-label="시간표 크기"><button class="btn small" data-zoom="up" title="더 크게">＋</button><button class="btn small" data-zoom="fit">하루 한눈에</button>${weekly?`<button class="btn small" data-week-fit>${weekFit?'주간 확대':'주간 한눈에'}</button>`:''}<span class="muted">${scheduleZoom<=.22?'초압축':scheduleZoom<=.42?'압축':scheduleZoom<=.75?'보통':'확대'} · 09:00–21:00</span></div>`;
 return header('SCHEDULE','예약 관리','시간표 드래그·길이 조절 · 상태 복구 · 삭제 보관함 · 관리사별 주간 보기',button('＋ 예약 등록','newReservation','primary'))+`<section class="panel schedule-panel">${dateBar}${zoomBar}<div class="schedule-summary"><b>${total}건</b> 조회 · 진행 중/완료 <b>${active}건</b><span>${weekly?'7일을 한 화면에서 비교 · 가로 스와이프 가능': '시간표와 목록은 같은 예약 데이터를 사용합니다.'}</span></div>${scheduleMode==='list'?renderReservationList(data):renderTimetable(data,weekly)}<div class="demo-tip">예약을 <b>누르면 상세/상태/삭제</b>, <b>끌면 시간·관리사·요일 이동</b>, 카드 하단 <b>↕ 핸들로 길이 변경</b>이 가능해요. 수정은 확인 후 적용되며 충돌 예약은 차단됩니다. 삭제는 보관함에서 복원 가능합니다.</div></section>`;
}
function renderTimetable(data,weekly){
 const lanes=weekly?Array.from({length:7},(_,i)=>({date:dateAdd(weekStart(scheduleDate),i),staff:weekStaff,label:`${dateAdd(weekStart(scheduleDate),i).slice(5)} (${weekdayShort(dateAdd(weekStart(scheduleDate),i))})`})):(staffFilter==='ALL'?STAFf:[staffFilter]).map(staff=>({date:scheduleDate,staff,label:staff}));
 const ppm=scheduleZoom,full=(SLOT_END-SLOT_START)*ppm,half=30*ppm;
 const marks=Array.from({length:13},(_,i)=>{if(scheduleZoom<=.16&&i%3!==0)return '';if(scheduleZoom<=.3&&i%2!==0)return '';const mins=SLOT_START+i*60;return `<span style="top:${i*60*ppm}px">${toHHMM(mins)}</span>`}).join('');
 const cols=weekly?(weekFit?'minmax(0,1fr)':'minmax(106px,1fr)'):'minmax(0,1fr)';
 const blocks=lane=>data.filter(r=>r.date===lane.date&&r.staff===lane.staff).map(r=>{const c=customer(r.cid),top=(asMinutes(r.time)-SLOT_START)*ppm,h=r.minutes*ppm-2;if(top<0||top>=full)return '';const compact=h<40;return `<div class="time-res ${statusKind(r.status)} ${compact?'is-compact':''} ${r.archived?'is-archived':''}" data-booking="${esc(r.id)}" style="top:${top}px;height:${Math.max(5,h)}px" title="${esc(c?.name||'고객')} ${esc(r.time)} ${esc(r.service)}" tabindex="0" role="button" aria-label="${esc(c?.name||'고객')} ${esc(r.time)} 예약 상세"><div class="booking-inner"><b>${esc(r.time)} ${esc(c?.name||'고객')}</b>${h>31?`<span>${esc(r.service)}</span>`:''}${h>69?`<small>${esc(r.room)} · ${esc(statusText[r.status])}</small>`:''}</div><span class="card-more" aria-hidden="true">⋯</span><span class="resize-grip" data-resize="${esc(r.id)}" title="끌어서 예약 시간 늘리기/줄이기">↕</span></div>`}).join('');
 const bg=`background-size:100% ${60*ppm}px`;
 return `<div class="timetable-scroll" role="region" aria-label="${weekly?'관리사별 주간':'관리사별 일간'} 예약 시간표" tabindex="0"><div class="timetable ${weekly?'weekly':''} ${weekly&&weekFit?'fit-week':''}" style="grid-template-columns:54px repeat(${lanes.length},${cols});min-width:${weekly?(weekFit?'0':'975px'):'0'}"><div class="lane-head time-title">시간</div>${lanes.map(l=>`<div class="lane-head">${weekly&&weekFit?`<span class="week-mini"><b>${l.date.slice(-2)}</b><small>${weekdayShort(l.date)}</small></span>`:esc(staffLabel(l.label))}</div>`).join('')}<div class="schedule-times" style="height:${full}px;${bg}">${marks}</div>${lanes.map(l=>{const cells=Array.from({length:24},(_,i)=>{const m=SLOT_START+i*30;return `<button class="slot" style="top:${i*half}px;height:${half}px" data-new-at="${toHHMM(m)}" data-new-staff="${esc(l.staff)}" data-new-date="${l.date}" title="새 예약 ${toHHMM(m)}"></button>`}).join('');return `<div class="schedule-lane" data-lane-date="${l.date}" data-lane-staff="${esc(l.staff)}" style="height:${full}px;${bg}">${cells}${blocks(l)}</div>`}).join('')}</div></div>`;
}
function renderReservationList(data){
 if(!data.length)return `<div class="empty">해당 조건에 예약이 없습니다.<p>${button('예약 등록','newReservation','primary small')}</p></div>`;
 const rows=data.map(r=>{const c=customer(r.cid);return `<tr><td><b>${esc(r.date.slice(5))} ${esc(r.time)}</b><br><span class="muted">${r.minutes}분</span></td><td><button class="btn ghost small" data-customer="${r.cid}">${esc(c?.name)} →</button></td><td>${esc(r.service)}</td><td>${esc(r.staff)}<br><span class="muted">${esc(r.room)}</span></td><td><span class="status ${statusKind(r.status)}">${r.archived?'보관됨':statusText[r.status]||r.status}</span></td><td>${c?.vehicle?(r.parking?'<span class="status is-done">완료</span>':'<span class="status">미처리</span>'):'<span class="muted">해당 없음</span>'}</td><td><button class="btn small" data-res-open="${r.id}">상세·편집</button></td></tr>`}).join('');
 const cards=data.map(r=>{const c=customer(r.cid);return `<article class="reservation-list-card"><div class="list-card-head"><strong>${esc(r.date.slice(5))} ${esc(r.time)} <span class="muted">· ${r.minutes}분</span></strong><span class="status ${statusKind(r.status)}">${r.archived?'보관됨':statusText[r.status]||r.status}</span></div><h3>${esc(c?.name||'고객')} <small>${esc(r.service)}</small></h3><div class="rmeta">${esc(staffLabel(r.staff))} · ${esc(r.room)} · 주차 ${c?.vehicle?(r.parking?'완료':'미처리'):'해당 없음'}</div><div class="list-actions"><button class="btn small" data-customer="${r.cid}">고객카드</button><button class="btn small primary" data-res-open="${r.id}">상세·편집</button></div></article>`}).join('');
 return `<div class="schedule-table"><table class="table"><thead><tr><th>예약일시</th><th>고객</th><th>프로그램</th><th>담당/공간</th><th>상태</th><th>주차</th><th>업무</th></tr></thead><tbody>${rows}</tbody></table></div><div class="schedule-mobile-list">${cards}</div>`;
}
function renderCustomers(){const c=customer(selectedCustomer)||state.customers[0];if(!c)return header('CUSTOMER 360','고객 관리','고객을 등록하면 이곳에서 통합 관리할 수 있습니다.',button('＋ 고객 등록','newCustomer','primary'));
 const tabs=[['overview','한눈에'],['consult','상담'],['treatment','관리이력'],['photo','사진'],['membership','회원권·결제'],['message','메시지'],['vehicle','차량·주차'],['activity','변경·활동']];
 const reservations=state.reservations.filter(r=>r.cid===c.id && r.date>=TODAY()&&!['CANCELLED','NO_SHOW','COMPLETED'].includes(r.status)).sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time));
 const pending=state.followups.filter(f=>f.cid===c.id && f.status==='OPEN');
 const consultations=state.consultations.filter(x=>x.cid===c.id);
 return header('CUSTOMER 360','고객 관리','고객의 현재 상태, 방문 흐름, AI 상담 기록을 통합 조회',button('＋ 고객 등록','newCustomer','primary'))+`<div class="c360-shell ${customerMobileDetail?'is-detail':''}"><aside class="panel c360-list"><div class="panelhead"><h2>고객 목록</h2><span class="sectiontag">${state.customers.length}명</span></div><input class="input" id="customerSearch" placeholder="이름 / 전화 / 고민 검색" autocomplete="off"><div class="c360-filter">${serverMode()?'서버에 저장된 고객 · 고객을 선택하세요':'가상 고객 데이터 · 고객을 선택하세요'}</div><div id="customerRows">${renderCustomerList('')}</div></aside><section class="panel c360-main"><button class="btn small c360-mobile-back" data-customer-back>← 고객 목록</button><div class="c360-hero"><div class="c360-inline" style="gap:13px"><div class="circle" style="width:53px;height:53px;font-size:19px">${esc(c.name[0])}</div><div><div class="c360-tags">${c.tags.map(t=>`<span class="c360-tag">${esc(t)}</span>`).join('')}<span class="c360-tag">고객 ${esc(c.id)}</span></div><h2 class="c360-name">${esc(c.name)}</h2><div class="c360-head-meta">${esc(c.phone)} · 최초 방문 ${esc(c.joined)}</div></div></div><div class="c360-actions">${button('＋ 예약','rebookCustomer','small')}${button('✧ 상담 시작','goCustomerAI','primary small')}</div></div><div class="c360-metrics"><div class="c360-metric"><small>다음 예약</small><b>${reservations.length?esc(reservations[0].date.slice(5)+' '+reservations[0].time):'미등록'}</b></div><div class="c360-metric"><small>회원권 잔여</small><b>${c.membership?Math.max(0,c.membership.total-c.membership.used)+'회':'없음'}</b></div><div class="c360-metric"><small>후속 업무</small><b>${pending.length}건</b></div></div><div class="custtabs">${tabs.map(t=>`<button class="ctab ${customerTab===t[0]?'selected':''}" data-custtab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="customerContent">${renderCustomerTab(c)}</div></section></div>`;
}
function renderCustomerList(query){const term=query.toLowerCase();return state.customers.filter(c=>(c.name+' '+c.phone+' '+c.concerns.join(' ')).toLowerCase().includes(term)).map(c=>`<button class="customeritem ${selectedCustomer===c.id?'selected':''}" data-customer="${esc(c.id)}"><div class="circle">${esc(c.name[0])}</div><div class="grow"><b>${esc(c.name)}</b><small>${esc(c.concerns.join(', ')||'피부상태 미확인')} · ${c.membership?'회원권 '+(c.membership.total-c.membership.used)+'회':'일반 고객'}</small></div><span class="muted">›</span></button>`).join('')||'<div class="empty">고객 검색 결과가 없습니다.</div>'}
function renderCustomerTab(c){
 const consultations=state.consultations.filter(x=>x.cid===c.id).slice().sort((a,b)=>b.date.localeCompare(a.date));
 const pending=state.followups.filter(f=>f.cid===c.id && f.status==='OPEN');
 const appts=state.reservations.filter(r=>r.cid===c.id&&!['CANCELLED','NO_SHOW'].includes(r.status)).slice().sort((a,b)=>(b.date+' '+b.time).localeCompare(a.date+' '+a.time));
 const events=[...c.events.map(x=>({date:x.date,label:x.label,note:x.evidence||'',kind:'승인'})), ...c.history.map(x=>({date:x.date,label:x.label,note:x.note||'',kind:'관리'})), ...consultations.map(x=>({date:x.date,label:'상담일지 · '+(x.status==='APPROVED'?'확정':'임시저장'),note:x.note,kind:'상담'}))].sort((a,b)=>b.date.localeCompare(a.date));
 const skin=`<div class="c360-box"><h3 class="c360-subtitle">현재 피부 프로필 <span class="status">직원 확인 기준</span></h3><div class="c360-fact"><label>피부 유형</label><strong>${esc(c.type)}</strong></div><div class="c360-fact"><label>관리 강도 선호</label><strong>${esc(c.pressure)}</strong></div><div class="c360-fact"><label>고민</label><div class="chips" style="justify-content:end;margin:0">${(c.concerns.length?c.concerns:['미등록']).map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</div></div><div class="c360-fact"><label>주의사항</label><div class="chips" style="justify-content:end;margin:0">${(c.precautions.length?c.precautions:['기록 없음']).map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</div></div>${c.precautions.length?'<div class="c360-alert">⚠ 관리 전 주의사항을 반드시 확인하세요. AI 추출사항은 직원 승인 후에만 고객 정보에 반영됩니다.</div>':''}</div>`;
 const timeline=(items,empty='기록 없음')=>items.length?items.map(x=>`<div class="c360-event"><time>${esc(x.date)}</time><div><b>${esc(x.label)}</b><p>${esc(x.note)}</p>${x.kind?`<span class="status">${esc(x.kind)}</span>`:''}</div></div>`).join(''):`<div class="empty">${empty}</div>`;
 switch(customerTab){
 case 'overview':return `<div class="c360-overview"><div class="c360-stack">${skin}<div class="c360-box"><h3 class="c360-subtitle">최근 상담 <button class="btn small" data-custtab="consult">모두 보기 →</button></h3>${consultations.length?`<div class="c360-muted">${esc(consultations[0].date)} · ${consultations[0].status==='APPROVED'?'확정':'임시저장'} ${consultations[0].source==='SAMPLE'?'· 가상 예시':''}</div><p class="c360-note">${esc(consultations[0].note)}</p>`:'<div class="empty">아직 상담일지가 없습니다.</div>'}</div><div class="c360-box"><h3 class="c360-subtitle">최근 변경/방문</h3>${timeline(events.slice(0,4))}</div></div><div class="c360-stack"><div class="c360-box"><h3 class="c360-subtitle">다음 예약 <button class="btn small" data-act="rebookCustomer">＋ 예약</button></h3>${appts.filter(x=>x.date>=TODAY()&&!['COMPLETED'].includes(x.status)).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,1).map(r=>`<div><b>${esc(r.date)} ${esc(r.time)}</b><p class="subtle">${esc(r.service)} · ${esc(staffLabel(r.staff))}</p><button class="btn small" data-res-open="${esc(r.id)}">예약 상세 →</button></div>`).join('')||'<div class="empty">예정된 예약이 없습니다.</div>'}</div><div class="c360-box"><h3 class="c360-subtitle">회원권 현황</h3>${c.membership?`<b>${esc(c.membership.name)}</b><div class="progress"><div class="bar" style="width:${Math.min(100,100*c.membership.used/c.membership.total)}%"></div></div><p class="subtle">${c.membership.used}/${c.membership.total}회 사용 · 잔여 <b>${c.membership.total-c.membership.used}회</b></p><p class="c360-muted">만료: ${esc(c.membership.expire)}</p>`:'<div class="empty">회원권 없음</div>'}</div><div class="c360-box"><h3 class="c360-subtitle">후속 업무</h3>${pending.length?pending.map(f=>`<div class="c360-fact"><div><b>${esc(f.title)}</b><div class="c360-muted">진행 대기</div></div><button class="btn small" data-complete-followup="${esc(f.id)}">완료 처리</button></div>`).join(''):'<p class="c360-muted">처리 대기 중인 업무가 없습니다.</p>'}</div><div class="c360-box"><h3 class="c360-subtitle">주차·차량</h3><div class="c360-fact"><label>차량번호</label><strong>${esc(c.vehicle||'등록 안 됨')}</strong></div><p class="c360-muted">주차 등록은 예약 건별로 따로 관리합니다.</p></div></div></div>`;
 case 'consult':return `<div class="c360-subtitle">상담일지 <div>${button('＋ 새 상담','goCustomerAI','primary small')}</div></div><div class="callout">상담 원문과 직원 승인 내역을 분리해 저장합니다. ${serverMode()?'현재 AI 모델은 미연결이며 상담분석은 규칙 기반 참고안입니다.':'예시 기록은 가상 데이터입니다.'}</div>${consultations.length?consultations.map(x=>`<article class="c360-box" style="margin-top:12px"><div class="c360-inline" style="justify-content:space-between"><b>${esc(x.date)} 상담</b><span class="status ${x.status==='APPROVED'?'':'warn'}">${x.status==='APPROVED'?'확정':'임시저장'}</span></div><p class="c360-note">${esc(x.note)}</p><div class="c360-muted">${x.source==='SAMPLE'?'가상 과거 상담 예시 · ':''}변경 반영 ${Number(x.appliedChanges)||0}건</div><details style="margin-top:11px"><summary style="cursor:pointer;font-size:12px;color:var(--green)">상담 원문 보기</summary><p class="ai-readonly">${esc(x.transcript||'원문 없음')}</p></details></article>`).join(''):'<div class="empty">상담일지가 아직 없습니다.<br>새 상담을 입력하고 시뮬레이션을 실행해보세요.</div>'}<div class="c360-box" style="margin-top:14px"><h3 class="c360-subtitle">승인된 고객정보 변경 내역</h3>${timeline(c.events.slice().reverse().map(e=>({date:e.date,label:e.label,note:e.evidence,kind:'승인'})),'프로필 변경 승인 내역이 없습니다.')}</div>`;
  case 'treatment':{const txs=state.treatments.filter(x=>x.cid===c.id&&!x.voided).slice().reverse();return `<div class="c360-subtitle">관리이력 <span class="c360-muted">관리기록 / 제품 / 강도 / 결과</span></div>${txs.map(x=>`<div class="c360-box" style="margin-bottom:13px"><div class="c360-inline" style="justify-content:space-between"><b>${esc(x.date)} · ${esc(x.service)}</b><button class="btn small" data-res-open="${esc(x.reservationId)}">예약 보기</button></div><div class="c360-fact"><label>관리사</label><strong>${esc(x.staff)}</strong></div><div class="c360-fact"><label>관리 전</label><strong>${esc(x.before||'기록 없음')}</strong></div><div class="c360-fact"><label>관리 후</label><strong>${esc(x.after||'기록 없음')}</strong></div><div class="c360-fact"><label>제품 / 기기</label><strong>${esc([x.products,x.device].filter(Boolean).join(' / ')||'미입력')}</strong></div><div class="c360-fact"><label>압/강도</label><strong>${esc(x.pressure)}</strong></div><p class="c360-note">${esc(x.note||'메모 없음')}</p></div>`).join('')}${c.history.filter(h=>!h.reservationId||!txs.some(x=>x.reservationId===h.reservationId)).slice().reverse().map(h=>`<div class="c360-box" style="margin-bottom:11px"><b>${esc(h.date)} · ${esc(h.label)}</b><p class="subtle">${esc(h.note)}</p></div>`).join('')}${!txs.length&&!c.history.length?'<div class="empty">등록된 관리기록이 없습니다.</div>':''}<div class="fake">사진은 별도 탭에서 관리합니다. 제품 재고의 관리완료 자동 차감은 추후 검증 항목입니다.</div>`;}
 case 'photo':{const pics=(state.photos||[]).filter(p=>p.cid===c.id);return `<div class="c360-subtitle">피부관리 전후 사진 <span class="c360-muted">사진 동의 · 날짜별 비교</span></div><div class="c360-box"><div class="c360-inline" style="justify-content:space-between"><b>등록된 사진 ${pics.length}장</b>${xbutton('＋ 사진 등록','photoNew',c.id,'small primary')}</div>${pics.length?`<div class="photogrid">${pics.map(p=>`<button class="photo-tile" data-extra="photoPreview" data-id="${p.id}"><img src="${esc(p.dataUrl)}" alt="${esc(p.kind)} ${esc(p.date)}"><small>${esc(p.kind)} · ${p.date}</small></button>`).join('')}</div>`:'<div class="empty">사진이 없습니다. 동의 확인 후 샘플 이미지를 등록해 비교해보세요.</div>'}</div><div class="c360-box" style="margin-top:13px"><h3>BEFORE / AFTER 비교</h3>${pics.length>=2?`<div class="photo-compare"><select id="photoBefore" class="select">${pics.map(p=>`<option value="${p.id}" ${p.kind==='BEFORE'?'selected':''}>${p.date} ${p.kind}</option>`).join('')}</select><select id="photoAfter" class="select">${pics.map(p=>`<option value="${p.id}" ${p.kind==='AFTER'?'selected':''}>${p.date} ${p.kind}</option>`).join('')}</select>${xbutton('비교 열기','photoCompare',c.id,'small')}</div>`:'<p class="fineprint">서로 다른 두 사진을 등록하면 비교할 수 있습니다.</p>'}</div><p class="fineprint">${serverMode()?'사진은 비공개 저장소에 보관하며, 로그인한 매장 계정만 임시 링크를 발급받습니다. 개인정보 보관·삭제 정책을 확인하세요.':'사진은 데모용 브라우저 저장 상태입니다. 실고객 사진을 넣지 마세요.'}</p>`;}
  case 'membership':{const usage=state.membershipUsages.filter(x=>x.cid===c.id).slice().reverse(),payments=state.payments.filter(x=>x.cid===c.id).slice().reverse();return `<h3 class="c360-subtitle">회원권 및 결제</h3>${c.membership?`<div class="c360-box"><b>${esc(c.membership.name)}</b><div class="progress"><div class="bar" style="width:${Math.min(100,100*c.membership.used/c.membership.total)}%"></div></div><div class="c360-fact"><label>사용</label><strong>${c.membership.used}회 / ${c.membership.total}회</strong></div><div class="c360-fact"><label>잔여</label><strong>${c.membership.total-c.membership.used}회</strong></div><div class="c360-fact"><label>만료일</label><strong>${esc(c.membership.expire)}</strong></div></div>`:'<div class="empty">회원권 없음</div>'}<div class="c360-box" style="margin-top:13px"><h3 class="c360-subtitle">횟수권 사용·취소 원장</h3>${usage.length?usage.map(u=>`<div class="c360-fact"><label>${esc(u.date)} · ${esc(u.type==='CONSUME'?'사용':'사용취소')}</label><strong>${u.delta>0?'+':''}${u.delta}회 ${u.reversedAt?'· 취소됨':''}</strong></div>`).join(''):'<p class="c360-muted">이번 시연에서 발생한 차감이 없습니다.</p>'}</div><div class="c360-box" style="margin-top:13px"><h3 class="c360-subtitle">결제 기록 (시연)</h3>${payments.length?payments.map(x=>`<div class="c360-fact"><label>${esc(x.date)} · ${esc(x.type)}</label><strong>${x.amount.toLocaleString('ko-KR')}원 ${x.voided?'· 취소':''}</strong></div>`).join(''):'<p class="c360-muted">등록된 결제 기록이 없습니다.</p>'}</div><div class="fake">매출은 결제 발생 시점 기준입니다. 회원권 사용을 신규 매출로 중복 집계하지 않으며, 정식 PG 결제·환불은 추후 연동합니다.</div>`;}
  case 'message':{const drafts=state.messageDrafts.filter(x=>x.cid===c.id).slice().reverse();return `<div class="c360-subtitle">예약톡 · 방문 후 메시지 <span class="c360-muted">초안/발송 상태</span></div><div class="callout">예약 확정·D-1 리마인드·방문 후 감사·재방문 권유 템플릿을 구성합니다. 데모에서는 메시지를 실제 전송하지 않습니다.</div>${drafts.length?drafts.map(x=>`<div class="c360-box" style="margin-top:12px"><div class="c360-inline" style="justify-content:space-between"><b>${esc(x.category)}</b><span class="status">${x.status==='DRAFT'?'초안 저장':'처리됨'}</span></div><p class="c360-note">${esc(x.content)}</p></div>`).join(''):'<div class="empty">저장된 메시지 초안이 없습니다.<br>관리 완료 후 메시지 초안을 저장하면 여기에서 볼 수 있어요.</div>'}`;}
 case 'vehicle':return `<div class="c360-cards2"><div class="c360-box"><h3 class="c360-subtitle">고객 차량</h3><div class="c360-fact"><label>차량번호</label><strong>${esc(c.vehicle||'미등록')}</strong></div></div><div class="c360-box"><h3 class="c360-subtitle">매장 주차정책</h3><div class="c360-fact"><label>무료 시간</label><strong>2시간 (가상 정책)</strong></div><div class="c360-fact"><label>처리 방식</label><strong>직원 수동처리</strong></div></div></div><div class="c360-box" style="margin-top:13px"><h3 class="c360-subtitle">고객의 예약별 주차 처리</h3>${appts.length?appts.slice(0,5).map(r=>`<div class="c360-fact"><label>${esc(r.date+' '+r.time)}</label><div class="c360-inline"><span>${r.parking?'처리 완료':'미처리'}</span><button class="btn small" data-res-open="${esc(r.id)}">예약 보기</button></div></div>`).join(''):'<p class="c360-muted">예약 없음</p>'}</div>`;
 case 'activity':return `<h3 class="c360-subtitle">전체 활동·변경 이력</h3>${timeline(events,'아직 이력이 없습니다.')}<div class="fake">정식 운영에서는 누가 언제 어떤 데이터를 수정했는지 원본/변경 전후값 및 승인 근거를 서버 감사로그에 남깁니다.</div>`;
 default:return '';
 }
}
function renderAI(){if(!state.customers.length)return header('AI CONSULTATION','상담 AI','고객을 먼저 등록해 주세요.',button('고객 등록','newCustomer','primary'));const c=customer(activeConsultCid)||state.customers[0];const hasAnalysis=!!analysisResult&&analysisResult.cid===c.id;
 const records=state.consultations.filter(x=>x.cid===c.id).length;
 return header('AI CONSULTATION','상담 AI','상담일지 초안과 고객정보 변경 제안을 분리 검토하는 직원 승인형 워크플로')+`<div class="ai-context"><div class="circle">${esc(c.name[0])}</div><div><b>${esc(c.name)} 고객 상담</b><div class="c360-muted">저장된 상담일지 ${records}건 · 현재 고민 ${esc(c.concerns.join(', ')||'기록 없음')}</div></div><select class="select" id="consultCustomer" aria-label="고객 선택">${state.customers.map(x=>`<option value="${x.id}" ${x.id===c.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><button class="btn small" data-ai-open-customer="${esc(c.id)}">고객카드 →</button></div><div class="ai-flow"><div class="ai-step is-active"><span class="ai-step-number">1</span>상담 입력</div><span class="ai-step-arrow">›</span><div class="ai-step ${hasAnalysis?'is-active':''}"><span class="ai-step-number">2</span>초안·변경안 검토</div><span class="ai-step-arrow">›</span><div class="ai-step"><span class="ai-step-number">3</span>직원 확정 및 반영</div></div><div class="ai-layout"><section class="panel"><div class="panelhead"><h2>01 · 상담 준비</h2><span class="sectiontag">텍스트 기반 데모</span></div><div class="field"><label>입력 경로</label><div class="c360-inline"><span class="status">✓ 상담 텍스트 입력</span>${xbutton('● 녹음 시작','recordStart','','small')}${xbutton('■ 녹음 종료·전사','recordStop','','small')}${xbutton('↑ 녹음 업로드·전사','audioUpload','','small')}<input type="file" accept="audio/*" id="audioFile" style="display:none"></div></div><div class="field"><label for="sampleCase">샘플 상담 선택</label><select class="select" id="sampleCase"><option value="visit" ${aiCase==='visit'?'selected':''}>최근 건조감 · 관리압 · 재방문</option><option value="interest" ${aiCase==='interest'?'selected':''}>프로그램 관심 · 주차 문의</option><option value="none" ${aiCase==='none'?'selected':''}>변경 제안 없는 일반 상담</option></select></div><div class="field"><label for="transcript">상담 전문 · 확인 및 수정 가능</label><textarea id="transcript" class="textarea" rows="8" placeholder="가상 상담 내용을 입력하고 분석해보세요">${esc(hasAnalysis?analysisResult.transcript:sampleTranscript(aiCase))}</textarea></div><div class="c360-box" style="background:#f8fbf8"><h3 class="c360-subtitle">기존 고객 프로필</h3><div class="c360-fact"><label>피부유형</label><strong>${esc(c.type)}</strong></div><div class="c360-fact"><label>고민</label><strong>${esc(c.concerns.join(', ')||'미등록')}</strong></div><div class="c360-fact"><label>관리압</label><strong>${esc(c.pressure)}</strong></div><div class="c360-fact"><label>주의사항</label><strong>${esc(c.precautions.join(', ')||'없음')}</strong></div></div><div class="fake">로컬에서는 규칙 기반 데모입니다. 서버 모드에서 STT/LLM Provider를 연결하면 API 전사가 가능합니다. 동의 없는 녹음·전사는 금지되며, 실제 데이터는 안전 검증 후 사용하세요.</div><button class="btn primary" data-act="analyze">✧ 상담 분석 시뮬레이션</button></section><section class="panel"><div class="panelhead"><h2>02 · 상담일지와 변경 검토</h2><span class="sectiontag">직원 최종 승인</span></div>${hasAnalysis?renderProposals(c):`<div class="empty"><div style="font-size:27px;margin-bottom:10px">✧</div>상담 텍스트를 입력한 뒤<br>분석 시뮬레이션을 실행하세요.<p class="c360-muted">상담일지 저장과 고객정보 반영은 별도 액션입니다.</p></div>`}</section></div>`;
}
function renderProposals(c){const p=analysisResult;return `<div class="field"><label for="consultNote">상담일지 · 직원 수정 가능</label><textarea id="consultNote" class="textarea ai-note-editor" rows="5">${esc(p.note)}</textarea></div><div class="ai-subnote">상담일지는 변경안을 승인하지 않아도 따로 저장할 수 있습니다.</div><div class="ai-sectiontitle">상담에서 추출한 신호</div><div class="chips">${p.signals.map(s=>`<span class="chip">${esc(s)}</span>`).join('')||'<span class="chip">추가 추출 항목 없음</span>'}</div><div class="ai-sectiontitle">고객카드 변경 제안 <span class="status">${p.updates.length}건</span></div>${p.updates.length?`<div class="c360-inline"><button class="btn small" data-ai-select="all">모두 선택</button><button class="btn small" data-ai-select="none">모두 해제</button><span class="c360-muted">확인한 항목만 반영</span></div>${p.updates.map((u,i)=>`<div class="ai-proposal"><input type="checkbox" aria-label="${esc(u.title)} 승인 선택" data-proposal="${i}" ${u.selected?'checked':''}/><div><div class="c360-inline" style="justify-content:space-between"><strong>${esc(u.title)}</strong><span class="rule-tag">규칙 매칭 데모</span></div><div class="c360-muted" style="margin-top:6px">현재: ${esc(u.old)}</div><label for="proposalValue${i}">적용 제안값 (수정 가능)</label><input id="proposalValue${i}" class="input" data-proposal-value="${i}" value="${esc(u.value)}" /><div class="evidence">근거: “${esc(u.evidence)}”</div></div></div>`).join('')}`:`<div class="callout">고객 프로필을 바꿀 항목은 없습니다. 상담일지만 저장할 수 있습니다.</div>`}<div class="field" style="margin-top:16px"><label for="approvalMemo">검토 메모 (선택)</label><input class="input" id="approvalMemo" placeholder="예: 고객이 직접 언급한 사항 확인" value="${esc(p.reviewMemo||'')}"></div><div class="ai-pane-footer"><button class="btn" data-act="saveConsultDraft">일지만 임시저장</button><button class="btn primary" data-act="applyProposals">선택한 ${p.updates.filter(x=>x.selected).length}건 승인·확정</button></div><p class="footnote">확정 시 상담일지는 보존되고, 체크한 고객 프로필 변경만 반영됩니다. 원문·근거·승인 이벤트는 기록됩니다. 데모에서는 브라우저에만 저장됩니다.</p>`;
}
function renderMemberships(){const holders=state.customers.filter(c=>c.membership);return header('MEMBERSHIP','회원권·결제','잔여 횟수권 및 만료 예정 고객을 한눈에')+`<div class="panel"><div class="panelhead"><h2>회원권 현황</h2><span class="sectiontag">관리 완료 시 횟수 차감</span></div><div style="overflow-x:auto"><table class="table"><thead><tr><th>고객</th><th>회원권 상품</th><th>사용 / 전체</th><th>잔여</th><th>만료일</th></tr></thead><tbody>${holders.map(c=>`<tr><td><button class="btn ghost small" data-customer="${c.id}">${esc(c.name)} →</button></td><td>${esc(c.membership.name)}</td><td>${c.membership.used} / ${c.membership.total}</td><td><b>${c.membership.total-c.membership.used}회</b></td><td>${c.membership.expire}</td></tr>`).join('')}</tbody></table></div><div style="margin-top:16px">${xbutton('＋ 회원권 발행/판매','membershipNew','', 'primary')}</div><div class="fineprint">증정·사용횟수 조정은 기록으로 남깁니다. PG 자동결제와 환불 정책은 연동 전 단계입니다.</div></div>`}
function legacyRenderMarketing(){return header('GROWTH STUDIO','마케팅 코파일럿','내부 고객 신호 + 외부 검색 노출 + 캠페인 실행을 통합하는 예정 화면')+`<div class="callout" style="margin-bottom:20px"><b>미연결 미리보기</b> — 외부 검색 순위, 조회수, 리뷰, 매출 효과는 실제 데이터를 수집하지 않았습니다. 표시된 내용은 설계 예시이며 성과를 주장하지 않습니다.</div><div class="cards3"><div class="module"><strong>01 · 내부 인사이트</strong><p>상담 키워드 변화, 신규 고객 비중, 재방문 지연, 관심→예약 전환, 회원권 만료 분석</p></div><div class="module"><strong>02 · 외부 노출</strong><p>네이버 / 카카오 / Google / 블로그 / 리뷰의 공식 연동 가능 범위에서 발견 여부·언급·트렌드 분석</p></div><div class="module"><strong>03 · 캠페인</strong><p>대상 고객 추출 → AI 문구 초안 → 승인 → 카카오/문자 발송 → 예약·방문·매출 연결</p></div></div><div class="panel" style="margin-top:17px"><div class="panelhead"><h2>외부 채널 연결 상태</h2><span class="sectiontag">설계상 Provider Adapter</span></div><div class="twocol">${['네이버 검색/블로그','카카오 장소/메시지','Google Business Profile','리뷰·경쟁 키워드'].map(x=>`<div class="info"><label>${x}</label><strong>연동 전</strong></div>`).join('')}</div></div><div class="panel" style="margin-top:17px"><h2>예정: AI 마케팅 매니저</h2><div class="msgbox">추천마다 기간·지표·출처를 첨부하고, 광고성 메시지는 마케팅 동의한 고객에게만 발송합니다.\n\n예: '잔여 횟수권 1~2회이면서 다음 예약이 없는 고객' 세그먼트 생성 → 대상수 확인 → 메시지 초안 검토.</div></div>`}
function legacyRenderAnalytics(){const completed=state.reservations.filter(x=>x.status==='COMPLETED').length;return header('ANALYTICS','매출·분석','실제 결제기록 연결 전에는 수치를 만들지 않습니다')+`<div class="grid4">${stat('관리 완료',completed+'건','현재 샘플 예약 내역')}${stat('회원권 보유',state.customers.filter(c=>c.membership).length+'명','현재 샘플 고객')}${stat('등록 고객',state.customers.length+'명','현재 샘플 고객')}${stat('결제·매출','미연결','결제 모듈 구현 예정')}</div><div class="placeholder">결제/취소/환불을 정확히 반영한 실매출과 방문주기·객단가 분석을 다음 단계에서 연결합니다.</div>`}
function legacyRenderSettings(){return header('SETTINGS','매장·시스템 설정','권한, 매장 정책, 메시지 및 AI 제공자 설정')+`<div class="cards3"><div class="module"><strong>매장 및 직원</strong><p>매장별 shop_id, OWNER / MANAGER / THERAPIST 권한, 담당 관리실 관리</p></div><div class="module"><strong>서비스·주차 정책</strong><p>관리 프로그램/시간/가격, 주차 지원 시간, 관리실·베드 배치</p></div><div class="module"><strong>AI 및 외부 연동</strong><p>API Key는 서버 환경변수에만 보관. STT·LLM·Messaging·Search Provider를 교체 가능한 구조로 설계</p></div></div><div class="panel" style="margin-top:17px"><h2>데모 상태</h2><p class="subtle">현재 브라우저 내 로컬 저장소에 가상의 고객/예약 변경내용을 저장합니다.</p><div style="margin-top:14px">${button('데모 초기화','resetDemo','small')}</div></div>`}
function openModal(content){$('#modalRoot').innerHTML=`<div class="modalback" id="modalback"><div class="modal" role="dialog" aria-modal="true"><button type="button" class="modal-x" data-act="closeModal" aria-label="닫기">×</button>${content}</div></div>`}
function closeModal(){$('#modalRoot').innerHTML='';if(window._waitAssignId){const w=state.waitlist?.find(x=>x.id===window._waitAssignId);if(w&&w.status==='PENDING'){w.status='WAITING';save()}window._waitAssignId=null;}}
function newCustomer(){openModal(`<h2>새 고객 등록</h2><div class="field"><label>고객 이름</label><input class="input" id="newName" maxlength="20" placeholder="예: 홍길동"></div><div class="field"><label>연락처</label><input class="input" id="newPhone" maxlength="30" placeholder="010-****-0000"></div><div class="field"><label>피부 고민</label><input class="input" id="newConcern" maxlength="60" placeholder="예: 건조함"></div><div class="actions"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="saveCustomer">등록</button></div>`)}
function saveCustomer(){
 const name=($('#newName')?.value||'').trim(),phone=($('#newPhone')?.value||'').trim(),concern=($('#newConcern')?.value||'').trim();
 if(!name)return toast('고객 이름을 입력하세요.');
 const id='C'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
 state.customers.push({id,name,phone,joined:TODAY(),last:'',type:'미확인',concerns:concern?[concern]:[],pressure:'미확인',precautions:[],allergies:[],vehicle:'',tags:[],membership:null,events:[],notes:'',history:[],intake:'',recordingConsent:false,photoConsent:false,marketingConsent:false});
 state.audits.push({action:'CUSTOMER_CREATE',cid:id,date:TODAY()});selectedCustomer=id;activeConsultCid=id;customerMobileDetail=true;
 save();closeModal();setView('customers');toast('고객을 등록했습니다.');
}
function reservationForm(r=null,preset={}){
 const cid=r?.cid||preset.cid||selectedCustomer||state.customers[0]?.id,date=r?.date||preset.date||scheduleDate,time=r?.time||preset.time||'15:00',staff=r?.staff||preset.staff||STAFf[0],room=r?.room||preset.room||state.rooms[0],service=r?.service||state.services[0]?.name||'',minutes=r?.minutes||state.services[0]?.minutes||90;
 return `<h2>${r?'예약 편집':'예약 등록'}</h2>${r?`<p class="subtle">현재 상태: <b>${statusText[r.status]}</b> · 노쇼/취소도 시간과 프로그램을 수정할 수 있습니다. 다시 확정하려면 상태 변경을 이용하세요.</p>`:''}<div class="twocol"><div class="field"><label>고객</label><select class="select" id="resCustomer">${state.customers.map(c=>`<option value="${c.id}" ${c.id===cid?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>예약일</label><input type="date" class="input" id="resDate" value="${date}"></div><div class="field"><label>시작 시각</label><input type="time" class="input" id="resTime" step="900" value="${time}"></div><div class="field"><label>프로그램</label><select class="select" id="resService">${[...new Set([service,...state.services.map(x=>x.name)])].map(x=>`<option ${x===service?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div class="field"><label>소요 시간</label><select class="select" id="resMinutes">${[30,45,60,75,90,105,120,150,180].map(n=>`<option value="${n}" ${n===minutes?'selected':''}>${n}분</option>`).join('')}</select></div><div class="field"><label>담당 관리사</label><select class="select" id="resStaff">${STAFf.map(x=>`<option ${x===staff?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>관리실</label><select class="select" id="resRoom">${state.rooms.map(x=>`<option ${x===room?'selected':''}>${esc(x)}</option>`).join('')}</select></div></div><div class="fake">영업시간 09:00~21:00 / 15분 단위 · 같은 관리사 또는 관리실의 예약 충돌을 차단합니다.</div><div class="actions"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="saveReservation">${r?'변경 저장':'예약 확정'}</button></div>`;
}
function newReservation(preset={}){if(!state.customers.length){toast('예약 전에 고객을 먼저 등록하세요.');return}if(serverMode()&&!state.services.length){toast('설정에서 관리 프로그램을 먼저 등록하세요.');setView('settings');return}editingReservationId=null;openModal(reservationForm(null,preset))}
function editReservation(id){const r=state.reservations.find(x=>x.id===id);if(!r)return;editingReservationId=id;openModal(reservationForm(r));}
function conflictFor(proposed,id){return bookingConflict(state.reservations,proposed,id)}
function changeStatus(id,status){const r=state.reservations.find(x=>x.id===id);if(!r||r.archived)return;
 if(status===r.status){toast('이미 선택한 상태입니다.');return}
 if(status==='COMPLETED'){openTreatmentForm(id);return}
 if(!['CANCELLED','NO_SHOW'].includes(status)){const conflict=conflictFor({...r,status},r.id);if(conflict){toast(`${conflict.time} ${conflict.staff} 예약과 겹쳐 상태를 복구할 수 없습니다.`);return}}
 if(r.status==='COMPLETED'){if(!confirm('관리 완료를 취소하면 이번 관리의 회원권 사용·결제 기록에 취소 표시가 남습니다. 진행할까요?'))return;undoCompletion(r)}
 const prev=r.status;r.status=status;state.audits.push({action:'STATUS_CHANGE',reservation:id,from:prev,to:status,date:TODAY()});save();closeModal();render();toast(`${statusText[status]} 상태로 변경했습니다.`);
}
function openReservationDetail(id){const r=state.reservations.find(x=>x.id===id);if(!r)return;const c=customer(r.cid);
 const treatment=state.treatments.find(x=>x.reservationId===id&&!x.voided);
 const actionRow=r.archived?`<button class="btn primary" data-res-action="restore" data-res-id="${id}">보관함에서 복원</button>`:`<button class="btn" data-res-action="edit" data-res-id="${id}">✎ 예약 편집</button>${r.status!=='COMPLETED'?`<button class="btn primary" data-res-action="complete" data-res-id="${id}">관리 완료 입력</button>`:`<button class="btn" data-res-action="rebook" data-res-id="${id}">＋ 다음 예약</button>`}<button class="btn" data-res-action="parking" data-res-id="${id}">주차 ${r.parking?'완료':'처리'}</button><button class="btn danger" data-res-action="archive" data-res-id="${id}">삭제·보관</button>`;
 openModal(`<div class="detail-label">예약 상세 <span class="status ${statusKind(r.status)}">${r.archived?'보관됨':statusText[r.status]}</span></div><h2>${esc(c?.name||'고객')}</h2><div class="detail-row"><b>일시</b><span>${r.date} ${r.time} · ${r.minutes}분</span></div><div class="detail-row"><b>프로그램</b><span>${esc(r.service)}</span></div><div class="detail-row"><b>담당/공간</b><span>${esc(staffLabel(r.staff))} · ${esc(r.room)}</span></div><div class="detail-row"><b>주의사항</b><span>${esc(c?.precautions.join(', ')||'없음')}</span></div><div class="detail-row"><b>횟수권 잔여</b><span>${c?.membership?`${c.membership.total-c.membership.used}회`:'회원권 없음'}</span></div><div class="detail-row"><b>차량/주차</b><span>${esc(c?.vehicle||'차량 없음')} · ${r.parking?'완료':'미처리'}</span></div>${treatment?`<div class="msgbox" style="margin-top:12px">관리 기록: ${esc(treatment.note||'별도 메모 없음')}
제품: ${esc(treatment.products||'미입력')} · 관리 압: ${esc(treatment.pressure||'미입력')}</div>`:''}<div class="field" style="margin-top:18px"><label for="resStatusUpdate">예약 상태 · 노쇼 이후에도 수정 가능</label><div class="inline-action"><select class="select" id="resStatusUpdate" ${r.archived?'disabled':''}>${Object.entries(statusText).map(([value,label])=>`<option value="${value}" ${r.status===value?'selected':''}>${label}</option>`).join('')}</select><button class="btn" data-res-action="set-status" data-res-id="${id}" ${r.archived?'disabled':''}>상태 적용</button></div></div><div class="detail-actions"><button class="btn small" data-customer="${r.cid}">고객카드</button>${!r.archived&&r.status==='CONFIRMED'?`<button class="btn small" data-res-action="arrive" data-res-id="${id}">방문 접수</button><button class="btn small" data-res-action="no-show" data-res-id="${id}">노쇼</button>`:''}${actionRow}</div><p class="fake">삭제는 보관 처리이며, 보관함에서 복원할 수 있습니다. 실제 알림톡/주차 등록은 전송되지 않습니다.</p>`);
}
function reservationAction(kind,id){const r=state.reservations.find(x=>x.id===id);if(!r)return;
 if(kind==='edit'){editReservation(id);return}
 if(kind==='set-status'){changeStatus(id,$('#resStatusUpdate').value);return}
 if(kind==='arrive'){changeStatus(id,'ARRIVED');return}
 if(kind==='no-show'){changeStatus(id,'NO_SHOW');return}
 if(kind==='complete'){openTreatmentForm(id);return}
 if(kind==='rebook'){closeModal();newReservation({cid:r.cid,date:dateAdd(r.date,28),time:r.time,staff:r.staff,room:r.room});return}
 if(kind==='parking'){r.parking=!r.parking;toast('데모: 주차 처리 상태 변경');}
 if(kind==='archive'){if(!confirm('예약을 삭제 보관함으로 이동할까요? 관리·결제 기록은 삭제되지 않습니다.'))return;r.archived=true;state.audits.push({action:'RESERVATION_ARCHIVED',reservation:id,date:TODAY()});}
 if(kind==='restore'){const conflict=conflictFor({...r,archived:false},r.id);if(conflict){toast('같은 시간의 예약 충돌로 복원할 수 없습니다.');return}r.archived=false;state.audits.push({action:'RESERVATION_RESTORED',reservation:id,date:TODAY()});}
 state.audits.push({action:'RESERVATION_'+kind.toUpperCase(),reservation:id,date:TODAY()});save();closeModal();render();
}
function saveReservation(){const cid=$('#resCustomer').value,date=$('#resDate').value,time=$('#resTime').value,minutes=Number($('#resMinutes').value),service=$('#resService').value,staff=$('#resStaff').value,room=$('#resRoom').value;
 if(!date||!time||!Number.isFinite(minutes)){toast('일시와 소요시간을 입력하세요.');return}
 const st=asMinutes(time);if(st%15!==0||st<SLOT_START||st+minutes>SLOT_END){toast('09:00~21:00 내 15분 단위로 입력하세요.');return}
 const old=state.reservations.find(r=>r.id===editingReservationId);const candidate={cid,date,time,minutes,service,staff,room,status:old?.status||'CONFIRMED',archived:old?.archived||false};const conflict=conflictFor(candidate,editingReservationId);
 if(conflict){toast(`${conflict.time} ${conflict.staff} 예약과 관리사/관리실 일정이 겹칩니다.`);return}
 if(old?.status==='COMPLETED'){toast('관리 완료 예약은 먼저 완료를 취소해야 수정할 수 있습니다.');return}if(old){Object.assign(old,candidate);state.audits.push({action:'RESERVATION_EDIT',reservation:old.id,date:TODAY()});toast('예약 편집이 저장되었습니다.');}
 else{const r={id:'R'+Date.now(),...candidate,parking:false};state.reservations.push(r);state.audits.push({action:'RESERVATION_CREATE',reservation:r.id,date:TODAY()});toast('새 예약을 등록했습니다.');}
 if(window._waitAssignId){const q=state.waitlist.find(x=>x.id===window._waitAssignId);if(q)q.status='ASSIGNED';window._waitAssignId=null;}scheduleDate=date;editingReservationId=null;save();closeModal();setView('reservations');
}
function openTreatmentForm(id){window._treatmentId=id;const r=state.reservations.find(x=>x.id===id);if(!r||r.archived)return;if(r.status==='COMPLETED'){toast('이미 완료된 예약입니다.');return}const c=customer(r.cid);const remaining=c?.membership?c.membership.total-c.membership.used:0;
 openModal(`<h2>관리 완료 · 기록 입력</h2><p class="subtle">${esc(c?.name)} · ${r.date} ${r.time} · ${esc(r.service)}</p><div class="twocol" style="margin-top:15px"><div class="field"><label>관리 전 상태</label><input id="txBefore" class="input" placeholder="예: 볼 건조감"></div><div class="field"><label>관리 후 반응</label><input id="txAfter" class="input" placeholder="예: 붉어짐 없음"></div><div class="field"><label>사용 제품</label><input id="txProducts" class="input" placeholder="예: 수분 앰플, 진정 팩"></div><div class="field"><label>사용 기기</label><input id="txDevice" class="input" placeholder="예: LED"></div><div class="field"><label>관리 압/강도</label><select id="txPressure" class="select"><option value="약하게">약하게</option><option value="보통" selected>보통</option><option value="강하게">강하게</option></select></div><div class="field"><label>이번 방문 정산</label><select id="txPayType" class="select">${remaining>0?`<option value="membership">회원권 1회 사용 · 잔여 ${remaining}회</option>`:''}<option value="NONE">결제 기록 없음</option><option value="CARD">카드 결제</option><option value="CASH">현금 결제</option><option value="TRANSFER">계좌이체</option></select></div></div><div class="field"><label>새 결제금액 (회원권 사용 시 0원)</label><input id="txAmount" class="input" type="number" min="0" value="0"></div><div class="field"><label>관리사 메모</label><textarea id="txNote" class="textarea" rows="3" placeholder="관리 내용과 특이사항"></textarea></div><div class="field"><label><input type="checkbox" id="txRebook" checked> 관리 완료 후 다음 예약과 예약톡 미리보기 제안</label></div><div class="fake">완료 기록과 회원권 차감은 동일 예약의 중복 처리를 방지합니다. 카드 결제는 기록만 저장하며 실제 카드 결제는 실행하지 않습니다.</div><div class="actions"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="saveTreatment">관리 완료·정산 저장</button></div>`);
}
function saveTreatment(){const id=window._treatmentId;const r=state.reservations.find(x=>x.id===id);if(!r||r.status==='COMPLETED'||state.treatments.some(x=>x.reservationId===id&&!x.voided)){toast('이미 관리 완료 처리된 예약입니다.');return}const c=customer(r.cid),payType=$('#txPayType').value,amount=Number($('#txAmount').value||0),next=$('#txRebook').checked;
 if(!Number.isFinite(amount)||amount<0){toast('결제금액을 확인하세요.');return}if(payType==='membership'&&(!c.membership||c.membership.used>=c.membership.total)){toast('회원권 잔여 횟수가 부족합니다.');return}
  const matchedInventory=($('#txProducts').value||'').split(',').map(x=>x.trim()).filter(Boolean).map(name=>state.inventory?.find(p=>p.name===name)).filter(Boolean);
  if(matchedInventory.some(p=>p.stock<1)){toast('사용 제품의 재고가 부족합니다. 입출고에서 조정해주세요.');return}
 const tx={id:'T'+Date.now(),previousLast:c.last,reservationId:id,cid:r.cid,date:r.date,service:r.service,staff:r.staff,before:$('#txBefore').value.trim(),after:$('#txAfter').value.trim(),products:$('#txProducts').value.trim(),device:$('#txDevice').value.trim(),pressure:$('#txPressure').value,note:$('#txNote').value.trim(),payType,amount:payType==='membership'?0:amount,voided:false,inventoryMoves:matchedInventory.map(p=>({productId:p.id,delta:-1}))};state.treatments.push(tx);matchedInventory.forEach(p=>p.stock--);
 if(payType==='membership'){c.membership.used++;state.membershipUsages.push({id:'MU'+Date.now(),reservationId:id,cid:r.cid,delta:-1,type:'CONSUME',date:TODAY()});}
 if(['CARD','CASH','TRANSFER'].includes(payType)){state.payments.push({id:'PY'+Date.now(),reservationId:id,cid:r.cid,amount,type:payType,voided:false,date:TODAY()})}
 r.status='COMPLETED';c.last=r.date;c.history.push({reservationId:id,date:r.date,label:r.service,note:tx.note||`${r.staff} 관리 완료`,products:tx.products,pressure:tx.pressure});state.audits.push({action:'TREATMENT_COMPLETE',reservation:id,cid:r.cid,date:TODAY(),payType});save();closeModal();render();toast('관리 완료 · 이력/회원권/결제를 반영했습니다.');if(next)openAfterTreatment(id);
}
function undoCompletion(r){const c=customer(r.cid),tx=state.treatments.find(x=>x.reservationId===r.id&&!x.voided);if(!tx)return;tx.voided=true;tx.voidedAt=TODAY();(tx.inventoryMoves||[]).forEach(m=>{const item=state.inventory?.find(p=>p.id===m.productId);if(item)item.stock-=m.delta});c.last=tx.previousLast??c.last;c.history=c.history.filter(h=>h.reservationId!==r.id);const usage=state.membershipUsages.find(x=>x.reservationId===r.id&&x.type==='CONSUME'&&!x.reversedAt);if(usage){usage.reversedAt=TODAY();c.membership.used=Math.max(0,c.membership.used-1);state.membershipUsages.push({id:'MU-R'+Date.now(),reservationId:r.id,cid:c.id,delta:+1,type:'REVERSAL',date:TODAY()})}state.payments.filter(x=>x.reservationId===r.id&&!x.voided).forEach(x=>{x.voided=true;x.voidedAt=TODAY()});state.audits.push({action:'TREATMENT_REVERSED',reservation:r.id,date:TODAY()});}
function openAfterTreatment(id){const r=state.reservations.find(x=>x.id===id);if(!r)return;const c=customer(r.cid);afterCompletionId=id;
 openModal(`<h2>관리 완료 · 다음 단계</h2><div class="notice"><strong>${esc(c.name)} 고객 관리가 완료됐어요.</strong><div>관리이력과 회원권·결제 기록이 고객카드에 반영됐습니다.</div></div><div class="c360-box" style="margin-top:14px"><h3>예약톡 미리보기</h3><p class="msgbox">${esc(c.name)} 고객님, 오늘 ${esc(r.service)} 관리를 이용해 주셔서 감사합니다. 다음 방문도 편하게 예약해 주세요.

※ 시연용 초안이며 실제로 발송되지 않았습니다.</p><button class="btn small" data-act="saveMessageDraft">메시지 초안 저장</button></div><div class="field" style="margin-top:16px"><label>다음 예약 추천일 (기본 4주 후)</label><input id="followNextDate" type="date" class="input" value="${dateAdd(r.date,28)}"></div><div class="actions"><button class="btn" data-act="closeModal">나중에</button><button class="btn primary" data-act="newNextReservation">＋ 다음 예약 잡기</button></div>`);
}
function saveMessageDraft(){const r=state.reservations.find(x=>x.id===afterCompletionId);if(!r)return;state.messageDrafts.push({id:'MD'+Date.now(),cid:r.cid,reservationId:r.id,category:'POST_VISIT',content:`${customer(r.cid).name} 고객님, 오늘 ${r.service} 관리를 이용해 주셔서 감사합니다.`,status:'DRAFT'});save();toast('예약톡/관리 후 메시지 초안을 저장했습니다. 실제 발송은 하지 않았습니다.');}
function newNextReservation(){const r=state.reservations.find(x=>x.id===afterCompletionId);if(!r)return;const date=$('#followNextDate')?.value||dateAdd(r.date,28);closeModal();newReservation({cid:r.cid,date,time:r.time,staff:r.staff,room:r.room});}
function finishReservation(id){window._treatmentId=id;openTreatmentForm(id);}
function scheduleDropProposal(id,proposal,kind){const r=state.reservations.find(x=>x.id===id);if(!r||r.archived)return;if(r.status==='COMPLETED'){toast('완료된 예약은 먼저 관리 완료를 취소해 주세요.');return}const next={...r,...proposal};if(next.time===r.time&&next.date===r.date&&next.staff===r.staff&&next.minutes===r.minutes)return;const start=asMinutes(next.time);if(start<SLOT_START||start+next.minutes>SLOT_END){toast('영업시간을 벗어납니다.');return}const conflict=conflictFor(next,r.id);if(conflict){toast(`${conflict.date} ${conflict.time} ${conflict.staff} 예약과 충돌합니다.`);return}dragIntent={id,proposal:next};openModal(`<h2>${kind==='resize'?'관리 시간 변경':'예약 이동'} 확인</h2><p class="subtle">${esc(customer(r.cid)?.name)} · ${esc(r.service)}</p><div class="comparison"><div><small>변경 전</small><b>${r.date} ${r.time}</b><span>${r.minutes}분 · ${esc(r.staff)}</span></div><div class="comparison-arrow">→</div><div><small>변경 후</small><b>${next.date} ${next.time}</b><span>${next.minutes}분 · ${esc(next.staff)}</span></div></div><div class="callout">확인 시 예약이 갱신됩니다. 예약 변경 알림은 실제로 발송되지 않습니다.</div><div class="actions"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="confirmScheduleDrop">변경 적용</button></div>`)}
function confirmScheduleDrop(){if(!dragIntent)return;const {id,proposal}=dragIntent,r=state.reservations.find(x=>x.id===id);if(!r)return;const conflict=conflictFor(proposal,id);if(conflict){toast('다른 예약과 충돌합니다.');return}const prev={date:r.date,time:r.time,minutes:r.minutes,staff:r.staff,room:r.room};Object.assign(r,{date:proposal.date,time:proposal.time,minutes:proposal.minutes,staff:proposal.staff,room:proposal.room});state.audits.push({action:'DRAG_RESCHEDULE',reservation:id,before:prev,after:{date:r.date,time:r.time,minutes:r.minutes,staff:r.staff,room:r.room},date:TODAY()});dragIntent=null;save();closeModal();render();toast('시간표의 예약을 변경했습니다.');}

function asMinutes(time){const [h,m]=time.split(':').map(Number);return h*60+m}
function sampleTranscript(kind){const samples={visit:'지난번 관리가 조금 세게 느껴졌어요. 요즘 볼 부위가 건조하고 당겨요. 다음 달 초에 다시 방문하고 싶어요.',interest:'윤곽관리 프로그램이 궁금해요. 가격을 비교하고 있어요. 주차는 몇 시간 지원되나요?',none:'오늘은 상담 내용을 점검했어요. 특별한 변화는 없고 기존 관리를 유지하고 싶어요.'};return samples[kind]||samples.visit;}
function syncAnalysisFields(){if(!analysisResult)return;const n=$('#consultNote'),memo=$('#approvalMemo');if(n)analysisResult.note=n.value;if(memo)analysisResult.reviewMemo=memo.value;document.querySelectorAll('[data-proposal-value]').forEach(el=>{const u=analysisResult.updates[Number(el.dataset.proposalValue)];if(u)u.value=el.value.trim()});}
function saveConsultationDraft(){if(!analysisResult){toast('상담을 먼저 분석해 주세요.');return;}syncAnalysisFields();const p=analysisResult;if(!p.note.trim()){toast('상담일지를 입력하세요.');return;}let item=state.consultations.find(x=>x.id===p.savedId);
 if(!item){item={id:'CO-'+Date.now(),cid:p.cid,date:TODAY(),status:'DRAFT',note:p.note,transcript:p.transcript,appliedChanges:0,source:analysisResult?.provider||'DEMO',reviewMemo:p.reviewMemo};state.consultations.unshift(item);p.savedId=item.id;}
 else{item.note=p.note;item.transcript=p.transcript;item.reviewMemo=p.reviewMemo;}
 state.audits.push({action:'CONSULTATION_DRAFT',cid:p.cid,consultation:item.id,date:TODAY()});save();toast('상담일지 임시저장 완료 · 고객 상담 탭에서도 확인 가능');}
function proposalEvidence(txt,pattern){return txt.match(new RegExp('[^.!?\\n]*?(?:'+pattern+')[^.!?\\n]*'))?.[0]?.trim()||'관련 언급'}

async function analyze(){const txt=$('#transcript')?.value.trim();if(!txt){toast('상담 내용을 입력해 주세요.');return;}const c=customer(activeConsultCid);const updates=[],signals=[];
 if(serverMode()&&window.ONGEOL_CONFIG?.aiEnabled===true&&c.recordingConsent){try{const apiResult=await remote.analyze(txt,{type:c.type,concerns:c.concerns,pressure:c.pressure,precautions:c.precautions},true);if(apiResult.provider!=='mock'){const types={concerns:'concern',pressure:'pressure',precaution:'precaution',next_visit:'followup',followup:'followup'};analysisResult={cid:activeConsultCid,transcript:txt,note:apiResult.summary,provider:apiResult.provider,signals:['서버 AI 모델 분석'],updates:(apiResult.profile_updates||[]).filter(x=>types[x.field]).map(x=>({type:types[x.field],title:x.field,old:'직원 검토',value:x.value,evidence:x.evidence,confidence:x.confidence,selected:true})),reviewMemo:'',savedId:null};render();toast('서버 AI 상담 분석 완료 · 직원 승인 전');return}}catch(e){toast('서버 AI 분석 실패: '+e.message);return}}
 if(/건조|당김/.test(txt)){signals.push('피부 고민: 건조·당김');if(!c.concerns.includes('건조함'))updates.push({type:'concern',title:'피부 고민 추가',old:c.concerns.join(', ')||'없음',value:'건조함',evidence:proposalEvidence(txt,'건조|당김'),selected:true});}
 if(/세게|압.*강|약하게/.test(txt)){signals.push('관리 강도 선호');if(c.pressure!=='약하게')updates.push({type:'pressure',title:'관리 압 선호',old:c.pressure||'미확인',value:'약하게',evidence:proposalEvidence(txt,'세게|압.*강|약하게'),selected:true});}
 if(/볼|자극/.test(txt)){signals.push('피부 주의사항');if(!c.precautions.includes('볼 부위 자극 주의'))updates.push({type:'precaution',title:'주의사항 추가',old:c.precautions.join(', ')||'없음',value:'볼 부위 자극 주의',evidence:proposalEvidence(txt,'볼|자극'),selected:true});}
 if(/다음달|다음 달|11월|재방문|다시 방문/.test(txt)){signals.push('재방문 의향');updates.push({type:'followup',title:'후속 업무 생성',old:'신규 할 일',value:'다음 달 초 재방문 안내',evidence:proposalEvidence(txt,'다음달|다음 달|11월|재방문|다시 방문'),selected:true});}
 if(/윤곽/.test(txt))signals.push('관심 프로그램: 윤곽관리');if(/가격|비용/.test(txt))signals.push('가격 문의');if(/주차/.test(txt))signals.push('주차 안내 요청');
 const summary=[];
 if(/건조|당김/.test(txt))summary.push('볼 부위 건조감 또는 당김 등 피부 고민을 언급함.');
 if(/세게|압.*강|약하게/.test(txt))summary.push('이전 관리의 강도에 대한 의견이 있어 다음 관리 시 압 조절 확인 필요.');
 if(/다음달|다음 달|11월|재방문|다시 방문/.test(txt))summary.push('다음 달 초 재방문 의향을 언급함.');
 if(/윤곽/.test(txt))summary.push('윤곽관리 프로그램에 관심을 보임.');
 if(/가격|비용/.test(txt))summary.push('가격 관련 문의 또는 비교를 언급함.');
 if(/주차/.test(txt))summary.push('주차 지원 정책 문의가 있음.');
 if(!summary.length)summary.push('이번 상담에서 새로운 변경사항은 추출하지 않음. 원문을 직원이 확인할 것.');
 analysisResult={cid:activeConsultCid,transcript:txt,note:summary.join('\n'),signals,updates,reviewMemo:'',savedId:null};render();toast('상담일지·변경 제안 생성 (규칙 기반 시뮬레이션)');}
function applyProposals(){if(!analysisResult)return;syncAnalysisFields();const p=analysisResult;const c=customer(p.cid);if(!p.note.trim()){toast('상담일지를 입력하세요.');return;}
 const changes=p.updates.filter(u=>u.selected);if(changes.some(u=>!u.value)){toast('선택한 변경 제안값을 모두 입력하세요.');return;}
 let rec=state.consultations.find(x=>x.id===p.savedId);
 if(!rec){rec={id:'CO-'+Date.now(),cid:p.cid,date:TODAY(),status:'APPROVED',note:p.note,transcript:p.transcript,appliedChanges:changes.length,source:analysisResult?.provider||'DEMO',reviewMemo:p.reviewMemo};state.consultations.unshift(rec);}
 else{rec.status='APPROVED';rec.note=p.note;rec.transcript=p.transcript;rec.appliedChanges=changes.length;rec.reviewMemo=p.reviewMemo;}
 for(const u of changes){if(u.type==='concern'&&!c.concerns.includes(u.value))c.concerns.push(u.value);else if(u.type==='pressure')c.pressure=u.value;else if(u.type==='precaution'&&!c.precautions.includes(u.value))c.precautions.push(u.value);else if(u.type==='followup')state.followups.push({id:'F'+Date.now()+'-'+state.followups.length,cid:c.id,title:u.value,status:'OPEN',consultationId:rec.id});c.events.push({date:TODAY(),label:u.title+': '+u.value,evidence:u.evidence,consultationId:rec.id,reviewMemo:p.reviewMemo});}
 state.audits.push({action:'CONSULTATION_APPROVED',cid:c.id,consultation:rec.id,count:changes.length,date:TODAY()});analysisResult=null;selectedCustomer=c.id;customerTab='consult';customerMobileDetail=true;save();setView('customers');toast(`상담일지 확정 · 고객정보 ${changes.length}건 반영`);}

function act(action){switch(action){case 'newReservation':newReservation();break;case 'scheduleToday':scheduleDate=TODAY();render();break;case 'newCustomer':newCustomer();break;case 'goReservations':setView('reservations');break;case 'goAI':activeConsultCid=selectedCustomer;analysisResult=null;setView('ai');break;case 'goCustomerAI':activeConsultCid=selectedCustomer;analysisResult=null;setView('ai');break;case 'rebookCustomer':newReservation({cid:selectedCustomer});break;case 'analyze':analyze();break;case 'applyProposals':applyProposals();break;case 'saveConsultDraft':saveConsultationDraft();break;case 'clearProposals':analysisResult=null;render();break;case 'saveCustomer':saveCustomer();break;case 'saveReservation':saveReservation();break;case 'saveTreatment':saveTreatment();break;case 'confirmScheduleDrop':confirmScheduleDrop();break;case 'saveMessageDraft':saveMessageDraft();break;case 'newNextReservation':newNextReservation();break;case 'closeModal':closeModal();dragIntent=null;break;case 'resetDemo':if(serverMode())break;if(confirm('가상 데이터와 데모 변경내역을 초기화할까요?')){state=seed();save();scheduleDate=TODAY();scheduleMode='timetable';staffFilter='ALL';statusFilter='ALL';weekStaff='미지정';scheduleZoom=.30;selectedCustomer='C001';customerTab='overview';analysisResult=null;customerMobileDetail=false;ensureDemoState();ensureExtendedState();closeModal();setView('today');toast('초기화했습니다.')}break}}
// v0.6 - Shop operations, marketing workbench and consent-aware prototypes.
// All channel sends are SIMULATED. No external result is displayed as real.
let operationTab='waitlist', marketingTab='overview';
const dayDiff=(a,b=TODAY())=>Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000);
const won=n=>new Intl.NumberFormat('ko-KR').format(Number(n||0))+'원';
const eid=prefix=>prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const options=(list,selected)=>list.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('');
const ct=x=>customer(x.cid)?.name||'알 수 없음';
function ensureExtendedState(){
  state.photos ||= [];state.waitlist ||= [];state.inventory ||= (serverMode()?[]:[{id:'P1',name:'수분 앰플',stock:14,min:5,unit:'개',cost:12000},{id:'P2',name:'진정 팩',stock:6,min:8,unit:'개',cost:4500}]);
  state.staffNames ||= (serverMode()?[]:['김원장','이관리사']);STAFf.splice(0,STAFf.length,...(state.staffNames.length?state.staffNames:['미지정']));state.rooms ||= (serverMode()?['관리실 A']:['관리실 A','관리실 B']);
  state.staffShifts ||= [];state.consents ||= [];state.intakeForms ||= [];state.hygieneTasks ||= [];
  state.shopTasks ||= [];state.snapshots ||= [];state.campaigns ||= [];state.messageQueue ||= [];
  state.services ||= (serverMode()?[]:[{id:'S1',name:'수분 집중관리',minutes:90,price:120000},{id:'S2',name:'진정 집중관리',minutes:90,price:100000},{id:'S3',name:'탄력 집중관리',minutes:60,price:140000},{id:'S4',name:'신규 상담 + 피부관리',minutes:60,price:90000}]);
  state.shopConfig ||= (serverMode()?{name:remote.shopName||'내 매장',parkingMinutes:120,cancelHours:24,commissions:[]}:{name:'온결 에스테틱 (시연)',parkingMinutes:120,cancelHours:24,commissions:[{staff:'김원장',rate:0},{staff:'이관리사',rate:10}]});
  state.customers.forEach(c=>{if(c.marketingConsent===undefined)c.marketingConsent=false;if(c.recordingConsent===undefined)c.recordingConsent=false;if(c.photoConsent===undefined)c.photoConsent=false;c.allergies ||= [];c.intake ||= '';});
}
ensureExtendedState();
const pane=(title,body,side='')=>`<section class="panel"><div class="panelhead"><h2>${title}</h2>${side}</div>${body}</section>`;
const rowAction=(title,desc,actions='')=>`<div class="listitem"><div><h3>${title}</h3><p>${desc}</p></div><div class="actions">${actions}</div></div>`;
const xbutton=(name,action,id='',cls='small')=>`<button class="btn ${cls}" data-extra="${action}" data-id="${esc(id)}">${name}</button>`;
const tabbar=(items,selected,which)=>`<div class="tabstrip" role="tablist">${items.map(([key,label])=>`<button class="${selected===key?'active':''}" data-extra-tab="${which}" data-key="${key}">${label}</button>`).join('')}</div>`;
function renderOperations(){
  const nav=[['waitlist','대기예약'],['intake','상담·동의서'],['inventory','제품·재고'],['staff','직원·근무표'],['tasks','운영 체크리스트'],['messages','예약톡·메시지']];
  return header('OPERATIONS','매장 운영 도구','예약 전·후의 실무 작업을 모아서 처리합니다.', xbutton('＋ 새 업무','addTask','', 'primary'))+tabbar(nav,operationTab,'operations')+({waitlist:renderWaitlist,intake:renderIntake,inventory:renderInventory,staff:renderShifts,tasks:renderTasks,messages:renderMessageCenter}[operationTab]());
}
function renderWaitlist(){
 const waiting=state.waitlist.filter(x=>x.status==='WAITING');
 return pane('대기예약 '+waiting.length+'건',`<div class="liststack">${waiting.length?waiting.map(w=>rowAction(`${esc(customer(w.cid)?.name)} · ${esc(w.service)}`,`${w.date} · ${w.time||'시간 협의'} · ${esc(w.staff||'담당 미정')} · ${esc(w.memo||'')}`,xbutton('예약으로 전환','waitAssign',w.id,'small primary')+xbutton('대기 취소','waitCancel',w.id))).join(''):'<div class="empty">대기 중인 고객이 없습니다.</div>'}</div><div style="margin-top:14px">${xbutton('＋ 대기예약 추가','waitNew','', 'primary')}</div>`) + pane('운영 기준','취소로 빈 시간이 생기면 대기 고객에게 먼저 연락하고, 확정 후 예약으로 전환합니다. 실제 카카오톡은 연결 전까지 발송하지 않습니다.');
}
function renderIntake(){
 return pane('사전 상담·동의 관리',`<div class="liststack">${state.customers.map(c=>{const f=state.intakeForms.filter(x=>x.cid===c.id).at(-1);return rowAction(esc(c.name),`최근 사전상담: ${f?esc(f.date):'없음'} · 녹음 동의 ${c.recordingConsent?'동의':'미동의'} · 마케팅 수신 ${c.marketingConsent?'동의':'미동의'}`,xbutton('상담·동의 입력','intakeEdit',c.id,'small primary')).replace('<div class="listitem">','<div class="listitem">')}).join('')}</div><p class="fineprint">녹음 동의/상담 기록과 마케팅 수신동의는 독립적으로 보관합니다. 알레르기·피부 특이사항은 민감할 수 있어 접근 권한, 보관기간, 삭제 정책이 필요합니다.</p>`);
}
function renderInventory(){
 return pane('제품·재고',`<div class="liststack">${state.inventory.map(p=>rowAction(`${esc(p.name)} <span class="${p.stock<=p.min?'tinywarn':''}">${p.stock<=p.min?'재고 부족':''}</span>`,`${p.stock}${esc(p.unit)} 남음 · 최소재고 ${p.min} · 단가 ${won(p.cost)}`,xbutton('입출고','stockAdjust',p.id))).join('')}</div><div style="margin-top:14px">${xbutton('＋ 제품 등록','productAdd','', 'primary')}</div><p class="fineprint">사용제품의 실제 차감 단위는 관리기록과 연결해 확장할 수 있도록 상품 ID 중심으로 관리합니다. 현재는 수량 조정을 시연합니다.</p>`);
}
function renderShifts(){
 return pane('관리사·휴무',`<div style="margin-bottom:12px">${xbutton('＋ 관리사 추가','staffNew','','primary')}</div><div class="liststack">${STAFf.map(s=>rowAction(esc(s),`기본 영업 09:00–21:00 · 등록된 휴무 ${state.staffShifts.filter(x=>x.staff===s&&x.type==='OFF').length}건`,xbutton('휴무 등록','offAdd',s,'small primary'))).join('')}</div><div class="sectionline">${state.staffShifts.filter(x=>x.type==='OFF').map(x=>rowAction(`${esc(x.staff)} · ${x.date}`,esc(x.reason||'휴무'),xbutton('취소','offDelete',x.id))).join('')||'<p class="fineprint">등록된 휴무가 없습니다.</p>'}</div><p class="fineprint">휴무일에는 신규 예약 저장 및 일정 이동 시 충돌 여부를 확인합니다.</p>`);
}
function renderTasks(){
 const tasks=state.shopTasks.filter(x=>!x.done);
 return pane('운영 할 일',`<div class="liststack">${tasks.length?tasks.map(t=>rowAction(esc(t.title),`${t.due||'기한 없음'} · ${esc(t.category||'운영')}`,xbutton('완료','taskDone',t.id))).join(''):'<div class="empty">미완료 할 일이 없습니다.</div>'}</div><div style="margin-top:14px">${xbutton('＋ 할 일 등록','addTask','', 'primary')}</div>`)+pane('운영 체크리스트 제안','시술실 소독, 제품 유통기한 점검, 기기 점검, 수건/소모품 정리, 고객 재방문 연락 등 반복 업무를 일정에 연결하는 방식으로 확장합니다.');
}
function messageText(r,kind){const c=customer(r.cid),name=c?.name||'고객',time=`${r.date} ${r.time}`;const parking=state.shopConfig.parkingMinutes;switch(kind){case 'CONFIRM':return `${name} 고객님, ${time} ${r.service} 예약이 확정되었습니다. 주차 지원 ${parking}분입니다.`;case 'REMIND':return `${name} 고객님, ${time} ${r.service} 예약 안내드립니다. 변경이 필요하면 샵으로 연락주세요. 주차 지원 ${parking}분입니다.`;case 'REBOOK':return `${name} 고객님, 지난 관리 이후 어떠셨나요? 다음 관리 일정을 편하실 때 문의해주세요.`;default:return `${name} 고객님, 방문해주셔서 감사합니다.`}}
function renderMessageCenter(){
 const d=state.messageQueue;return pane('예약톡·자동 알림 설계',`<div class="liststack">${['예약 확정','예약 하루 전','예약 변경·취소','방문 후 상태 확인','재방문 안내'].map((x,i)=>rowAction(x,`메시지 유형 ${i<3?'예약 정보성':'동의 검토 필요'} · 외부 발송 비활성`,i===0?xbutton('예약톡 초안 작성','messageNew','', 'small primary'):'' )).join('')}</div><div class="sectionline"><h3>저장한 메시지 초안 (${d.length+state.messageDrafts.length})</h3>${[...d,...state.messageDrafts].slice(-12).reverse().map(m=>rowAction(esc(customer(m.cid)?.name||'수신자'),`${esc(m.content||'')} · ${esc(m.status||'DRAFT')}`)).join('')||'<p class="fineprint">초안이 없습니다.</p>'}</div><p class="fineprint">현재는 초안 작성·검토·시뮬레이션만 지원합니다. 실제 알림톡은 공식 비즈니스 메시징 제공자 연결과 발송 승인 후 활성화합니다.</p>`);
}
const ACTIVE=x=>!x.archived&&!['CANCELLED','NO_SHOW'].includes(x.status);
function customerSegment(key){const future=x=>state.reservations.some(r=>r.cid===x.id&&ACTIVE(r)&&r.date>=TODAY());const days=x=>x.last?dayDiff(x.last):999;
 if(key==='dormant')return state.customers.filter(c=>days(c)>=40);
 if(key==='membership')return state.customers.filter(c=>c.membership&&(c.membership.total-c.membership.used)<=2&&!future(c));
 if(key==='noNext')return state.customers.filter(c=>c.last&&!future(c));
 if(key==='new')return state.customers.filter(c=>dayDiff(c.joined)<=30);
 return state.customers;
}
function renderMarketing(){
 return header('GROWTH STUDIO','마케팅 코파일럿','내부 데이터 분석 → 검색·리뷰 관측 → 캠페인 작성·성과 기록')+`<div class="callout"><b>연동 전 모드:</b> 외부 검색 노출/순위/리뷰는 실측 데이터가 아닙니다. 직접 입력한 스냅샷만 표시하며, 메시지는 실제 발송하지 않습니다. 내부 지표는 현재 저장된 매장 데이터에서 계산합니다.</div>`+tabbar([['overview','인사이트'],['exposure','외부 노출'],['crm','CRM 고객'],['campaigns','캠페인']],marketingTab,'marketing')+({overview:renderMarketInsight,exposure:renderExposure,crm:renderCRM,campaigns:renderCampaigns}[marketingTab]());
}
function renderMarketInsight(){
 const thisMonth=TODAY().slice(0,7),r=state.reservations.filter(x=>x.date.startsWith(thisMonth)&&!x.archived),completed=r.filter(x=>x.status==='COMPLETED'),newCust=state.customers.filter(c=>c.joined.startsWith(thisMonth)),rev=state.payments.filter(x=>!x.voided&&x.date?.startsWith(thisMonth)).reduce((a,p)=>a+p.amount,0);
 const activeC=state.customers.filter(c=>c.last&&dayDiff(c.last)<40).length;const dormant=customerSegment('dormant').length;
 return `<div class="grid4">${stat('이번 달 예약',r.length+'건','현재 데이터 기준')}${stat('관리 완료',completed.length+'건','현재 데이터 기준')}${stat('매출 입력',won(rev),'회원권 사용 금액 제외')}${stat('재방문 관심',dormant+'명','마지막 방문 40일 이상')}</div>`+
 pane('근거 기반 운영 제안',`<div class="liststack">${rowAction('휴면 고객 재예약',`마지막 방문 40일 이상 ${dormant}명 · 기준 날짜: ${TODAY()}`,xbutton('대상 보기','marketCRM','dormant'))}${rowAction('회원권 만료·잔여 관리',`잔여 2회 이하 / 다음 예약 없음 ${customerSegment('membership').length}명`,xbutton('대상 보기','marketCRM','membership'))}${rowAction('신규 고객 유지',`이번 달 신규 고객 ${newCust.length}명 · 아직 재방문 정보 없는 고객 우선 검토`,xbutton('대상 보기','marketCRM','new'))}${rowAction('시술 후 후속 업무',`${state.followups.filter(x=>x.status==='OPEN').length}건 진행 대기`,xbutton('업무 보기','marketOps','tasks'))}</div><p class="fineprint">인과관계나 광고효과를 단정하지 않습니다. 상담 AI 인사이트는 연결 후 원문 근거와 집계 표본을 함께 표시해야 합니다.</p>`);
}
function renderExposure(){return pane('검색 노출·리뷰 스냅샷',`<div class="liststack">${state.snapshots.length?state.snapshots.slice().reverse().map(s=>rowAction(`${esc(s.channel)} · ${esc(s.keyword)}`,`${s.checkedAt} · ${s.detected?'발견':'미발견'} · ${esc(s.band)} · 메모: ${esc(s.memo||'없음')}`,xbutton('삭제','snapshotDelete',s.id))).join(''):'<div class="empty">수집된 외부 검색 데이터가 없습니다. 외부 API 연결 전에는 실측으로 표시하지 않습니다.</div>'}</div><div style="margin-top:13px">${xbutton('＋ 관측값 직접 입력','snapshotAdd','', 'primary')}</div><p class="fineprint">네이버/카카오/Google의 검색 결과는 위치·기기·개인화 등으로 달라질 수 있습니다. API 연결 후에도 검색조건·시점·수집방식을 보존합니다.</p>`)+pane('외부 채널 연결 상태',`<div class="cards3">${['네이버/블로그','카카오 검색/예약톡','Google Business Profile'].map(n=>`<div class="info"><label>${n}</label><strong>미연결 · Provider 준비</strong></div>`).join('')}</div>`);}
function renderCRM(){return pane('세그먼트 분석',`<div class="cards3">${[['dormant','40일 이상 미방문'],['membership','잔여권 2회 이하 / 재예약 없음'],['noNext','다음 예약 없는 방문 고객'],['new','최근 30일 신규']].map(([key,label])=>`<div class="module"><strong>${label}</strong><p>${customerSegment(key).length}명 · 수신동의 ${customerSegment(key).filter(c=>c.marketingConsent).length}명</p>${xbutton('이 그룹 캠페인','campaignNew',key,'small primary')}</div>`).join('')}</div><div class="sectionline"><p class="fineprint">마케팅 캠페인 대상은 반드시 별도 광고성 수신동의 여부를 확인합니다. 정보성 예약 알림과 구분합니다.</p></div>`);}
function renderCampaigns(){return pane('캠페인',`<div class="liststack">${state.campaigns.length?state.campaigns.slice().reverse().map(c=>rowAction(esc(c.name),`${c.segment} · 대상 ${c.targets.length}명 · 동의 ${c.targets.filter(id=>customer(id)?.marketingConsent).length}명 · ${c.status} · 매출 연결 ${won(c.revenue||0)}`,xbutton('초안/성과 보기','campaignView',c.id,'small primary'))).join(''):'<div class="empty">등록된 캠페인이 없습니다.</div>'}</div><div style="margin-top:13px">${xbutton('＋ 캠페인 작성','campaignNew','all','primary')}</div>`);}
function renderAnalytics(){const p=state.payments.filter(x=>!x.voided),gross=p.reduce((a,x)=>a+(Number(x.amount)||0),0),tc=state.treatments.filter(x=>!x.voided),no=state.reservations.filter(x=>x.status==='NO_SHOW'&&!x.archived).length,all=state.reservations.filter(x=>!x.archived),r=state.reservations.filter(x=>!x.archived&&x.status==='COMPLETED');const staff=STAFf.map(s=>({name:s,count:tc.filter(x=>x.staff===s).length,amount:p.filter(y=>state.reservations.find(x=>x.id===y.reservationId)?.staff===s).reduce((a,y)=>a+y.amount,0)}));
return header('ANALYTICS','매출·운영 분석',serverMode()?'입력된 결제 내역 기준 · 실제 매장 저장 데이터':'입력된 결제 내역 기준 · 시연용 가상 데이터 포함')+`<div class="grid4">${stat('결제 입력 합계',won(gross),'환불·취소 처리 제외')}${stat('완료한 관리',r.length+'건','관리기록 확정')}${stat('노쇼 비중',all.length?Math.round(no/all.length*100)+'%':'0%','예약 상태 기준')}${stat('방문 이력 보유',state.customers.filter(x=>x.last).length+'명','고객 수 중')}</div>`+pane('관리사별 실적',`<div class="liststack">${staff.map(x=>rowAction(esc(x.name),`관리 ${x.count}건 · 입력된 결제 매출 ${won(x.amount)}`)).join('')}</div>`)+pane('최근 결제 및 취소',`<div class="liststack">${state.payments.slice().reverse().slice(0,12).map(x=>rowAction(`${esc(customer(x.cid)?.name)} · ${won(x.amount)}`,`${x.date||''} · ${x.type} · ${x.voided?'취소됨':'유효'}`,x.voided?'':xbutton('결제 취소','paymentVoid',x.id))).join('')||'<div class="empty">결제 기록이 없습니다.</div>'}</div><div style="margin-top:12px">${xbutton('＋ 결제 직접 입력','paymentNew','', 'primary')}</div>`);
}
function renderSettings(){return header('SETTINGS','매장·시스템 설정','매장 브랜드 · 직원 · 로그인 계정 · 권한 설정')+renderStaffManagement()+pane('매장 정보 / 예약 정책',`<div class="twocol"><div class="info"><label>매장</label><strong>${esc(state.shopConfig.name)}</strong></div><div class="info"><label>주차 기본 지원</label><strong>${state.shopConfig.parkingMinutes}분</strong></div><div class="info"><label>취소 안내 기준</label><strong>${state.shopConfig.cancelHours}시간 전</strong></div><div class="info"><label>연동</label><strong>${serverMode()?'Supabase 연결 · 외부 AI/메시징 미연결':'로컬 시연'}</strong></div></div><div style="margin-top:12px">${xbutton('매장 정책 수정','configEdit','', 'primary')} ${xbutton('＋ 관리실/베드 추가','roomNew','', 'small')}</div><div class="fineprint">관리실/베드: ${state.rooms.map(esc).join(', ')}</div>`)+pane('관리 프로그램',`<div class="liststack">${state.services.map(s=>rowAction(esc(s.name),`${s.minutes}분 · ${won(s.price)}`,xbutton('수정','serviceEdit',s.id))).join('')}</div><div style="margin-top:12px">${xbutton('＋ 프로그램 추가','serviceAdd','', 'primary')}</div>`)+pane('데이터 백업·복구',`<p class="fineprint">${serverMode()?'매장 데이터는 Supabase 서버에 저장됩니다. JSON 내보내기 파일은 고객 개인정보를 포함할 수 있으므로 안전하게 보관하세요. 무료 플랜에는 자동 백업이 없습니다.':'브라우저에만 저장하는 시연입니다.'}</p>${xbutton('JSON 백업 내보내기','backupExport')} ${xbutton('JSON 백업 불러오기','backupImport')} ${serverMode()?'':button('가상 데이터 초기화','resetDemo','danger small')}<input type="file" id="backupFile" accept="application/json,.json" style="display:none">`)+pane('서버·AI 통합',`<div class="callout">LLM/STT/Search/Messaging Provider 자격증명은 <b>API 서버 환경변수</b>에만 보관합니다. 브라우저에 비밀키를 넣지 마세요.</div><p class="fineprint">서버 연결은 Supabase Auth와 RLS를 사용합니다. LLM/STT는 다음 단계에서 별도 비밀키를 서버 측에 설정합니다.</p>`);
}
function shiftConflict(candidate){return state.staffShifts.filter(s=>s.type==='OFF'&&s.staff===candidate.staff&&s.date===candidate.date).map(s=>({...s,time:'휴무',staff:s.staff}))[0]}
// Shortcut: staff holiday conflicts included on reservation creation and drag / restore.
const baseConflict=conflictFor;
conflictFor=function(proposed,id){return baseConflict(proposed,id)||shiftConflict(proposed)};
function handleExtraClick(e){
 const tt=e.target.closest('[data-extra-tab]');if(tt){if(tt.dataset.extraTab==='marketing')marketingTab=tt.dataset.key;else operationTab=tt.dataset.key;render();return true}
 const fit=e.target.closest('[data-week-fit]');if(fit){weekFit=!weekFit;render();return true}
 const action=e.target.closest('[data-extra]');if(!action)return false;
 e.preventDefault();extraAction(action.dataset.extra,action.dataset.id||'');return true;
}

let recordingChunks=[], recorder=null, recordingStream=null;
function consentCheck(cid,kind){const c=customer(cid);if(!c||!c[kind]){toast('고객 동의가 필요합니다. 운영 도구 → 상담·동의서에서 먼저 기록하세요.');return false}return true;}
async function recordStart(){if(!consentCheck(activeConsultCid,'recordingConsent'))return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('HTTPS 또는 localhost에서 브라우저 녹음을 지원합니다.');
 try{recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});recordingChunks=[];recorder=new MediaRecorder(recordingStream);recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data)};recorder.start();toast('녹음 중입니다. 종료 버튼을 누르면 전사 또는 파일저장이 가능합니다.')}catch(e){toast('마이크 권한을 확인하세요.')}}
async function recordStop(){if(!recorder||recorder.state==='inactive')return toast('진행 중인 녹음이 없습니다.');const current=recorder;current.onstop=async()=>{const blob=new Blob(recordingChunks,{type:current.mimeType||'audio/webm'});recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;recorder=null;await handleAudio(blob,'consultation.webm');};current.stop()}
async function handleAudio(blob,filename){if(!consentCheck(activeConsultCid,'recordingConsent'))return;if(serverMode()) { const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('STT 미연결: 녹음 파일을 기기에 내려받았습니다. 다음 단계에 전사 API를 연결합니다.');return; }if(!serverMode()){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('서버 미연결: 녹음 파일만 내려받았습니다.');return;}try{const r=await remote.transcribe(blob,filename);const ta=$('#transcript');if(ta){ta.value=r.text;toast('녹취 텍스트를 가져왔습니다. 내용을 확인하고 분석하세요.')}}catch(e){toast('STT 오류: '+e.message)}}
async function photoFileChanged(file){if(!file)return;const cid=window._photoCid;if(!consentCheck(cid,'photoConsent'))return;try{
 const dataUrl=await shrinkImage(file);
 const photo={id:eid('PH'),cid,date:formValue('phDate')||TODAY(),kind:formValue('phKind'),area:formValue('phArea')||'얼굴'};
 if(serverMode()){
   const blob=await fetch(dataUrl).then(r=>r.blob());photo.storagePath=await remote.uploadPhoto(cid,blob);
   photo.dataUrl=await remote.photoUrl(photo.storagePath);
 }else photo.dataUrl=dataUrl;
 state.photos.push(photo);save();closeModal();customerTab='photo';render();toast(serverMode()?'비공개 사진 저장소에 등록했습니다.':'시연용 사진이 등록되었습니다.');
 }catch(e){toast('사진 처리 실패: '+e.message)}}
async function shrinkImage(file){if(file.size>12*1024*1024)throw Error('12MB 이하 이미지만 등록할 수 있습니다.');const im=await createImageBitmap(file);const scale=Math.min(1,720/im.width,720/im.height);const can=document.createElement('canvas');can.width=Math.round(im.width*scale);can.height=Math.round(im.height*scale);can.getContext('2d').drawImage(im,0,0,can.width,can.height);im.close();return can.toDataURL('image/jpeg',.65)}
function showPhoto(cid){if(!consentCheck(cid,'photoConsent'))return;window._photoCid=cid;openModal(`<h2>피부 전후 사진 등록</h2>${mfield('촬영일','phDate',TODAY(),'date')}${mselect('구분','phKind',['BEFORE','AFTER','GENERAL'],'BEFORE')}${mfield('부위','phArea','얼굴 정면')}<div class="field"><label>이미지 선택</label><input class="input" id="phFile" type="file" accept="image/*"></div><p class="fineprint">${serverMode()?'이미지를 압축한 후 비공개 스토리지에 업로드합니다. 고객에게 사진 수집 목적과 보관정책을 안내하세요.':'시연용 사진입니다. 실고객 사진은 사용하지 마세요.'}</p><div class="actions">${xbutton('사진 저장','photoSave',cid,'primary')}</div>`)}
function comparePhotos(cid){const ids=[formValue('photoBefore'),formValue('photoAfter')],images=ids.map(id=>state.photos.find(x=>x.id===id));if(images.some(x=>!x)||ids[0]===ids[1])return toast('서로 다른 두 사진을 선택하세요.');openModal(`<h2>사진 비교</h2><div class="compare-side">${images.map(x=>`<div><img src="${esc(x.dataUrl)}" alt="${x.kind}"><p>${esc(x.date)} ${x.kind}</p></div>`).join('')}</div><div class="fineprint">촬영 조건을 동일하게 맞추어 비교해야 합니다. AI 의료 진단 기능은 아닙니다.</div>`)}
function showMember(cid=''){openModal(`<h2>회원권 발행/판매</h2>${mselect('고객','mbCid',state.customers.map(c=>c.id),cid||state.customers[0]?.id)}${mfield('회원권 이름','mbName','수분 집중관리 10회권')}${mfield('총 횟수','mbTotal',10,'number')}${mfield('유효기간','mbExpire',dateAdd(TODAY(),365),'date')}${mfield('결제 금액 (증정 시 0)','mbAmount',0,'number')}${mselect('결제수단','mbPayType',['CARD','CASH','TRANSFER','GIFT'],'CARD')}${modalFooter('membershipSave')}`)}
function saveMember(){const cid=formValue('mbCid'),c=customer(cid),total=Number(formValue('mbTotal')),amount=Number(formValue('mbAmount'));if(!c||total<=0||!Number.isInteger(total)||amount<0)return toast('값을 확인하세요.');if(c.membership&&c.membership.used<c.membership.total&&!confirm('기존 잔여 회원권을 새 권으로 대체할까요? 기존 이력은 감사 로그로만 남습니다.'))return;c.membership={name:formValue('mbName'),total,used:0,expire:formValue('mbExpire')};state.membershipUsages.push({id:eid('MU'),cid,delta:total,type:'ISSUE',date:TODAY(),note:formValue('mbName')});if(amount>0)state.payments.push({id:eid('PY'),cid,amount,type:formValue('mbPayType'),memo:'회원권 판매: '+formValue('mbName'),date:TODAY(),voided:false});state.audits.push({action:'MEMBERSHIP_ISSUE',cid,amount,total,date:TODAY()});save();closeModal();render();toast('회원권 발행이 완료되었습니다.')}
function positionOptions(selected=''){
 return `<option value="">직책 없음</option>`+(remote.positions||[]).map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');
}
function renderStaffManagement(){
 if(!serverMode())return '';
 const admin=remote.role==='owner';
 const roleName={owner:'최고관리자',manager:'관리자',therapist:'직원 (현재 조회 전용)'};
 const profiles=remote.staff||[],positions=remote.positions||[];
 const account=remote.user?.email||'로그인 계정';
 const accountPhone=remote.user?.user_metadata?.contact_phone||'';
 return pane('로그인 계정 · 매장 직원 분리',`
   <div class="notice"><b>현재 로그인:</b> ${esc(account)} · 권한 <b>${roleName[remote.role]||'알 수 없음'}</b><br>
   <span class="fineprint">계정 표시는 관리자이며 실제 직원으로 자동 등록되지 않아. 공용 관리자 계정으로 모든 직원의 예약을 등록할 수 있지만 조작한 개인을 추적하려면 직원별 이메일 계정이 필요해.</span></div>
   <div class="sectionline"><h3>등록된 직원 ${profiles.length}명</h3></div>
   <div class="liststack">${profiles.length?profiles.map(x=>rowAction(`${esc(staffLabel(x.name))} ${x.active?'':'(비활성)'}`,
      `${x.auth_user_id===remote.user?.id?'내 관리자 계정 연결됨 · 권한 최고관리자':`계정 연결 시 권한: ${roleName[x.access_role]} · ${x.auth_user_id?'별도 계정 연결됨':'로그인 계정 없음'}`}`,
      admin?`${x.active&&!x.auth_user_id?xbutton('초대코드 발급','staffProfileInvite',x.id):''}${x.active&&!x.auth_user_id&&!profiles.some(p=>p.auth_user_id===remote.user?.id)?xbutton('내 관리자계정 연결','staffProfileLinkOwner',x.id):''}${x.auth_user_id===remote.user?.id?xbutton('내 계정 연결 해제','staffProfileUnlinkOwner',x.id):''}${xbutton('직원 수정','staffProfileEdit',x.id)}`:''
   )).join(''):'<div class="empty">직원 0명 · 필요한 직원을 이름만 입력해서 등록할 수 있어.</div>'}</div>
   ${admin?`<div style="margin-top:14px">${xbutton('＋ 직원 신규','staffProfileNew','','primary')}</div>`:''}
   <div class="fineprint">직책은 선택사항이야. 직원에 직책을 연결하면 화면에 <b>이름 · 직책</b>을 함께 표시해. 직책이나 직원이름을 변경해도 과거 예약 담당자 문자열은 자동 변경하지 않아.</div>
 `)+pane('직책 관리',`
   <div class="liststack">${positions.length?positions.map(x=>rowAction(esc(x.name),
       `배정 직원 ${profiles.filter(st=>st.position_id===x.id).length}명`,
       admin?xbutton('이름 수정','positionEdit',x.id):''
   )).join(''):'<div class="empty">등록된 직책이 없어. 직원은 직책 없이도 등록 가능해.</div>'}</div>
   ${admin?`<div style="margin-top:14px">${xbutton('＋ 직책 신규','positionNew','','primary')}</div>`:''}
 `)+pane('개인 계정 설정 · 이메일 로그인',`
    <div class="detail-row"><b>계정</b><span>${esc(account)}</span></div>
    <div class="detail-row"><b>연락처 (선택·미인증)</b><span>${esc(accountPhone||'등록 안 됨')}</span></div>
    ${xbutton('연락처 등록·수정','contactPhoneEdit','','small')}
    <p class="fineprint">로그인은 이메일/비밀번호만 지원해. 이 연락처는 업무상 표시용이고 SMS 인증·로그인에 사용되지 않아.</p>
    <p class="fineprint">직원 계정은 초대코드로 등록된 직원에 연결할 수 있어. 현재 JSONB DB 구조에서는 일반 직원은 조회 전용이며 관리자만 업무 수정이 가능해.</p>
 `);
}
async function refreshStaffView(){
 await remote.listStaff();
 const active=remote.staff.filter(x=>x.active).map(x=>x.name);
 state.staffNames=active; // zero staff is intentional; never create an implicit '원장' employee.
 STAFf.splice(0,STAFf.length,...(active.length?active:['미지정']));
 if(!active.includes(weekStaff))weekStaff=active[0]||'미지정';
 closeModal();render();
}
function openNewStaff(){
 if(!serverMode()||remote.role!=='owner')return toast('최고관리자 권한이 필요해.');
 openModal(`<h2>직원 신규 등록</h2>${mfield('직원 이름 *','staffProfileName')}
 <div class="field"><label>직책 (선택)</label><select class="select" id="staffProfilePosition">${positionOptions()}</select></div>
 <div class="field"><label>이 직원이 이메일 계정을 연결할 경우의 권한</label><select class="select" id="staffProfileRole"><option value="therapist">직원 (현재 조회 전용)</option><option value="manager">관리자 (업무 편집)</option></select></div>
 <p class="fineprint">직책이 없어도 직원 이름만으로 등록해. 로그인 계정은 따로 만들어야 하며, 필요할 때 초대코드를 발급하면 연결돼.</p>${modalFooter('staffProfileSave')}`);
}
async function saveNewStaff(){
 const name=formValue('staffProfileName'),positionId=formValue('staffProfilePosition')||null,role=formValue('staffProfileRole');
 if(!name)return toast('직원 이름을 입력해 줘.');
 try{await remote.addStaff(name,positionId,role);await refreshStaffView();toast('직원 프로필이 추가됐어.');}
 catch(e){toast('직원 등록 실패: '+e.message)}
}
function openEditStaff(id){
 if(remote.role!=='owner')return;
 const x=remote.staff.find(a=>a.id===id);if(!x)return;
 openModal(`<h2>직원 수정 · ${esc(x.name)}</h2>${mfield('직원 이름 *','editStaffName',x.name)}
 <div class="field"><label>직책 (선택)</label><select class="select" id="editStaffPosition">${positionOptions(x.position_id)}</select></div>
 <div class="field"><label>연결 계정 권한</label><select class="select" id="editStaffRole"><option value="therapist" ${x.access_role==='therapist'?'selected':''}>직원 (현재 조회 전용)</option><option value="manager" ${x.access_role==='manager'?'selected':''}>관리자 (업무 편집)</option></select></div>
 <label class="checkline"><input id="editStaffActive" type="checkbox" ${x.active?'checked':''}> 재직/활성</label>
 <div class="notice">직원 이름 변경 시 이미 생성된 과거 예약의 담당자 문자열은 자동 변환되지 않아.</div>${modalFooter('staffProfileUpdate',id)}`);
}
async function updateStaff(id){
 try{await remote.editStaff(id,formValue('editStaffName'),formValue('editStaffPosition')||null,formValue('editStaffRole'),$('#editStaffActive').checked);
 await refreshStaffView();toast('직원 정보가 변경됐어.');}
 catch(e){toast('변경 실패: '+e.message)}
}
async function linkOwnerStaff(id){
 if(!confirm('선택한 직원 프로필을 현재 최고관리자 로그인 계정과 연결할까? 관리자 권한은 그대로 유지돼.'))return;
 try{await remote.linkOwnerStaff(id);await refreshStaffView();toast('관리자 계정과 직원 프로필이 연결됐어.');}
 catch(e){toast('계정 연결 실패: '+e.message)}
}
async function unlinkOwnerStaff(id){
 if(!confirm('선택한 직원과 내 관리자 계정의 연결을 해제할까? 매장 최고관리자 권한은 그대로 유지돼.'))return;
 try{await remote.unlinkOwnerStaff(id);await refreshStaffView();toast('직원 연결이 해제됐어.');}
 catch(e){toast('연결 해제 실패: '+e.message)}
}
function openNewPosition(){
 if(remote.role!=='owner')return;
 openModal(`<h2>직책 신규 등록</h2>${mfield('직책 이름 *','positionName','','text')}<p class="fineprint">예: 원장, 실장, 피부관리사. 직책은 로그인 계정 권한과 무관해.</p>${modalFooter('positionSave')}`);
}
async function saveNewPosition(){
 const name=formValue('positionName');if(!name)return toast('직책 이름을 입력해 줘.');
 try{await remote.addPosition(name);await refreshStaffView();toast('직책이 등록됐어.');}catch(e){toast('직책 등록 실패: '+e.message)}
}
function openEditPosition(id){
 const item=remote.positions.find(p=>p.id===id);if(!item)return;
 const assigned=remote.staff.some(x=>x.position_id===id);
 openModal(`<h2>직책 수정</h2>${mfield('직책 이름','positionEditName',item.name)}
 ${modalFooter('positionUpdate',id)}${!assigned?`<div class="actions">${xbutton('미사용 직책 삭제','positionDelete',id,'danger small')}</div>`:'<p class="fineprint">이 직책을 사용 중인 직원이 있어 삭제할 수 없어.</p>'}`);
}
async function updatePosition(id){
 try{await remote.editPosition(id,formValue('positionEditName'));await refreshStaffView();toast('직책 이름이 수정됐어.');}catch(e){toast('직책 수정 실패: '+e.message)}
}
async function deletePosition(id){
 if(!confirm('미사용 직책을 삭제할까?'))return;
 try{await remote.deletePosition(id);await refreshStaffView();toast('직책이 삭제됐어.');}catch(e){toast('직책 삭제 실패: '+e.message)}
}
function openContactPhone(){
 const value=remote.user?.user_metadata?.contact_phone||'';
 openModal(`<h2>개인 연락처 (선택)</h2><p class="fineprint">SMS로 인증하지 않으며 로그인 수단으로 사용하지 않아.</p>
 ${mfield('연락처','contactPhone',value,'tel')}${modalFooter('contactPhoneSave')}`);
}
async function saveContactPhone(){
 try{await remote.updateContactPhone(formValue('contactPhone'));closeModal();render();toast('연락처가 저장됐어.');}
 catch(e){toast('연락처 저장 실패: '+e.message)}
}
async function inviteStaffProfile(id){
 try{const code=await remote.inviteStaff(id);
   openModal(`<h2>직원 초대코드</h2><p>직원이 Aesthetic Manager에서 <b>이메일 계정으로 가입·로그인</b>한 뒤 <b>기존 매장 참여</b>에 아래 코드를 입력하면 등록된 직원 프로필에 연결돼.</p>
   <div class="msgbox" style="word-break:break-all">${esc(code)}</div><button class="btn primary" id="copyStaffInvite">코드 복사</button><p class="fineprint">48시간 유효 · 1회 사용. 공개 채팅방이나 SNS에 올리지 마세요.</p>`);
   $('#copyStaffInvite').onclick=()=>navigator.clipboard?.writeText(code).then(()=>toast('초대코드 복사됨')).catch(()=>toast('코드를 직접 복사해 줘.'));
 }catch(e){toast('초대코드 발급 실패: '+e.message)}
}
function extraAction(action,id){
 switch(action){
 case 'staffProfileNew':openNewStaff();break;
 case 'staffProfileSave':void saveNewStaff();break;
 case 'staffProfileEdit':openEditStaff(id);break;
 case 'staffProfileUpdate':void updateStaff(id);break;
 case 'staffProfileInvite':void inviteStaffProfile(id);break;
 case 'staffProfileLinkOwner':void linkOwnerStaff(id);break;
 case 'staffProfileUnlinkOwner':void unlinkOwnerStaff(id);break;
 case 'contactPhoneEdit':openContactPhone();break;
 case 'contactPhoneSave':void saveContactPhone();break;
 case 'positionNew':openNewPosition();break;
 case 'positionSave':void saveNewPosition();break;
 case 'positionEdit':openEditPosition(id);break;
 case 'positionUpdate':void updatePosition(id);break;
 case 'positionDelete':void deletePosition(id);break;
 case 'staffNew':if(serverMode()){openNewStaff();break;}openModal(`<h2>관리사 추가</h2>${mfield('이름','staffNewName')}${modalFooter('staffSave')}`);break;
 case 'staffSave':{const n=formValue('staffNewName');if(!n||state.staffNames.includes(n))return toast('중복되지 않는 관리사 이름을 입력하세요.');state.staffNames.push(n);STAFf.push(n);save();closeModal();render();break;}
 case 'roomNew':openModal(`<h2>관리실/베드 추가</h2>${mfield('명칭','roomNewName')}${modalFooter('roomSave')}`);break;
 case 'roomSave':{const n=formValue('roomNewName');if(!n||state.rooms.includes(n))return toast('중복되지 않는 관리실 이름을 입력하세요.');state.rooms.push(n);save();closeModal();render();break;}
 case 'photoNew':showPhoto(id);break;
 case 'photoSave':photoFileChanged($('#phFile')?.files?.[0]);break;
 case 'photoPreview':{const p=state.photos.find(x=>x.id===id);if(p)openModal(`<h2>${p.kind} · ${p.date}</h2><img style="width:100%;max-height:70vh;object-fit:contain" src="${esc(p.dataUrl)}" alt="고객 사진">`);break;}
 case 'photoCompare':comparePhotos(id);break;
 case 'recordStart':recordStart();break;
 case 'recordStop':recordStop();break;
 case 'audioUpload':if(!consentCheck(activeConsultCid,'recordingConsent'))break;$('#audioFile')?.click();break;
 case 'membershipNew':showMember(id);break;
 case 'membershipSave':saveMember();break;
 case 'marketCRM':marketingTab='crm';setView('marketing');break;
 case 'marketOps':operationTab=id;setView('operations');break;
 case 'waitNew':showWaitNew();break;
 case 'waitCancel':{const t=state.waitlist.find(x=>x.id===id);if(t){t.status='CANCELLED';save();render()}break}
 case 'waitAssign':{const t=state.waitlist.find(x=>x.id===id);if(!t)return;t.status='PENDING';save();newReservation({cid:t.cid,date:t.date,time:t.time||'10:00',staff:t.staff||STAFf[0]});window._waitAssignId=t.id;break}
 case 'waitSave':saveWait();break;
 case 'intakeEdit':showIntake(id);break;
 case 'intakeSave':saveIntake(id);break;
 case 'stockAdjust':showStock(id);break;
 case 'stockSave':saveStock(id);break;
 case 'productAdd':showProduct();break;
 case 'productSave':saveProduct();break;
 case 'offAdd':showOff(id);break;
 case 'offSave':saveOff();break;
 case 'offDelete':state.staffShifts=state.staffShifts.filter(x=>x.id!==id);save();render();break;
 case 'addTask':showTask();break;
 case 'taskSave':saveTask();break;
 case 'taskDone':{const x=state.shopTasks.find(x=>x.id===id);if(x){x.done=true;save();render()}break}
 case 'messageNew':showMessage();break;
 case 'messageSave':saveMessage();break;
 case 'snapshotAdd':showSnapshot();break;
 case 'snapshotSave':saveSnapshot();break;
 case 'snapshotDelete':state.snapshots=state.snapshots.filter(x=>x.id!==id);save();render();break;
 case 'campaignNew':showCampaign(id);break;
 case 'campaignSave':saveCampaign(id);break;
 case 'campaignView':showCampaignDetail(id);break;
 case 'campaignSimulate':simulateCampaign(id);break;
 case 'campaignOutcome':showCampaignOutcome(id);break;
 case 'campaignOutcomeSave':saveCampaignOutcome(id);break;
 case 'paymentNew':showPayment();break;
 case 'paymentSave':savePayment();break;
 case 'paymentVoid':voidPayment(id);break;
 case 'configEdit':showConfig();break;
 case 'configSave':saveConfig();break;
 case 'serviceAdd':showService();break;
 case 'serviceEdit':showService(id);break;
 case 'serviceSave':saveService(id);break;
 case 'backupExport':backupExport();break;
 case 'backupImport':document.getElementById('backupFile')?.click();break;
 }
}
function mfield(label,id,value='',type='text'){return `<div class="field"><label for="${id}">${label}</label><input id="${id}" class="input" type="${type}" value="${esc(value)}"></div>`}
function mselect(label,id,list,selected){return `<div class="field"><label for="${id}">${label}</label><select id="${id}" class="select">${options(list,selected)}</select></div>`}
function modalFooter(action,id,text='저장'){return `<div class="actions"><button class="btn" data-act="closeModal">취소</button>${xbutton(text,action,id,'primary')}</div>`}
function formValue(id){return ($('#'+id)?.value||'').trim()}
function showWaitNew(){openModal(`<h2>대기예약 등록</h2>${mselect('고객','wCid',state.customers.map(x=>x.id),'C001')}${mfield('희망 날짜','wDate',TODAY(),'date')}${mfield('희망 시간','wTime','10:00','time')}${mfield('희망 관리','wService','수분 집중관리')}${mselect('관리사','wStaff',STAFf,STAFf[0])}${mfield('메모','wMemo')}${modalFooter('waitSave')}`)}
function saveWait(){if(!formValue('wDate'))return toast('날짜를 입력하세요.');state.waitlist.push({id:eid('W'),cid:formValue('wCid'),date:formValue('wDate'),time:formValue('wTime'),service:formValue('wService'),staff:formValue('wStaff'),memo:formValue('wMemo'),status:'WAITING'});save();closeModal();render();toast('대기예약이 등록되었습니다.')}
function showIntake(cid){const c=customer(cid);openModal(`<h2>${esc(c.name)} 사전 상담·동의</h2>${mfield('피부 및 상담 요청','iNote',c.intake||'')}${mfield('알레르기/주의사항 (쉼표 구분)','iAllergy',(c.allergies||[]).join(', '))}<label class="field"><input type="checkbox" id="iRecord" ${c.recordingConsent?'checked':''}> 상담 녹음·분석 동의</label><label class="field"><input type="checkbox" id="iPhoto" ${c.photoConsent?'checked':''}> 피부사진 저장 동의</label><label class="field"><input type="checkbox" id="iMarket" ${c.marketingConsent?'checked':''}> 광고성 정보 수신 동의</label><p class="fineprint">시연 체크박스이며, 실제 서비스에서는 동의일시/문서버전/철회 이력과 고지가 필수입니다.</p>${modalFooter('intakeSave',cid)}`)}
function saveIntake(cid){const c=customer(cid);c.intake=formValue('iNote');c.allergies=formValue('iAllergy').split(',').map(s=>s.trim()).filter(Boolean);c.recordingConsent=$('#iRecord').checked;c.photoConsent=$('#iPhoto').checked;c.marketingConsent=$('#iMarket').checked;state.intakeForms.push({id:eid('IN'),cid,date:TODAY(),text:c.intake,allergies:c.allergies});state.consents.push({id:eid('CN'),cid,date:new Date().toISOString(),recording:c.recordingConsent,photos:c.photoConsent,marketing:c.marketingConsent,source:'MANUAL_DEMO'});save();closeModal();render();toast('상담표·동의 이력을 저장했습니다.')}
function showStock(id){const p=state.inventory.find(x=>x.id===id);openModal(`<h2>${esc(p.name)} 입출고</h2><p>현재 ${p.stock}${esc(p.unit)}</p>${mfield('변경량 (출고는 음수)','stockDelta','1','number')}${mfield('사유','stockNote','입고')}${modalFooter('stockSave',id)}`)}
function saveStock(id){const p=state.inventory.find(x=>x.id===id),delta=Number(formValue('stockDelta'));if(!Number.isFinite(delta)||!Number.isInteger(delta)||p.stock+delta<0)return toast('수량을 확인하세요.');p.stock+=delta;state.audits.push({action:'STOCK_CHANGE',product:id,delta,note:formValue('stockNote'),date:TODAY()});save();closeModal();render()}
function showProduct(){openModal(`<h2>제품 추가</h2>${mfield('제품 이름','productName')}${mfield('초기 재고','productStock','0','number')}${mfield('최소 재고','productMin','5','number')}${mfield('단가','productCost','0','number')}${modalFooter('productSave')}`)}
function saveProduct(){const name=formValue('productName'),stock=Number(formValue('productStock')),min=Number(formValue('productMin')),cost=Number(formValue('productCost'));if(!name||[stock,min,cost].some(x=>!Number.isFinite(x)||x<0))return toast('제품 정보를 확인하세요.');state.inventory.push({id:eid('P'),name,stock,min,cost,unit:'개'});save();closeModal();render()}
function showOff(staff){openModal(`<h2>${esc(staff)} 휴무 등록</h2>${mfield('휴무일','offDate',TODAY(),'date')}${mfield('사유','offReason','개인 휴무')}${modalFooter('offSave')}<input id="offStaff" value="${esc(staff)}" type="hidden">`)}
function saveOff(){const staff=formValue('offStaff'),date=formValue('offDate');if(state.reservations.some(r=>r.staff===staff&&r.date===date&&ACTIVE(r)))return toast('휴무일에 이미 예약이 있습니다. 먼저 예약을 이동해 주세요.');state.staffShifts.push({id:eid('SF'),staff,date,reason:formValue('offReason'),type:'OFF'});save();closeModal();render()}
function showTask(){openModal(`<h2>운영 할 일</h2>${mfield('할 일','taskTitle')}${mfield('기한','taskDate',TODAY(),'date')}${mselect('분류','taskCategory',['위생','재고','고객 응대','재방문','기타'],'기타')}${modalFooter('taskSave')}`)}
function saveTask(){if(!formValue('taskTitle'))return toast('할 일을 입력하세요.');state.shopTasks.push({id:eid('TS'),title:formValue('taskTitle'),due:formValue('taskDate'),category:formValue('taskCategory'),done:false});save();closeModal();render()}
function showMessage(){const r=state.reservations.find(x=>ACTIVE(x))||state.reservations[0];openModal(`<h2>예약톡 초안</h2>${mselect('예약','msgR',state.reservations.filter(x=>!x.archived).map(x=>x.id),r?.id)}${mselect('유형','msgType',['CONFIRM','REMIND','REBOOK','POST_VISIT'],'CONFIRM')}<p class="fineprint">고객 및 예약 정보를 이용해 초안을 만듭니다. 실제 발송하지 않습니다.</p>${modalFooter('messageSave')}`)}
function saveMessage(){const r=state.reservations.find(x=>x.id===formValue('msgR'));if(!r)return;const kind=formValue('msgType');state.messageQueue.push({id:eid('MSG'),cid:r.cid,reservationId:r.id,kind,content:messageText(r,kind),status:'DRAFT',created:TODAY()});save();closeModal();render();toast('메시지 초안을 만들었습니다.')}
function showSnapshot(){openModal(`<h2>검색 노출 관측값 기록</h2>${mselect('채널','sChannel',['NAVER','KAKAO','GOOGLE','BLOG','REVIEW'],'NAVER')}${mfield('검색 키워드','sKeyword','평촌 피부관리')}<label class="field"><input type="checkbox" id="sDetected"> 검색 결과에서 발견됨</label>${mselect('노출 구간','sBand',['미확인','상단','중간','하단','미노출'],'미확인')}${mfield('관측 메모/출처','sMemo')}${modalFooter('snapshotSave')}`)}
function saveSnapshot(){if(!formValue('sKeyword'))return toast('키워드를 입력하세요.');state.snapshots.push({id:eid('SN'),checkedAt:new Date().toISOString().slice(0,16).replace('T',' '),channel:formValue('sChannel'),keyword:formValue('sKeyword'),detected:$('#sDetected').checked,band:formValue('sBand'),memo:formValue('sMemo'),source:'MANUAL'});save();closeModal();render()}
function showCampaign(segment='all'){openModal(`<h2>CRM 캠페인 초안</h2>${mfield('캠페인 이름','campName','재방문 안내 '+TODAY())}${mselect('대상 그룹','campSegment',['all','dormant','membership','noNext','new'],segment||'all')}<div class="field"><label>메시지 초안 (직원 검토 후 발송)</label><textarea id="campText" rows="5" class="textarea">안녕하세요. 최근 관리 이후 상태는 어떠셨나요? 편하실 때 예약 문의주세요.</textarea></div><p class="fineprint">실제 발송은 실행되지 않으며, 수신동의 고객만 발송 대상에 포함될 수 있습니다.</p>${modalFooter('campaignSave')}`)}
function saveCampaign(){const name=formValue('campName'),segment=formValue('campSegment');if(!name)return toast('이름을 입력하세요.');const targets=customerSegment(segment).map(x=>x.id);state.campaigns.push({id:eid('CA'),name,segment,targets,text:formValue('campText'),status:'DRAFT',revenue:0,sendCount:0,created:TODAY()});save();closeModal();render();toast('캠페인 초안을 저장했습니다.')}
function showCampaignDetail(id){const c=state.campaigns.find(x=>x.id===id);if(!c)return;const eligible=c.targets.filter(t=>customer(t)?.marketingConsent);openModal(`<h2>${esc(c.name)}</h2><p class="subtle">대상 ${c.targets.length}명 · 마케팅 수신동의 ${eligible.length}명 · ${esc(c.status)}</p><div class="msgbox">${esc(c.text)}</div><div class="detail-row"><b>캠페인 매출 기록</b><span>${won(c.revenue)}</span></div><div class="detail-row"><b>시연 발송 건</b><span>${c.sendCount}</span></div><p class="fineprint">시연 발송 시 외부 메시지가 전송되지는 않습니다. 실제 캠페인은 도달/예약/매출 이벤트 연동 후 정확한 성과를 산출해야 합니다.</p><div class="actions">${xbutton('발송 시뮬레이션','campaignSimulate',id)}${xbutton('성과 수동 기록','campaignOutcome',id)}<button class="btn" data-act="closeModal">닫기</button></div>`)}
function simulateCampaign(id){const c=state.campaigns.find(x=>x.id===id);if(!c)return;const allowed=c.targets.filter(t=>customer(t)?.marketingConsent);if(!allowed.length)return toast('광고 수신동의한 대상자가 없습니다.');if(!confirm(`수신동의 고객 ${allowed.length}명에 대한 모의 발송 기록만 남길까요? 실제 발송하지 않습니다.`))return;c.sendCount=allowed.length;c.status='SIMULATED';state.audits.push({action:'CAMPAIGN_SIMULATED',id,count:allowed.length,date:TODAY()});save();closeModal();render();toast('발송 시뮬레이션 완료. 외부 메시지는 전송하지 않았습니다.')}
function showCampaignOutcome(id){const c=state.campaigns.find(x=>x.id===id);if(!c)return;openModal(`<h2>캠페인 성과 수동 입력</h2><p>${esc(c.name)}</p>${mfield('직접 확인한 발생 매출 (원)','cRevenue',c.revenue||0,'number')}${mfield('직접 확인한 예약 건수','cBookings',c.bookings||0,'number')}${modalFooter('campaignOutcomeSave',id)}`)}
function saveCampaignOutcome(id){const c=state.campaigns.find(x=>x.id===id),v=Number(formValue('cRevenue')),b=Number(formValue('cBookings'));if([v,b].some(x=>!Number.isFinite(x)||x<0))return toast('숫자를 확인하세요.');c.revenue=v;c.bookings=b;c.attribution='MANUAL_UNVERIFIED';save();closeModal();render()}
function showPayment(){openModal(`<h2>결제 수동 등록</h2>${mselect('고객','payCid',state.customers.map(x=>x.id),'C001')}${mfield('금액','payAmount','0','number')}${mselect('결제수단','payMethod',['CARD','CASH','TRANSFER'],'CARD')}${mfield('내용','payMemo','제품/회원권/서비스')}${modalFooter('paymentSave')}`)}
function savePayment(){const amount=Number(formValue('payAmount'));if(!Number.isFinite(amount)||amount<=0)return toast('결제금액을 확인하세요.');state.payments.push({id:eid('PY'),cid:formValue('payCid'),amount,type:formValue('payMethod'),memo:formValue('payMemo'),date:TODAY(),voided:false});save();closeModal();render()}
function voidPayment(id){const p=state.payments.find(x=>x.id===id);if(!p||!confirm('결제 취소 처리할까요? 이력은 유지됩니다.'))return;p.voided=true;p.voidedAt=new Date().toISOString();state.audits.push({action:'PAYMENT_VOID',id,date:TODAY()});save();render()}
function showConfig(){openModal(`<h2>매장 운영 정책</h2>${mfield('매장 이름','cfgName',state.shopConfig.name)}${mfield('무료 주차 시간 (분)','cfgPark',state.shopConfig.parkingMinutes,'number')}${mfield('예약 취소 안내 (시간 전)','cfgCancel',state.shopConfig.cancelHours,'number')}${modalFooter('configSave')}`)}
async function saveConfig(){const park=Number(formValue('cfgPark')),cancel=Number(formValue('cfgCancel'));
 const name=formValue('cfgName');if(!name||park<0||cancel<0)return toast('값을 확인하세요.');
 try{
   if(serverMode()&&remote.shopName!==name){if(remote.role!=='owner')return toast('매장 이름은 최고관리자만 변경할 수 있어.');await remote.renameShop(name)}
   Object.assign(state.shopConfig,{name,parkingMinutes:park,cancelHours:cancel});save();closeModal();
   if(serverMode()){const brand=document.querySelector('.brand b');if(brand)brand.textContent=name;const crumb=document.querySelector('.topbar .crumb');if(crumb)crumb.firstChild.textContent=name+' '}
   render();
 }catch(e){toast('매장 설정 변경 실패: '+e.message)}
}
function showService(id){const s=state.services.find(x=>x.id===id);openModal(`<h2>${s?'프로그램 수정':'프로그램 추가'}</h2>${mfield('프로그램명','svName',s?.name||'')}${mfield('소요시간 (분)','svMinutes',s?.minutes||60,'number')}${mfield('판매 가격','svPrice',s?.price||0,'number')}${modalFooter('serviceSave',id)}`)}
function saveService(id){const name=formValue('svName'),minutes=Number(formValue('svMinutes')),price=Number(formValue('svPrice'));if(!name||minutes<=0||!Number.isFinite(price)||price<0)return toast('내용을 확인하세요.');const s=state.services.find(x=>x.id===id);if(s)Object.assign(s,{name,minutes,price});else state.services.push({id:eid('S'),name,minutes,price});save();closeModal();render()}
function backupExport(){const data=JSON.stringify({format:'ongeol-prototype',version:6,exportedAt:new Date().toISOString(),state},null,2);const blob=new Blob([data],{type:'application/json'});const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=`ongeol-backup-${TODAY()}.json`;a.click();URL.revokeObjectURL(url)}
async function backupImport(file){try{if(file.size>10*1024*1024)throw Error('백업 파일이 너무 큽니다.');const obj=JSON.parse(await file.text());if(obj.format!=='ongeol-prototype'||!Array.isArray(obj.state?.customers)||!Array.isArray(obj.state?.reservations))throw Error('지원하지 않는 백업 형식입니다.');if(!confirm(`고객 ${obj.state.customers.length}명, 예약 ${obj.state.reservations.length}건으로 현재 데이터를 교체합니다. 계속할까요?`))return;state=obj.state;ensureDemoState();ensureExtendedState();save();render();toast('백업을 복구했습니다.');}catch(e){toast(e.message||'파일을 확인하세요.')}}

document.addEventListener('click',e=>{if(handleExtraClick(e))return;
 if(e.target.closest('[data-customer-back]')){customerMobileDetail=false;render();return}
 const openCard=e.target.closest('[data-ai-open-customer]');if(openCard){selectedCustomer=openCard.dataset.aiOpenCustomer;customerTab='overview';customerMobileDetail=true;setView('customers');return}
 const select=e.target.closest('[data-ai-select]');if(select&&analysisResult){syncAnalysisFields();analysisResult.updates.forEach(u=>u.selected=select.dataset.aiSelect==='all');render();return}
 const done=e.target.closest('[data-complete-followup]');if(done){const f=state.followups.find(x=>x.id===done.dataset.completeFollowup);if(f){f.status='DONE';state.audits.push({action:'FOLLOWUP_DONE',cid:f.cid,followup:f.id,date:TODAY()});save();render();toast('후속 업무 완료');}return}
 const mode=e.target.closest('[data-schedule-view]');if(mode){scheduleMode=mode.dataset.scheduleView;if(scheduleMode==='week'&&staffFilter!=='ALL')weekStaff=staffFilter;render();return}
 const zm=e.target.closest('[data-zoom]');if(zm){const opts=ZOOM_LEVELS,idx=opts.indexOf(scheduleZoom);scheduleZoom=zm.dataset.zoom==='fit'?.16:opts[Math.max(0,Math.min(opts.length-1,idx+(zm.dataset.zoom==='up'?1:-1)))];render();return}
 const day=e.target.closest('[data-day]');if(day){scheduleDate=dateAdd(scheduleDate,Number(day.dataset.day)*(scheduleMode==='week'?7:1));render();return}
 const cell=e.target.closest('[data-new-at]');if(cell){newReservation({date:cell.dataset.newDate||scheduleDate,time:cell.dataset.newAt,staff:cell.dataset.newStaff});return}
 const detail=e.target.closest('[data-res-open]');if(detail){openReservationDetail(detail.dataset.resOpen);return}
 const ra=e.target.closest('[data-res-action]');if(ra){reservationAction(ra.dataset.resAction,ra.dataset.resId);return}
 const booking=e.target.closest('[data-booking]');if(booking){if(Date.now()<suppressBookingClickUntil)return;openReservationDetail(booking.dataset.booking);return}
 const n=e.target.closest('[data-nav]');if(n){setView(n.dataset.nav);return}
 const c=e.target.closest('[data-customer]');if(c){closeModal();selectedCustomer=c.dataset.customer;customerTab='overview';customerMobileDetail=true;setView('customers');return}
 const t=e.target.closest('[data-custtab]');if(t){customerTab=t.dataset.custtab;render();return}
 const f=e.target.closest('[data-finish]');if(f){finishReservation(f.dataset.finish);return}
 const park=e.target.closest('[data-park]');if(park){const r=state.reservations.find(x=>x.id===park.dataset.park);r.parking=true;save();render();toast('주차 처리 완료 (시연)');return}
 const a=e.target.closest('[data-act]');if(a){act(a.dataset.act);return}if(e.target.id==='modalback')closeModal()
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#modalRoot')?.innerHTML)closeModal();if((e.key==='Enter'||e.key===' ')&&e.target?.matches('[data-booking]')){e.preventDefault();openReservationDetail(e.target.dataset.booking)}});
document.addEventListener('input',e=>{if(e.target.id==='customerSearch'){$('#customerRows').innerHTML=renderCustomerList(e.target.value)}if(e.target.id==='scheduleZoom'){const opts=ZOOM_LEVELS;scheduleZoom=opts[+e.target.value]??.3;render()}});
document.addEventListener('change',e=>{if(e.target.id==='audioFile'&&e.target.files?.[0]){handleAudio(e.target.files[0],e.target.files[0].name);return;}if(e.target.id==='backupFile'&&e.target.files?.[0]){backupImport(e.target.files[0]);return;}if(e.target.id==='scheduleDateInput'){scheduleDate=e.target.value||TODAY();render();return}if(e.target.id==='scheduleStaff'){staffFilter=e.target.value;render();return}if(e.target.id==='scheduleWeekStaff'){weekStaff=e.target.value;render();return}if(e.target.id==='scheduleStatus'){statusFilter=e.target.value;render();return}if(e.target.id==='consultCustomer'){activeConsultCid=e.target.value;analysisResult=null;render();return}if(e.target.id==='sampleCase'){aiCase=e.target.value;analysisResult=null;render();return}if(e.target.hasAttribute('data-proposal')&&analysisResult){syncAnalysisFields();analysisResult.updates[Number(e.target.dataset.proposal)].selected=e.target.checked;const count=analysisResult.updates.filter(x=>x.selected).length;const btn=document.querySelector('[data-act="applyProposals"]');if(btn)btn.textContent=`선택한 ${count}건 승인·확정`;}});
// The pointer interaction is intentionally restricted to appointment cards. Drag to a lane, resize using the ↕ lower edge.
document.addEventListener('pointerdown',e=>{if(serverMode()&&remote.role==='therapist')return;const card=e.target.closest('[data-booking]');if(!card||e.button!==0)return;const r=state.reservations.find(x=>x.id===card.dataset.booking);if(!r||r.archived||r.status==='COMPLETED')return;const resize=!!e.target.closest('[data-resize]');const rect=card.getBoundingClientRect();pointerBooking={id:r.id,card,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,offsetY:e.clientY-rect.top,resize,dragged:false,suppressClick:false,originalHeight:rect.height};card.setPointerCapture(e.pointerId);});
document.addEventListener('pointermove',e=>{const p=pointerBooking;if(!p||p.pointerId!==e.pointerId||!p.card.isConnected)return;const dx=e.clientX-p.startX,dy=e.clientY-p.startY;if(!p.dragged&&Math.hypot(dx,dy)<6)return;p.dragged=true;p.suppressClick=true;p.card.classList.add('being-dragged');if(p.resize)p.card.style.height=Math.max(5,p.originalHeight+dy)+'px';else p.card.style.transform=`translate(${dx}px,${dy}px)`;});
document.addEventListener('pointerup',e=>{const p=pointerBooking;if(!p||p.pointerId!==e.pointerId)return;const r=state.reservations.find(x=>x.id===p.id);if(p.card.isConnected){p.card.classList.remove('being-dragged');p.card.style.transform='';p.card.style.height='';}if(!p.dragged||!r){pointerBooking=null;return}e.preventDefault();suppressBookingClickUntil=Date.now()+450;let proposal={};if(p.resize){proposal.minutes=Math.max(30,snap15(r.minutes+(e.clientY-p.startY)/scheduleZoom));}else{const card=p.card;card.style.pointerEvents='none';const hit=document.elementFromPoint(e.clientX,e.clientY);card.style.pointerEvents='';const lane=hit?.closest('[data-lane-date]');if(!lane){toast('시간표 영역에 놓아주세요.');pointerBooking=null;return}const rect=lane.getBoundingClientRect();proposal={date:lane.dataset.laneDate,staff:lane.dataset.laneStaff,room:lane.dataset.laneStaff===r.staff?r.room:(state.rooms[0]||'관리실 A'),time:toHHMM(Math.max(SLOT_START,Math.min(SLOT_END-r.minutes,snap15(SLOT_START+(e.clientY-rect.top-p.offsetY)/scheduleZoom))))}}pointerBooking=null;scheduleDropProposal(r.id,proposal,p.resize?'resize':'move');});
document.addEventListener('pointercancel',()=>{if(pointerBooking?.card?.isConnected){pointerBooking.card.style.transform='';pointerBooking.card.style.height='';pointerBooking.card.classList.remove('being-dragged')}pointerBooking=null});

async function enterRemote(){
  const shell=document.createElement('div');shell.className='auth-backdrop';shell.id='loginShell';document.body.appendChild(shell);
  const displayMessage = (msg,bad=false)=>{const el=shell.querySelector('#authMessage');if(el){el.style.color=bad?'#af4242':'#257259';el.textContent=msg}};
  function authForm(mode='login'){
    shell.innerHTML=`<div class="auth-card wide-auth"><h2>✳ 온결</h2><p>Aesthetic Manager · 피부관리샵 운영 계정</p>
      <form id="authForm" class="auth-section">
        <label>이메일</label><input id="authEmail" class="input" type="email" required autocomplete="username" placeholder="manager@example.com">
        <label>비밀번호</label><input id="authPassword" class="input" type="password" required minlength="6" autocomplete="${mode==='signup'?'new-password':'current-password'}">
        <button class="btn primary" type="submit">${mode==='signup'?'회원가입':'로그인'}</button>
        <button class="btn small" id="toggleAuth" type="button">${mode==='signup'?'이미 계정 있음 · 로그인':'이메일로 계정 만들기'}</button>
      </form>
      <p id="authMessage" aria-live="polite"></p>
      <p class="fineprint">처음 매장을 만들면 이 계정은 최고관리자가 돼. 실제 직원은 자동 등록되지 않으며 설정에서 따로 추가해.</p></div>`;
    shell.querySelector('#toggleAuth').onclick=()=>authForm(mode==='signup'?'login':'signup');
    shell.querySelector('#authForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;
      try{const email=shell.querySelector('#authEmail').value.trim(),pass=shell.querySelector('#authPassword').value;
        if(mode==='signup'){
          const r=await remote.signup(email,pass);
          if(!r?.access_token){displayMessage('가입 요청 완료. 이메일 인증 링크를 확인한 뒤 로그인해 줘.');return;}
        }else await remote.login(email,pass);
        await afterAuth();
      }catch(ex){displayMessage('인증 오류: '+ex.message,true)}finally{if(b.isConnected)b.disabled=false}
    });
  }
  function onboarding(){shell.innerHTML=`<div class="auth-card wide-auth"><h2>새 매장 만들기</h2>
    <p>가입한 로그인 계정은 새 매장의 <b>최고관리자</b>가 돼. <b>직원은 0명</b> 상태로 시작해.</p>
    <form class="auth-section" id="createShopForm">
      <label>매장 브랜드 이름 *</label><input required maxlength="100" class="input" id="shopNameInput" placeholder="예: 라온 에스테틱">
      <p class="fineprint">매장 생성 후 설정 → 직원·계정에서 직책과 직원을 각각 등록할 수 있어.</p>
      <button class="btn primary" type="submit">매장 개설 · 관리자 계정으로 시작</button>
    </form>
    <div class="sectionline"><h3>직원으로 기존 매장 참여</h3>
      <label>관리자에게 받은 초대코드</label><input class="input" id="shopInviteCode" placeholder="초대코드 붙여넣기">
      <button class="btn" id="joinShopButton">초대코드로 계정 연결</button></div>
    <p id="authMessage" aria-live="polite"></p><button type="button" class="btn" id="onboardLogout">다른 계정으로 로그인</button></div>`;
    shell.querySelector('#createShopForm').onsubmit=async(e)=>{e.preventDefault();const b=e.submitter;b.disabled=true;
      try{await remote.createShop(shell.querySelector('#shopNameInput').value.trim());await loadShop();}
      catch(ex){displayMessage('매장 개설 실패: '+ex.message,true)}finally{if(b.isConnected)b.disabled=false}
    };
    shell.querySelector('#joinShopButton').onclick=async e=>{e.currentTarget.disabled=true;
      try{await remote.joinShop(shell.querySelector('#shopInviteCode').value.trim());await loadShop()}
      catch(ex){displayMessage('초대 참여 실패: '+ex.message,true)}finally{if(e.currentTarget.isConnected)e.currentTarget.disabled=false}
    };
    shell.querySelector('#onboardLogout').onclick=async()=>{await remote.logout();authForm('login')};
  }
  async function afterAuth(){const m=await remote.membership();if(m)await loadShop();else onboarding()}
  async function loadShop(){let serverState=await remote.read();if(!serverState||typeof serverState!=='object'||!Array.isArray(serverState.customers))throw Error('서버 데이터 형식 오류');
    state=serverState;ensureDemoState();ensureExtendedState();scheduleDate=TODAY();weekStaff=state.staffNames[0]||'미지정';
    selectedCustomer=state.customers[0]?.id||'';activeConsultCid=selectedCustomer;view='today';shell.remove();
    document.querySelector('.brand small').textContent='온결 · AESTHETIC MANAGER';
    document.querySelector('.brand b').textContent=remote.shopName;
    document.querySelector('.sidebottom').innerHTML='Supabase 서버 저장 · v0.9<br>실제 고객정보 사용 전 개인정보·운영 보안 점검이 필요합니다.';
    document.querySelector('.topactions .pill').textContent='● 서버 연결';
    const crumb=document.querySelector('.topbar .crumb');if(crumb)crumb.firstChild.textContent=remote.shopName+' ';
    const avatar=document.querySelector('.topactions .avatar');if(avatar){avatar.title=remote.user?.email||remote.user?.phone||'로그인 계정';avatar.textContent=remote.role==='owner'?'관':remote.role==='manager'?'매':'직'}
    const inviteBtn=document.getElementById('inviteStaff');if(inviteBtn)inviteBtn.remove();
    // Staff invitation is available in Settings → 직원·계정 관리.
    render();
  }
  if(!configurationReady()){shell.innerHTML=`<div class="auth-card"><h2>Supabase 설정 필요</h2><p>배포 파일 <code>config.js</code> 안에 Supabase Project URL과 Publishable Key를 입력하고 다시 배포해 줘.</p><p>ZIP의 <b>SETUP_KO.md</b>에서 전체 설치 순서를 확인할 수 있어.</p></div>`;return;}
  if(await remote.restore())try{await afterAuth();}catch(e){shell.innerHTML=`<div class="auth-card"><h2>서버 연결 실패</h2><p>${esc(e.message)}</p><button class="btn" id="retryCloud">다시 시도</button><button class="btn" id="reloginCloud">로그인 새로하기</button></div>`;
    shell.querySelector('#retryCloud').onclick=()=>location.reload();shell.querySelector('#reloginCloud').onclick=async()=>{await remote.logout();authForm('login')}}
  else authForm('login');
  document.getElementById('remoteLogout')?.addEventListener('click',async()=>{if(remote.dirty&&!confirm('아직 서버에 저장되지 않은 데이터가 있을 수 있어. 로그아웃할까요?'))return;await remote.logout();location.reload()});
  document.getElementById('remoteRefresh')?.addEventListener('click',()=>{if(remote.dirty||remote.running){toast('서버 저장 완료 후 새로고침해 주세요.');return}location.reload()});
  window.addEventListener('beforeunload',e=>{if(remote.dirty){e.preventDefault();e.returnValue='저장 중인 내용이 있습니다.'}});
}
// Until entity-level RBAC is ready, therapist logins are strictly read-only, not fake write access.
document.addEventListener('click',e=>{
 if(!serverMode()||remote.role!=='therapist')return;
 const el=e.target.closest('[data-extra],[data-act],[data-res-action],[data-new-at]');
 if(!el)return;
 const safeActs=new Set(['closeModal','goReservations','goAI','goCustomerAI','scheduleToday','clearProposals']);
 const safeExtras=new Set(['contactPhoneEdit','contactPhoneSave','marketCRM','marketOps']);
 if(el.dataset.act&&safeActs.has(el.dataset.act))return;
 if(el.dataset.extra&&safeExtras.has(el.dataset.extra))return;
 e.preventDefault();e.stopImmediatePropagation();toast('일반 직원 계정은 현재 조회 전용이야. 업무별 권한 기능을 도입하면 편집을 활성화할 수 있어.');
},true);
if(serverMode())enterRemote();else render();

if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
