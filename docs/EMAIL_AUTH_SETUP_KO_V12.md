# 온결 매니저 v1.2: 로그인·회원가입 UI 및 인증 메일 설정

## 앱 화면 변경

- **로그인**: `매장 계정 로그인` 전용 제목과 기존 계정 안내
- **회원가입**: 녹색 상단 강조, `신규 회원가입` 라벨, `계정 만들기 → 이메일 인증 → 매장 연결` 진행 단계, 비밀번호 재확인
- **가입 요청 수락 후**: `이메일을 확인해주세요` 전용 화면 / 가입 이메일 주소 / 안내 순서 / 스팸함 / 재발송 / 로그인 화면으로 이동
- **재발송**: Supabase `/auth/v1/resend`에 `type: signup`으로 재요청. 성공 후 60초 재요청 제한
- **인증 링크에서 복귀**: Supabase의 기본 URL fragment 로그인 세션이 전달된 경우 안전하게 회수하고 `이메일 인증 완료` 화면 표시
- **개인정보/가입 약관**: 인증 뒤 실제 매장 설정 직전에 기존 v1.1의 약관 확인 단계를 유지

## 중요: 2026년 6월부터 신규 Supabase Free 프로젝트는 메일 템플릿 수정 제한

**Supabase 기본 메일 발송기를 사용하는 2026-06-03 이후 생성된 Free 프로젝트는 제목/본문의 커스터마이징이 불가능합니다.** 이번에 만든 서울 리전 무료 프로젝트라면 일반적으로 여기에 해당합니다.

따라서 **웹앱 화면은 코드 Push만으로 변경**되지만, **인증 메일 제목·본문·발신자 표시를 '온결 매니저'로 바꾸려면 Custom SMTP 제공업체를 별도로 연결**해야 합니다. Supabase 기본 발송기는 외부 일반 사용자에게도 메일을 보내는 운영용 서비스가 아닙니다. 현재 공식 안내상 프로젝트 팀에 등록된 이메일만 발송 허용되며 시간당 2건 수준의 제한이 있습니다.

공식 참고:
- https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-email-templates

## 온결 매니저 발신 메일 설정 순서 (Custom SMTP 연결 시)

1. SMTP 업체 계정을 생성합니다. 예: Resend, Brevo, SendGrid, Amazon SES 등. 무료 또는 저비용 사용 가능 여부와 제한은 각 업체를 확인합니다.
2. 소유·검증한 발송 도메인을 SMTP 업체에 등록하고 필요한 DNS 레코드(SPF/DKIM, 필요시 DMARC)를 설정합니다.
3. Supabase 프로젝트 → **Authentication → SMTP Settings / Custom SMTP** (대시보드 버전에 따라 메뉴 표기 상이)에서 `Enable Custom SMTP`를 활성화합니다.
4. SMTP Host / Port / Username / Password는 **Supabase의 인증 설정에만** 입력합니다. GitHub / Cloudflare 프런트엔드 코드 / `web/config.js`에 **절대 넣지 않습니다.**
5. Sender name(보내는 사람 이름)을 `온결 매니저`로, Sender email(보내는 사람 이메일)을 **검증한 도메인의 실제 이메일 주소**로 지정합니다. 예: `no-reply@<소유한도메인>`.
6. Supabase → **Authentication → Email Templates → Confirm sign up**에서
   - Subject: `[온결 매니저] 이메일 인증을 완료해주세요`
   - Body: [`email-templates/confirm_signup_ongyeol.html`](../email-templates/confirm_signup_ongyeol.html)의 HTML 전체를 복사·붙여넣습니다.
   - 중요: `{{ .ConfirmationURL }}` 플레이스홀더를 변경하거나 삭제하면 인증 링크가 작동하지 않습니다.
7. **Authentication → URL Configuration**의 Site URL 및 Redirect URLs에 Cloudflare의 **고정 운영 도메인**을 등록합니다. 배포마다 달라지는 preview URL이 아닙니다.
8. Supabase **Authentication → Sign In / Providers → Email**에서 Confirm Email 활성화 여부를 확인합니다.
9. 테스트용으로 새 이메일 주소에 가입하여 **메일 도착 → 링크 클릭 → 온결 매니저 인증 완료 화면 → 매장 연결 화면**까지 확인합니다.
10. 출시 전 SMTP 발송 제한, 스팸 대응(CAPTCHA), 발송 실패 처리, 도메인 인증, 개인정보 처리방침 등을 추가 점검합니다.

## 기존 서울 DB·Cloudflare 프로젝트에 적용

- **Supabase SQL 변경 없음**. 기존 001~005 SQL을 다시 실행하지 않습니다.
- GitHub에 기존 프로젝트의 `web/app.js`, `web/sync.js`, `web/style.css`, `web/sw.js`와 업데이트된 파일을 Push하면, Git 연동 중인 동일 Cloudflare Pages 프로젝트에서 자동 배포됩니다.
- `web/config.js`의 기존 **서울 Supabase URL + Publishable Key**는 그대로 유지합니다.
- 화면 변경이 보이지 않으면 강력 새로고침 또는 설치된 PWA 재실행을 시도합니다. 캐시 버전을 `v120`으로 갱신했습니다.
- Supabase 대시보드에서 만든 Email Template과 SMTP 발신자 설정은 **웹앱 Git Push로 바뀌지 않습니다.** 별도의 관리자 작업이 필요합니다.

## 안전상 주의

회원가입 UI가 명확해졌다고 해서 서비스의 법적 약관·고객정보 보안이 완성된 것은 아닙니다. 기존 v1.1의 개인정보 점검 및 출시 차단 조건은 유지됩니다. 특히 실제 고객·직원 정보는 권한·백업·법률 문서 검증 전에는 투입하지 않습니다.
