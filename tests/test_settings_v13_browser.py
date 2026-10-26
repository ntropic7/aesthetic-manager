"""Browser smoke test with a fake Supabase endpoint; does not test the real hosted service."""
import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).parents[1]
state={"customers":[],"reservations":[],"consultations":[],"followups":[],"audits":[],"photos":[],"waitlist":[],"inventory":[],"treatments":[],"membershipUsages":[],"payments":[],"messageDrafts":[],"staffShifts":[],"intakeForms":[],"consents":[],"campaigns":[],"snapshots":[],"messageQueue":[],"hygieneTasks":[],"shopTasks":[],"staffNames":[],"rooms":["공간 A"],"services":[],"weekSeeded":True,"shopConfig":{"name":"테스트 스튜디오","parkingMinutes":120,"cancelHours":24,"commissions":[]}}
backend={'member':False,'rev':0,'data':state}
SUID='bb0ac294-cccc-4f48-955a-908bd270cee2'; SHOP='e6ab12ff-ffff-4f48-a98a-ccbca2d55ab4'

errors=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  def setup(page):
   page.on('pageerror',lambda e:errors.append(str(e)))
   def config(route):route.fulfill(status=200,content_type='application/javascript',body="window.ONGEOL_CONFIG={apiMode:'supabase',supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_test_key',phoneAuthEnabled:false};")
   def local(route):
    from urllib.parse import urlparse
    path=urlparse(route.request.url).path.lstrip('/') or 'index.html'
    f=ROOT/'web'/path
    if not f.is_file():return route.fulfill(status=404,body='not found')
    mime=('text/javascript' if path.endswith('.js') else 'text/css' if path.endswith('.css') else 'text/html' if path.endswith('.html') else 'application/json')
    route.fulfill(status=200,content_type=mime,body=f.read_bytes())
   page.route('https://app.test/**',local)
   page.route('**/config.js',config)
   def cloud(route):
    req=route.request;u=req.url
    path=u.split('supabase.co',1)[-1]
    if '/auth/v1/token' in path or '/auth/v1/signup' in path:
     data={'access_token':'test-token','refresh_token':'test-refresh','expires_in':3600,'token_type':'bearer','user':{'id':SUID,'email':'test@example.com'}}
    elif '/auth/v1/user' in path:data={'id':SUID,'email':'test@example.com'}
    elif '/rest/v1/shop_members?' in path:data=([{'shop_id':SHOP,'role':'owner'}] if backend['member'] else [])
    elif '/rest/v1/rpc/ongeol_create_shop' in path:backend['member']=True;data=SHOP
    elif '/rest/v1/shops?' in path:data=[{'name':'테스트 스튜디오'}]
    elif '/rest/v1/shop_states?' in path:data=[{'revision':backend['rev'],'data':backend['data']}]
    elif '/rest/v1/rpc/ongeol_save_state' in path:
     payload=json.loads(req.post_data or '{}')
     if payload['p_expected_revision']!=backend['rev']:
      return route.fulfill(status=400,content_type='application/json',body=json.dumps({'message':'stale_revision'}))
     backend['data']=payload['p_data'];backend['rev']+=1;data=backend['rev']
    elif '/auth/v1/logout' in path:data={}
    else:
     errors.append('unexpected fetch '+path);data={}
    route.fulfill(status=200,content_type='application/json',body=json.dumps(data,ensure_ascii=False))
   page.route('https://demo.supabase.co/**',cloud)
  context=browser.new_context(viewport={'width':400,'height':820})
  page=context.new_page();page.set_default_timeout(4000);setup(page)
  html=(ROOT/'web'/'index.html').read_text().replace('<script src="./config.js"></script><script type="module" src="./app.js"></script>','')
  page.set_content(html.replace('<link rel="stylesheet" href="./style.css">','').replace('<link rel="manifest" href="./manifest.webmanifest">','').replace('<link rel="icon" type="image/svg+xml" href="./icon.svg">',''),wait_until='domcontentloaded')
  page.add_style_tag(content=(ROOT/'web'/'style.css').read_text())
  page.evaluate("window.ONGEOL_CONFIG={apiMode:'supabase',supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_test_key',phoneAuthEnabled:false};")
  domain=(ROOT/'web'/'domain.js').read_text().replace('export const ','const ').replace('export function ','function ')
  sync=(ROOT/'web'/'sync.js').read_text().replace('export const ','const ').replace('export function ','function ').replace('export class ','class ')
  app=(ROOT/'web'/'app.js').read_text().replace("import { bookingConflict } from './domain.js';",'').replace("import { RemoteState, serverMode, configurationReady } from './sync.js';",'')
  code='\n'.join(['(function(){',domain,'window.bookingConflict=bookingConflict;})();','(function(){',sync,'Object.assign(window,{RemoteState,serverMode,configurationReady});})();',app])
  page.evaluate((ROOT/'tests'/'mock_fetch.js').read_text())
  page.add_script_tag(content=code)
  assert page.get_by_text('온결 매니저',exact=False).count() >= 1
  page.locator('#authEmail').fill('test@example.com');page.locator('#authPassword').fill('somepassword')
  page.get_by_role('button',name='로그인',exact=True).click()
  page.locator('#accountTerms').check();page.locator('#accountNotice').check()
  page.locator('#accountDocumentSave').click()
  page.locator('#newShopMode').click()
  page.locator('#shopNameInput').fill('테스트 스튜디오')
  page.locator('#firstStaffName').fill('가상 첫 직원')
  page.locator('#firstStaffPosition').fill('실장')
  page.locator('#linkCreatorStaff').check()
  page.get_by_role('button',name='첫 직원과 함께 매장 개설').click()
  page.locator('#main').get_by_text('오늘 예약').wait_for()
  assert len(page.evaluate('window.__cloud.staff'))==1
  assert page.locator('.brand b').inner_text()=='테스트 스튜디오'
  assert '온결 매니저' in page.locator('.brand small').inner_text()
  # Register a service with the real UI.
  page.locator('[data-nav="settings"]').first.evaluate('(el)=>el.click()')
  page.get_by_role('heading',name='매장 정보').wait_for()
  page.screenshot(path=str(ROOT/'docs/settings_shop_mobile_v13.png'),full_page=True)
  assert page.get_by_text('공간·좌석',exact=False).count() >= 1
  page.locator('[data-settings-section="staff"]').first.click()
  assert page.locator('.settings-entity').count()>=1
  assert page.get_by_text('최고관리자 권한',exact=False).count()>=1
  assert page.locator('[data-extra="positionNew"]').count()==0
  assert page.get_by_text('직책 관리',exact=True).count()==0
  page.screenshot(path=str(ROOT/'docs/settings_staff_mobile_v13.png'),full_page=True)
  page.set_viewport_size({'width':1366,'height':820})
  page.screenshot(path=str(ROOT/'docs/settings_staff_desktop_v13.png'),full_page=True)
  page.locator('[data-settings-section="shop"]').first.click()
  page.screenshot(path=str(ROOT/'docs/settings_shop_desktop_v13.png'),full_page=True)
  page.locator('[data-settings-section="staff"]').first.click()
  page.set_viewport_size({'width':400,'height':820})
  page.locator('[data-extra="staffProfileEdit"]').first.click()
  assert page.locator('#modalRoot').get_by_text('로그인 권한: 최고관리자').count()==1
  assert page.locator('#editStaffRole').count()==0
  page.locator('#modalRoot [data-act="closeModal"]').first.click()
  page.locator('[data-extra="staffProfileNew"]').first.click()
  page.locator('#staffProfileName').fill('가상 둘째 직원')
  page.locator('#staffProfilePosition').fill('관리사')
  page.locator('[data-extra="staffProfileSave"]').click()
  page.wait_for_timeout(100)
  assert len(page.evaluate('window.__cloud.staff'))==2
  assert page.get_by_text('가상 둘째 직원 · 관리사',exact=False).count()>=1
  assert page.get_by_text('가상 첫 직원 · 실장',exact=False).count()>=1
  assert any(x.get('auth_user_id') == SUID for x in page.evaluate('window.__cloud.staff'))

  page.locator('[data-settings-section="services"]').first.click()
  page.locator('[data-extra="serviceAdd"]').first.click()
  page.locator('#svName').fill('테스트 서비스')
  page.locator('#svMinutes').fill('60')
  page.locator('#svPrice').fill('90000')
  page.locator('[data-extra="serviceSave"]').first.click()
  # Register one customer.
  page.locator('[data-settings-section="privacy"]').first.click()
  page.locator('#shopPrivacyAck').check()
  page.locator('[data-extra="privacyShopAccept"]').click()
  page.wait_for_timeout(100)
  page.locator('[data-nav="customers"]').first.evaluate('(el)=>el.click()')
  page.locator('[data-act="newCustomer"]').first.click()
  page.locator('#newName').fill('가상 시연고객')
  page.locator('#newPhone').fill('010-0000-0000')
  page.locator('#customerNoticeChecked').check()
  page.locator('[data-act="saveCustomer"]').click()
  page.wait_for_timeout(100)
  actual=page.evaluate('window.__cloud.data')
  assert len(actual['customers'])==1
  assert len(page.evaluate('window.__cloud.privacyEvidence'))>=1
  # Sensitive data, photo, recording, and marketing permissions need distinct evidence events.
  page.locator('[data-nav="operations"]').first.evaluate('(el)=>el.click()')
  page.locator('[data-extra-tab="operations"][data-key="intake"]').first.click()
  page.locator('[data-extra="intakeEdit"]').first.click()
  page.locator('#iAllergy').fill('가상 알레르기 정보')
  page.locator('#iSensitive').check()
  page.locator('#iPhoto').check()
  page.locator('#iRecord').check()
  page.locator('#iMarket').check()
  page.locator('#iEvidenceRef').fill('가상서명-문서-001')
  page.locator('[data-extra="intakeSave"]').first.click()
  page.wait_for_timeout(100)
  purposes=set(page.evaluate('window.__cloud.privacyEvidence.map(x=>x.p_purpose)'))
  assert {'customer_basic','customer_sensitive','photo','recording','marketing'}<=purposes,purposes
  assert len(actual['services'])==1
  page.locator('[data-nav="reservations"]').first.evaluate('(el)=>el.click()')
  page.locator('[data-act="newReservation"]').first.click()
  page.locator('[data-act="saveReservation"]').first.click()
  page.wait_for_timeout(100)
  assert len(page.evaluate('window.__cloud.data.reservations'))==1
  independent=page.evaluate("async () => {const r=new RemoteState(()=>{}); await r.login('test@example.com','pw'); await r.membership(); const d=await r.read();return [d.customers.length,d.services.length,d.reservations.length]}")
  assert independent==[1,1,1],independent
  # Zoom must preserve the viewport dimensions while changing the time scale within it.
  page.locator('[data-zoom="fit"]').click()
  before=page.locator('.timetable-scroll').evaluate('(el)=>({h:el.clientHeight,w:el.clientWidth,full:el.scrollHeight})')
  page.locator('[data-zoom="up"]').click()
  after=page.locator('.timetable-scroll').evaluate('(el)=>({h:el.clientHeight,w:el.clientWidth,full:el.scrollHeight})')
  assert before['h']==after['h'] and before['w']==after['w'],(before,after)
  assert after['full']>before['full'],(before,after)
  # A staff member assigned to a reservation cannot be deleted before reassignment.
  page.locator('[data-nav="settings"]').first.evaluate('(el)=>el.click()')
  page.locator('[data-settings-section="staff"]').first.click()
  page.locator('[data-extra="staffProfileDelete"]').first.click()
  assert page.locator('#modalRoot').get_by_text('연결된 기록이 있습니다',exact=False).count()>0
  assert page.locator('[data-extra="staffReassign"]').count()>0
  page.locator('[data-extra="closeModal"]').first.click()
  # Verify records persist in the mock server, not just browser variables.
  assert not errors,errors
  print('BROWSER_SMOKE_OK: account notice, shop contract draft, privacy basis, customer/reservation')
  browser.close()
  assert not errors,errors
  print('BROWSER_SMOKE_OK: account notice, shop contract draft, privacy basis, customer/reservation')
finally:
 pass
