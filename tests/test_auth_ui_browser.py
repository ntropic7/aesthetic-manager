from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'web/index.html').read_text().replace('<script src="./config.js"></script><script type="module" src="./app.js"></script>','')
html=html.replace('<link rel="stylesheet" href="./style.css">','').replace('<link rel="manifest" href="./manifest.webmanifest">','').replace('<link rel="icon" type="image/svg+xml" href="./icon.svg">','')
mock=(ROOT/'tests/mock_fetch.js').read_text()+"""
window.__mailRequests=[];
const originalFetch=window.fetch;
window.fetch=async function(url,opts={}){
  const path=String(url);
  if(path.endsWith('/auth/v1/signup') || path.endsWith('/auth/v1/resend')) {
    const kind=path.endsWith('/signup')?'signup':'resend';
    window.__mailRequests.push({kind, body:JSON.parse(opts.body)});
    return {ok:true,status:200,text:async()=>JSON.stringify(kind==='signup'?{id:'new-user',email:JSON.parse(opts.body).email}:{})};
  }
  return originalFetch(url,opts);
};
"""
domain=(ROOT/'web/domain.js').read_text().replace('export const ','const ').replace('export function ','function ')
sync=(ROOT/'web/sync.js').read_text().replace('export const ','const ').replace('export function ','function ').replace('export class ','class ')
app=(ROOT/'web/app.js').read_text().replace("import { bookingConflict } from './domain.js';",'').replace("import { RemoteState, serverMode, configurationReady } from './sync.js';",'')
code='\n'.join(['(function(){',domain,'window.bookingConflict=bookingConflict;})();','(function(){',sync,'Object.assign(window,{RemoteState,serverMode,configurationReady});})();',app])
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    errors=[]
    def setup(width,height,verified=False):
        page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='domcontentloaded')
        page.add_style_tag(content=(ROOT/'web/style.css').read_text())
        page.evaluate("window.ONGEOL_CONFIG={apiMode:'supabase',supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_demo_key'}")
        page.evaluate(mock)
        if verified:
            page.evaluate("location.hash='#access_token=test-token&refresh_token=test-refresh&expires_in=3600&token_type=bearer&type=signup';history.replaceState=()=>{window.__clearedRedirect=true;};")
        page.add_script_tag(content=code)
        return page
    desktop=setup(1280,900)
    desktop.get_by_role('heading',name='매장 계정 로그인').wait_for()
    desktop.screenshot(path=str(ROOT/'docs/login_v12.png'))
    desktop.locator('#toggleAuth').click()
    desktop.get_by_role('heading',name='온결 매니저 시작하기').wait_for()
    assert desktop.locator('#authPasswordConfirm').count()==1
    desktop.locator('#authEmail').fill('newuser@example.com')
    desktop.locator('#authPassword').fill('abcdefgh12')
    desktop.locator('#authPasswordConfirm').fill('wrongpw123')
    desktop.get_by_role('button',name='가입하고 인증 메일 받기').click()
    assert '일치하지' in desktop.locator('#authMessage').inner_text()
    assert desktop.evaluate('window.__mailRequests.length')==0
    desktop.locator('#authPasswordConfirm').fill('abcdefgh12')
    desktop.screenshot(path=str(ROOT/'docs/signup_v12.png'))
    desktop.get_by_role('button',name='가입하고 인증 메일 받기').click()
    desktop.get_by_role('heading',name='이메일을 확인해주세요').wait_for()
    assert desktop.get_by_text('newuser@example.com').count()>=1
    assert desktop.evaluate('window.__mailRequests.length')==1
    desktop.screenshot(path=str(ROOT/'docs/pending_v12.png'))
    desktop.get_by_role('button',name='인증 메일 다시 보내기').click()
    assert desktop.evaluate("window.__mailRequests.at(-1).kind")=='resend'
    assert desktop.evaluate("window.__mailRequests.at(-1).body.type")=='signup'
    assert desktop.get_by_text('60초 후 다시 보낼 수 있어요').count()==1
    desktop.get_by_role('button',name='로그인 화면으로').click()
    desktop.get_by_role('heading',name='매장 계정 로그인').wait_for()

    mobile=setup(390,844)
    mobile.locator('#toggleAuth').click()
    mobile.get_by_role('heading',name='온결 매니저 시작하기').wait_for()
    mobile.screenshot(path=str(ROOT/'docs/signup_mobile_v12.png'))
    mobile.locator('#authEmail').fill('mobile@example.com')
    mobile.locator('#authPassword').fill('abcdefgh12')
    mobile.locator('#authPasswordConfirm').fill('abcdefgh12')
    mobile.get_by_role('button',name='가입하고 인증 메일 받기').click()
    mobile.get_by_role('heading',name='이메일을 확인해주세요').wait_for()
    mobile.screenshot(path=str(ROOT/'docs/pending_mobile_v12.png'))

    verified=setup(390,844,True)
    verified.get_by_role('heading',name='이메일 인증이 완료됐어요!').wait_for()
    assert verified.evaluate('window.__clearedRedirect') is True
    verified.screenshot(path=str(ROOT/'docs/verified_mobile_v12.png'))
    assert not errors,errors
    browser.close()
print('AUTH_UI_OK: signup is distinct, mismatch blocks submit, resend works, confirmation and verification shown, mobile responsive')
