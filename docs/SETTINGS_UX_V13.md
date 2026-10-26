# 온결 매니저 v1.3 설정 UX 변경 · 배포 안내

## 적용 범위

기존 v1.2.1 웹앱에서 '설정'만 간결하게 구성한 업데이트다. Supabase URL/키, 기존 테이블, RPC, 계정/데이터 스키마와 호환된다.

### 설정 메뉴

1. 매장 정보 — 이름·주차·취소 기준·공간/좌석
2. 직원 관리 — 직원명·직책 자유입력(선택)·권한·삭제/이관
3. 서비스 관리 — 프로그램·가격·시간
4. 계정·승인 — 연결코드·가입 승인
5. 개인정보 보호 — 위탁 확인·문서·개인정보 기록
6. 데이터·연동 — JSON 백업·외부 API(고급 메뉴)

**직책 DB는 삭제하지 않았다.** 기존 `staff_positions` 테이블을 새 직원의 '직책 자유입력'에 맞춰 내부에서 재사용한다. 기존 직책/직원 데이터 보존. 별도 직책 마스터 UI만 제거했다.

### 안전성

- 등록된 직원 삭제는 기존의 마지막 1명 보호/연결 기록 이관 확인을 유지
- 관리자로 로그인한 계정과 직원 프로필의 직책은 서로 다른 정보
- 직원명 변경 시 예약·이력 참조가 있으면 기존 문자열 기반 연결이 깨지지 않도록 UI에서 막음(정규화 이전 임시 안전장치)
- Supabase `shop_states`의 JSONB 저장과 사용자별 상세 권한 미완료 문제는 그대로 남음. 실제 고객정보 수집·운영 전 보안·개인정보 검증 필수.

## Git → Cloudflare 배포

**Supabase 추가 SQL 불필요.** 기존 프로젝트의 다음 파일만 업데이트하면 된다.

- `web/app.js`
- `web/style.css`
- `web/sw.js` (PWA 캐시 이름 갱신)
- `web/index.html` (표시 버전 갱신)

`web/config.js`는 건드리지 않는다. 기존 서울 Supabase Project URL / publishable key를 유지해야 한다. 이 파일에 secret/service_role 키를 넣지 말 것.

GitHub 연동 Pages에서 변경 파일 Push → 기존 Production URL 자동 갱신. PWA로 설치했다면 갱신 후 강제 새로고침 혹은 재실행하여 캐시 반영 확인.

## 테스트

- `npm run test:syntax`
- `npm test`
- `python tests/test_settings_v13_browser.py` (Playwright/Chromium과 mock API 필요)

실제 Supabase 운영 리전의 RLS·직원 동시사용·백업·개인정보는 별도 검증 대상.
