# 온결 클라우드 연결판 v0.7

실제 Supabase 무료 클라우드에 로그인/매장/고객/예약/사진 등을 보관하는 **정적 웹/PWA** 프로젝트. v0.6 반응형 UI를 계승하되 **FastAPI Docker를 실행할 필요 없이** Cloudflare Pages에 업로드하여 배포할 수 있습니다.

**편한 설정:** `python configure_cloudflare.py`로 Project URL과 publishable key를 입력하면 업로드용 ZIP이 자동 생성됩니다.

**시작:** [`docs/SETUP_KO.md`](docs/SETUP_KO.md) → Supabase 프로젝트 → SQL 실행 → `web/config.js` 입력 → Cloudflare Pages `web/` 배포 → 가입·로그인·매장 개설.

## 파일 구성

```text
ongeol_v0.7/
├── web/                        Cloudflare Pages에 그대로 배포
│   ├── index.html
│   ├── app.js                  화면/업무 로직
│   ├── sync.js                 Supabase Auth/REST/RPC/Storage
│   ├── domain.js               예약 충돌/집계
│   ├── style.css               PC/태블릿/모바일 반응형
│   ├── config.js               프로젝트 URL + publishable key (수정할 곳)
│   ├── manifest.webmanifest
│   ├── icon.svg
│   ├── sw.js                   정적 파일 네트워크 우선 캐시
│   ├── _headers                Cloudflare 보안 헤더
│   └── robots.txt
├── supabase/migrations/
│   └── 001_ongeol_initial.sql  SQL Editor 전체 실행
├── docs/
│   ├── SETUP_KO.md             순서대로 따라하기
│   ├── SECURITY_AND_LIMITATIONS.md
│   └── FEATURE_STATUS.md
└── tests/                      Node 스모크/업무 규칙 테스트
```

## 테스트

```
node --check web/app.js
npm test   # Node 20+ 필요, 의존성 설치는 불필요
```

**사용자가 직접 해야 하는 것:** Supabase/Cloudflare 계정 생성, 무료 프로젝트 생성, SQL 실행, publishable key 설정, Cloudflare 웹 업로드, 이메일 인증 및 로그인. 해당 계정/키가 없어 이 ZIP을 만든 시점에는 실제 호스팅된 서버와 최종 연결은 아직 하지 않았습니다.

**경고:** 초기 보안 기능은 포함되지만 상용 개인정보 운영 준비가 끝난 제품은 아닙니다. 원장 1인 파일럿 → 다중 직원 트랜잭션/RBAC/보관정책 검증 → 운영 도입 순서 권장.
