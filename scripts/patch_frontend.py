from pathlib import Path
p=Path('/mnt/data/ongeol_v0.7/web/app.js')
s=p.read_text()
s=s.replace("import { RemoteState, serverMode } from './sync.js';", "import { RemoteState, serverMode, configurationReady } from './sync.js';")
s=s.replace("const remote = new RemoteState((message)=>{alert(message)});", """const remote = new RemoteState((message)=>{
  let n=document.getElementById('cloudError');if(!n){n=document.createElement('div');n.className='cloud-banner';n.id='cloudError';document.body.appendChild(n)}
  n.textContent=message+' ';const btn=document.createElement('button');btn.textContent='서버에서 다시 불러오기';btn.onclick=()=>location.reload();n.appendChild(btn);
});""")
needle='function ensureDemoState(){\n'
assert needle in s
s=s.replace(needle,needle+""" if(serverMode()){
   state.consultations ||= [];state.followups ||= [];state.audits ||= [];
   state.treatments ||= [];state.membershipUsages ||= [];state.payments ||= [];state.messageDrafts ||= [];
   state.weekSeeded = true;state.reservations.forEach(r=>r.archived=!!r.archived);
   state.customers.forEach(c=>{c.events ||= [];c.history ||= [];c.concerns ||= [];c.precautions ||= [];c.tags ||= [];});
   return;
 }
""",1)
s=s.replace("case 'resetDemo':if(confirm(","case 'resetDemo':if(serverMode())break;if(confirm(")
s=s.replace("state.inventory ||= [{id:'P1'", "state.inventory ||= [{id:'P1'",1) # use targeted overrides
s=s.replace("  state.photos ||= [];state.waitlist ||= [];state.inventory ||= [{id:'P1',name:'수분 앰플',stock:14,min:5,unit:'개',cost:12000},{id:'P2',name:'진정 팩',stock:6,min:8,unit:'개',cost:4500}];", "  state.photos ||= [];state.waitlist ||= [];state.inventory ||= (serverMode()?[]:[{id:'P1',name:'수분 앰플',stock:14,min:5,unit:'개',cost:12000},{id:'P2',name:'진정 팩',stock:6,min:8,unit:'개',cost:4500}]);")
s=s.replace("  state.staffNames ||= ['김원장','이관리사'];STAFf.splice(0,STAFf.length,...state.staffNames);state.rooms ||= ['관리실 A','관리실 B'];", "  state.staffNames ||= (serverMode()?['원장']:['김원장','이관리사']);STAFf.splice(0,STAFf.length,...state.staffNames);state.rooms ||= (serverMode()?['관리실 A']:['관리실 A','관리실 B']);")
s=s.replace("  state.services ||= [{id:'S1',name:'수분 집중관리',minutes:90,price:120000},{id:'S2',name:'진정 집중관리',minutes:90,price:100000},{id:'S3',name:'탄력 집중관리',minutes:60,price:140000},{id:'S4',name:'신규 상담 + 피부관리',minutes:60,price:90000}];", "  state.services ||= (serverMode()?[]:[{id:'S1',name:'수분 집중관리',minutes:90,price:120000},{id:'S2',name:'진정 집중관리',minutes:90,price:100000},{id:'S3',name:'탄력 집중관리',minutes:60,price:140000},{id:'S4',name:'신규 상담 + 피부관리',minutes:60,price:90000}]);")
s=s.replace("  state.shopConfig ||= {name:'온결 에스테틱 (시연)',parkingMinutes:120,cancelHours:24,commissions:[{staff:'김원장',rate:0},{staff:'이관리사',rate:10}]};", "  state.shopConfig ||= (serverMode()?{name:remote.shopName||'내 매장',parkingMinutes:120,cancelHours:24,commissions:[]}:{name:'온결 에스테틱 (시연)',parkingMinutes:120,cancelHours:24,commissions:[{staff:'김원장',rate:0},{staff:'이관리사',rate:10}]});")
old="async function handleAudio(blob,filename){if(!consentCheck(activeConsultCid,'recordingConsent'))return;if(!serverMode()){"
new="async function handleAudio(blob,filename){if(!consentCheck(activeConsultCid,'recordingConsent'))return;if(serverMode()) { const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('STT 미연결: 녹음 파일을 기기에 내려받았습니다. 다음 단계에 전사 API를 연결합니다.');return; }if(!serverMode()){"
assert old in s;s=s.replace(old,new)
old="async function photoFileChanged(file){if(!file)return;const cid=window._photoCid,c=customer(cid);if(!consentCheck(cid,'photoConsent'))return;try{const dataUrl=await shrinkImage(file);state.photos.push({id:eid('PH'),cid,date:formValue('phDate')||TODAY(),kind:formValue('phKind'),area:formValue('phArea')||'얼굴',dataUrl});save();closeModal();customerTab='photo';render();toast('시연용 사진이 등록되었습니다.')}catch(e){toast('사진 처리 실패: '+e.message)}}"
new="""async function photoFileChanged(file){if(!file)return;const cid=window._photoCid;if(!consentCheck(cid,'photoConsent'))return;try{
 const dataUrl=await shrinkImage(file);
 const photo={id:eid('PH'),cid,date:formValue('phDate')||TODAY(),kind:formValue('phKind'),area:formValue('phArea')||'얼굴'};
 if(serverMode()){
   const blob=await fetch(dataUrl).then(r=>r.blob());photo.storagePath=await remote.uploadPhoto(cid,blob);
   photo.dataUrl=await remote.photoUrl(photo.storagePath);
 }else photo.dataUrl=dataUrl;
 state.photos.push(photo);save();closeModal();customerTab='photo';render();toast(serverMode()?'비공개 사진 저장소에 등록했습니다.':'시연용 사진이 등록되었습니다.');
 }catch(e){toast('사진 처리 실패: '+e.message)}}"""
assert old in s;s=s.replace(old,new)
s=s.replace("<p class=\"fineprint\">현재는 브라우저/시연 상태에 축소 이미지를 저장하는 구현입니다. 실서비스 사진은 Private Storage와 권한/삭제 정책 연결이 필요합니다. 실제 고객사진을 넣지 마세요.</p>","<p class=\"fineprint\">${serverMode()?'사진은 비공개 저장소에 보관하며, 로그인한 매장 계정만 임시 링크를 발급받습니다. 개인정보 보관·삭제 정책을 확인하세요.':'사진은 데모용 브라우저 저장 상태입니다. 실고객 사진을 넣지 마세요.'}</p>")
s=s.replace("<h2>피부 전후 사진 등록 (시연)</h2>","<h2>피부 전후 사진 등록</h2>")
s=s.replace("<p class=\"fineprint\">축소된 이미지가 시연 저장소에 들어갑니다. 실고객 사진은 사용하지 마세요.</p>","<p class=\"fineprint\">${serverMode()?'이미지를 압축한 후 비공개 스토리지에 업로드합니다. 고객에게 사진 수집 목적과 보관정책을 안내하세요.':'시연용 사진입니다. 실고객 사진은 사용하지 마세요.'}</p>")
start=s.index('async function enterRemote(){')
end=s.index('if(serverMode())enterRemote();else render();',start)
repl="""async function enterRemote(){
  const shell=document.createElement('div');shell.className='auth-backdrop';shell.id='loginShell';document.body.appendChild(shell);
  const displayMessage = (msg,bad=false)=>{const el=shell.querySelector('#authMessage');if(el){el.style.color=bad?'#af4242':'#257259';el.textContent=msg}};
  function authForm(mode='login'){
    shell.innerHTML=`<form id="authForm" class="auth-card"><h2>✳ 온결</h2><p>피부관리샵 운영 · Supabase 서버 연결</p>
    <div class="auth-section"><label>이메일</label><input id="authEmail" class="input" type="email" required autocomplete="username" placeholder="owner@example.com">
    <label>비밀번호</label><input id="authPassword" class="input" type="password" required minlength="6" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="비밀번호"></div>
    <p id="authMessage"></p><button class="btn primary" type="submit">${mode==='signup'?'새 계정 만들기':'로그인'}</button>
    <div class="auth-secondary"><button class="btn small" type="button" id="toggleAuth">${mode==='signup'?'로그인으로 돌아가기':'첫 사용 · 계정 만들기'}</button></div>
    <p class="fineprint">서버에 로그인한 후 내 매장을 개설하거나 직원 초대코드로 참여할 수 있습니다.</p></form>`;
    shell.querySelector('#toggleAuth').onclick=()=>authForm(mode==='signup'?'login':'signup');
    shell.querySelector('#authForm').onsubmit=async(e)=>{e.preventDefault();const b=shell.querySelector('[type=submit]');b.disabled=true;
      try{const email=shell.querySelector('#authEmail').value.trim(),pass=shell.querySelector('#authPassword').value;
        if(mode==='signup'){const r=await remote.signup(email,pass);
          if(!r?.access_token){displayMessage('계정 생성 요청을 완료했어. 이메일 인증 링크를 확인한 뒤 로그인해 줘.');return;}
        }else await remote.login(email,pass);
        await afterAuth();
      }catch(ex){displayMessage('인증 오류: '+ex.message,true)}finally{b.disabled=false}
    };
  }
  function onboarding(){shell.innerHTML=`<div class="auth-card"><h2>매장 시작하기</h2><p>로그인에 성공했어. 새 매장을 만들거나 기존 매장의 초대코드로 참여할 수 있어.</p>
    <form class="auth-section" id="createShopForm"><label>매장 이름</label><input required maxlength="100" class="input" id="shopNameInput" placeholder="예: 나의 피부관리샵"><button class="btn primary" type="submit">새 매장 만들기</button></form>
    <div style="border-top:1px solid #eee;padding-top:15px" class="auth-section"><label>다른 매장 직원 초대코드 (선택)</label><input class="input" id="shopInviteCode" placeholder="원장에게 받은 코드"><button class="btn" id="joinShopButton">초대코드로 참여</button></div>
    <p id="authMessage"></p><button type="button" class="btn" id="onboardLogout">다른 계정으로 로그인</button></div>`;
    shell.querySelector('#createShopForm').onsubmit=async(e)=>{e.preventDefault();const b=e.submitter;b.disabled=true;
      try{await remote.createShop(shell.querySelector('#shopNameInput').value.trim());await loadShop();}
      catch(ex){displayMessage('매장 생성 실패: '+ex.message,true)}finally{b.disabled=false}};
    shell.querySelector('#joinShopButton').onclick=async e=>{e.currentTarget.disabled=true;try{await remote.joinShop(shell.querySelector('#shopInviteCode').value.trim());await loadShop();}catch(ex){displayMessage('초대 참여 실패: '+ex.message,true)}finally{e.currentTarget.disabled=false}};
    shell.querySelector('#onboardLogout').onclick=async()=>{await remote.logout();authForm('login')};
  }
  async function afterAuth(){const m=await remote.membership();if(m)await loadShop();else onboarding()}
  async function loadShop(){let serverState=await remote.read();if(!serverState||typeof serverState!=='object'||!Array.isArray(serverState.customers))throw Error('서버 데이터 형식 오류');
    state=serverState;ensureDemoState();ensureExtendedState();scheduleDate=TODAY();weekStaff=state.staffNames[0]||'원장';
    selectedCustomer=state.customers[0]?.id||'';activeConsultCid=selectedCustomer;view='today';shell.remove();
    document.querySelector('.brand small').textContent='SKINCARE STUDIO · CLOUD';
    document.querySelector('.sidebottom').innerHTML='Supabase 서버 저장 · v0.7<br>실제 고객정보 사용 전 개인정보·운영 보안 점검이 필요합니다.';
    document.querySelector('.topactions .pill').textContent='● 서버 연결';
    const crumb=document.querySelector('.topbar .crumb');if(crumb)crumb.firstChild.textContent=remote.shopName+' ';
    const avatar=document.querySelector('.topactions .avatar');if(avatar)avatar.title=remote.user?.email||'로그인 계정';
    const inviteBtn=document.getElementById('inviteStaff');if(inviteBtn)inviteBtn.remove();
    if(remote.role==='owner'){
      const b=document.createElement('button');b.className='btn small';b.id='inviteStaff';b.textContent='직원 초대';
      b.onclick=async()=>{if(!confirm('현재 직원 역할별 고객 필드 접근 통제가 아직 분리되지 않았습니다. 신뢰할 수 있는 직원에게만 초대코드를 제공하세요.'))return;
        try{const code=await remote.invite('therapist');prompt('48시간 동안 1회 사용할 수 있는 직원 초대코드입니다. 복사하여 직원에게 직접 전달하세요.',code)}catch(ex){toast('초대코드 생성 실패: '+ex.message)}};
      document.querySelector('.topactions').prepend(b);
    }
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
"""
s=s[:start]+repl+s[end:]
s+= "\nif('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(()=>{});\n"
p.write_text(s)
