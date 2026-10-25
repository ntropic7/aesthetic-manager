# Supabase Sydney → Seoul 신규 구축 가이드

## 왜 직접 변경할 수 없나?
Supabase 프로젝트 리전은 최초 프로비저닝 시 고정된다. 서울 `ap-northeast-2` 프로젝트를 새로 생성해야 한다. **무료 플랜에서 리전 변경 버튼은 없다.**

## 데이터/업체가 아직 없는 현재 상황 권장안

1. 기존 호주 프로젝트의 Dashboard → Project Settings → General에서 실제 Region이 `ap-southeast-2`인지 확인.
2. Supabase Dashboard → New Project에서 `aesthetic-manager` 신규 생성, Region `Northeast Asia (Seoul) / ap-northeast-2`를 명시적으로 선택. 무료 프로젝트 수 한도에 도달한 경우 먼저 불필요한 테스트 프로젝트를 정리한다.
3. **새** 프로젝트 → SQL Editor → `supabase/INSTALL_NEW_PROJECT.sql` 전체 실행. 001~005 통합 파일. 기존 프로젝트의 일부 테이블을 복사하지 않는다.
4. Authentication → Sign In/Providers → Email을 활성화. Authentication → URL Configuration의 Site URL은 Cloudflare **고정 Production URL**. Redirect URLs에도 동일 운영 URL 또는 적절히 제한한 패턴을 등록.
5. Project Settings → API Keys에서 **새** Project URL 및 **새** `sb_publishable_...` 키 확인. `service_role`/secret 키를 브라우저 코드에 넣지 말 것.
6. 프로젝트 `configure_cloudflare.py`로 새 URL/공개키를 넣어 Cloudflare Pages 배포 파일 생성. Git 자동배포라면 저장소 설정/환경변수/빌드 파이프라인에 동등한 값을 반영하고 같은 Pages 프로젝트의 production branch에 배포.
7. 새 페이지에서 이메일 회원가입 후 관리자/직원 계정·매장 생성, 매장 개인정보 문서 확인, **가상의 테스트 고객만** 저장하여 SQL/Table Editor에서 저장 여부 확인.
8. 고객 레코드가 없다면 호주 프로젝트는 이전하지 않고, 새 앱이 서울에 접속함을 충분히 확인한 후 삭제할 수 있음. 삭제하면 이전 호주 Auth 사용자는 사라지므로 기존 이메일 사용자도 서울에서 재가입해야 한다.
9. 서울 프로젝트에 대한 국외 데이터 처리·재위탁 검토는 별도. 서울 지역은 모든 글로벌 처리가 국내에서만 이루어짐을 뜻하지 않는다.

## 이미 실제 데이터가 있으면
삭제 금지. 공식 Supabase Migration Within Supabase / CLI Backup & Restore 절차를 참고하고, Auth·Storage 객체·설정·함수·정책·트리거를 별도로 검증한다. 운영 중 서비스라면 다운타임과 구/신 양방향 저장 금지를 포함한 이전 계획이 필요하다.

Supabase 공식: https://supabase.com/kb/troubleshooting/change-project-region-eWJo5Z / https://supabase.com/docs/guides/platform/migrating-within-supabase
