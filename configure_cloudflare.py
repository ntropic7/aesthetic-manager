"""온결 Cloudflare 업로드 ZIP 생성기 (Python 표준 라이브러리만 사용)."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re

ROOT = Path(__file__).resolve().parent
print('온결 v0.7 Supabase 설정 → Pages 업로드용 ZIP 생성')
url = input('Supabase Project URL (https://xxx.supabase.co): ').strip().rstrip('/')
key = input('Supabase Publishable key (sb_publishable_...): ').strip()
if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', url, re.I):
    raise SystemExit('오류: Supabase Project URL 형식을 확인해 주세요.')
if not key.startswith('sb_publishable_') or len(key) < 20 or any(x in key.lower() for x in ('replace', 'service_role', 'secret')):
    raise SystemExit('오류: secret/service_role가 아닌 Publishable key를 입력해 주세요.')
config = ("window.ONGEOL_CONFIG = Object.freeze({\n"
          "  apiMode: 'supabase',\n"
          f"  supabaseUrl: '{url}',\n"
          f"  supabasePublishableKey: '{key}'\n"
          "});\n")
out = ROOT / 'ongeol_pages_configured.zip'
with ZipFile(out, 'w', ZIP_DEFLATED) as z:
    for f in sorted((ROOT / 'web').iterdir()):
        if f.is_file():
            z.writestr(f.name, config if f.name == 'config.js' else f.read_bytes())
print('완료:', out)
print('Cloudflare Pages → Direct Upload에서 이 ZIP을 올리면 됩니다.')
print('주의: URL/Publishable key는 웹에 공개되는 값입니다. secret/service_role는 절대 입력하지 마세요.')
