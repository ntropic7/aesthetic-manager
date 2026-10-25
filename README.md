# Aesthetic Manager v0.9 — 온결 (가칭)

**피부관리샵용 멀티 디바이스 운영 웹앱/PWA.** 내부 프로젝트명은 `aesthetic-manager`, 출시용 앱명(가칭)은 `온결`, 로그인 후 상단/사이드바의 주 브랜드는 **각 샵이 등록한 매장 이름**으로 표시됩니다.

## 이번 버전 변경사항

- 최초 이메일 계정 가입 → 매장명 입력 → **최고관리자 계정으로 매장 생성**. 자동 직원/자동 직책 **없음**.
- 매장 생성 후 `설정 → 직원·계정`: **직책 마스터 신규·수정·삭제(미사용만)** / 직원 이름만 등록 가능 / 기존 직책 선택적 할당.
- `김민지` + 직책 `실장` → 직원·예약 조회 화면에서 `김민지 · 실장`로 표시. 직책을 바꿔도 예약에 기록한 기존 담당자 이름은 강제로 변경하지 않음.
- 직원은 **계정 없이** 등록 가능. 필요하면 직원별 이메일 계정 가입 후 **48시간/1회용 초대코드**로 기존 직원 프로필에 연결 가능.
- 공용 관리자 계정만으로도 운영 가능. 다만 공용 계정으로 한 작업을 개별 직원별로 추적할 수는 없음.
- **휴대폰 OTP 로그인은 앱에서 제거**. 이메일/비밀번호만 로그인. 개인 설정의 미인증 연락처만 선택 등록 가능.
- 이전 예약·고객·회원권·시간표·마케팅 화면 유지. 앱 브랜드(가칭)는 온결이며 Cloudflare 배포 기술 프로젝트명은 aesthetic-manager.

## 처음 설치 / 이미 설치한 Supabase

[**설치 가이드: docs/SETUP_KO.md**](docs/SETUP_KO.md)

- **Supabase 신규 프로젝트**라면 `supabase/INSTALL_NEW_PROJECT.sql`을 **한 번만** 실행합니다 (001 → 002 → 003 통합).
- **기존 Supabase 프로젝트에 v0.8의 002 SQL까지 실행했다면** `supabase/migrations/003_positions_email_only.sql`만 실행합니다. 고객/예약 데이터를 삭제하지 않습니다.
- v0.7.1 등으로 **001만 실행했다면** 002 → 003 순서대로 실행합니다.
- Cloudflare 배포: `python configure_cloudflare.py` → `Project URL`, `Publishable key`만 입력 → 생성된 `aesthetic_manager_pages_configured.zip`을 기존 Cloudflare Pages 프로젝트에 업로드.

**비밀키(`service_role`, `secret`)를 웹 코드에 넣지 마세요.**

## 테스트

```bash
npm test
python tests/smoke_browser.py   # Python Playwright + Chromium이 설치된 환경에서
node --check web/app.js
node --check web/sync.js
```

자동화는 **모의 Supabase API** 기반입니다. 실제 Supabase 배포 환경에서 SQL/RLS, 이메일 인증, 다중 기기 테스트는 설치 후 별도로 수행해야 합니다.

## 구조

- `web/` 정적 HTML/CSS/JS + PWA (Cloudflare Pages)
- `web/sync.js` Supabase 이메일 Auth / PostgreSQL RPC / 비공개 Storage 연동
- `supabase/migrations/001...003...` 로그인/매장/직원/직책/권한/RLS
- `configure_cloudflare.py` 공개 설정값을 배포 ZIP에 삽입
- `tests/` Node 업무 단위테스트 + 브라우저 스모크 테스트

## 실서비스 전 제한

매장별 업무 데이터가 JSONB 한 레코드에 모여 있는 **파일럿 아키텍처**입니다. 일반 직원은 현재 DB 저장을 하지 못하고 조회 전용입니다. 실제 피부 사진, 녹음, 민감한 상담정보를 입력하기 전에는 정규화·세분화된 RLS·트랜잭션·백업·감사로그·삭제정책·동시사용 점검 등이 필요합니다. 외부 LLM/STT, 카카오톡/문자 실발송, 결제 PG 연동은 아직 미연결입니다.

**관리자와 직원 연결(선택):** 실무도 하는 관리자라면 기존 직원의 `내 관리자계정 연결`을 사용할 수 있습니다. 연결 해제 후에도 최고관리자 권한은 유지됩니다.
