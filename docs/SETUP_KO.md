# 온결 v0.7 — 무료 서버 연결 및 앱 설치 가이드

> **기본 목표:** 서버 컴퓨터/신용카드 없이 Supabase 무료 DB에 저장하고, Cloudflare Pages 무료 배포로 휴대폰·PC·태블릿에서 같은 앱에 로그인합니다. 이번 단계에서는 LLM/STT, 예약톡 실발송, 외부 검색 자동수집은 연결하지 않습니다.
>
> **배포 전 경고:** 설치가 가능하다는 것과 개인정보를 넣어 상용 운영해도 된다는 것은 다릅니다. 이 버전은 소규모 *파일럿/검증*용입니다. 아래의 보안·데이터 유지 정책을 먼저 검토하세요.

## 한눈에 보기

```
갤럭시 · 아이폰 · PC
       │ (HTTPS)
       ▼
Cloudflare Pages — 온결 웹/PWA (정적 파일)
       │ HTTPS / Supabase 공개 publishable key + 사용자 JWT
       ▼
Supabase Free
 ├─ Auth           이메일 로그인
 ├─ PostgreSQL     매장별 상태 / RLS / 버전 충돌 차단
 └─ Storage        피부사진 (비공개, 임시 서명 URL)
```

별도 PC를 24시간 켜두거나 Python 서버를 구매/실행할 필요가 없습니다.

## 1단계. Supabase 무료 프로젝트 생성

1. https://supabase.com/dashboard 에서 계정을 만듭니다.
2. **New project** → Organization 선택 → 프로젝트 이름 예: `ongeol-app`.
3. **Free plan**을 선택합니다. DB 비밀번호는 강력하게 만들고 안전하게 보관하세요. **이 비밀번호를 웹앱에 입력하거나 공유하지 않습니다.**
4. Region은 가능하면 한국/아시아에 가까운 곳을 선택합니다.
5. 프로젝트가 생성되고 실행 준비가 되면 **SQL Editor → New query**를 엽니다.

## 2단계. DB·접근권한·사진 저장소 만들기

ZIP의 `supabase/migrations/001_ongeol_initial.sql` 파일 전체를 복사해 **SQL Editor**에 붙여넣고 **Run** 합니다.

생성하는 객체:
- `shops`, `shop_members`, `shop_states`, `shop_invites` 테이블
- 매장별 **Row Level Security(RLS)** 정책
- `ongeol_create_shop`, `ongeol_save_state`, `ongeol_create_invite`, `ongeol_join_shop` 함수
- 비공개 `ongeol-private` 사진 버킷 및 접근 정책

성공 시 SQL Editor에서 오류가 없어야 합니다. 오류가 나면 무시하지 말고 SQL 에러 문구와 줄을 확인하세요. 기존 Supabase 프로젝트의 데이터/정책과 충돌할 수 있으므로 **새 프로젝트**에서 실행하는 것을 권장합니다.

## 3단계. URL과 공개 키만 복사하기

Supabase Dashboard에서:
- **Project Settings → Data API** (화면에 따라 Project URL) → `https://xxxxx.supabase.co` 형태의 주소 복사
- **Project Settings → API Keys** → `Publishable key` (`sb_publishable_...`) 복사

웹앱의 `web/config.js`를 메모장 또는 VS Code로 열어 두 군데를 수정합니다. **또는** PC에 Python이 있다면 프로젝트 루트에서 `python configure_cloudflare.py`를 실행하여 URL·공개키를 입력하면 `ongeol_pages_configured.zip`이 자동 생성됩니다. 이 경우 `config.js`를 직접 고칠 필요가 없습니다.

```js
window.ONGEOL_CONFIG = Object.freeze({
  apiMode: 'supabase',
  supabaseUrl: 'https://실제프로젝트.supabase.co',
  supabasePublishableKey: 'sb_publishable_실제키'
});
```

**절대 사용 금지:** `secret key`, `service_role`, DB password, JWT secret. 이 값들은 공개 웹 파일에 두면 안 됩니다. Publishable key는 클라이언트에 포함하도록 설계된 공개 식별 키이며, 접근 통제는 로그인과 RLS가 담당합니다.

## 4단계. 앱 배포 (Cloudflare Pages 무료)

1. https://dash.cloudflare.com/ 에 계정을 만듭니다.
2. **Workers & Pages → Create application → Pages → Drag and drop your files**로 이동합니다. (관리자 UI는 버전에 따라 문구가 약간 다를 수 있습니다.)
3. **`web` 폴더 안의 파일들**을 업로드합니다. 설정 생성기를 사용했다면 `ongeol_pages_configured.zip`을 업로드하면 됩니다. `index.html`이 배포 루트에 있어야 합니다. (`web/web/index.html`로 중첩되면 안 됩니다.)
4. 프로젝트 이름은 예: `ongeol-myshop`으로 지정하고 **Deploy** 합니다.
5. 생성된 `https://ongeol-myshop.pages.dev` 같은 주소를 열어봅니다.

Cloudflare에는 설치/빌드 명령이 필요 없습니다. HTML, JS, CSS 정적 파일을 그대로 배포합니다. `config.js` 변경 후에는 해당 파일이 포함된 웹 폴더를 **다시 업로드**해야 합니다.

정식 Git 배포로 전환할 때도 `web/`을 그대로 배포 디렉터리로 사용할 수 있습니다.

## 5단계. Supabase 이메일 인증 링크 설정

Supabase **Authentication → URL Configuration**에서 **Site URL**을 현재 배포한 `https://...pages.dev`로 변경합니다. 필요하면 해당 URL을 Redirect URLs에도 추가합니다.

앱을 다시 열고 다음 순서대로 진행합니다.

1. **첫 사용 · 계정 만들기** → 본인 이메일/비밀번호로 가입.
2. 이메일 인증이 활성화된 프로젝트라면 **확인 메일의 링크 클릭**.
3. 앱으로 돌아와 **로그인**.
4. **새 매장 만들기**에 실제 사용할 매장명을 입력 (처음에는 테스트용 이름 권장).
5. **설정 → 관리 프로그램 추가**: 이름/시간/가격 등록.
6. **고객 → 새 고객 등록**.
7. **예약 → 예약 등록**. 이제 서버로 저장됩니다.
8. 휴대폰과 PC에서 동일한 주소/계정으로 로그인한 후 저장한 고객·예약이 함께 보이는지 확인합니다.

로그인 가입이 끝나고 혼자 운영할 계획이라면 Supabase Auth 설정에서 **신규 공개 회원가입 허용 여부**를 검토하세요. 단, 초대 직원을 추가하려면 다시 활성화하거나 관리자 방식으로 계정을 생성해야 합니다.

## 6단계. 휴대폰에 앱처럼 설치

- **Android Chrome:** 배포 주소 열기 → 브라우저 메뉴 → **홈 화면에 추가** 또는 **앱 설치**.
- **iPhone Safari:** 공유 → **홈 화면에 추가**.
- **PC Chrome/Edge:** 브라우저 설치 메뉴/주소창의 앱 설치 기능 사용.

이 방식은 **PWA(홈 화면 웹앱)** 입니다. Android APK/AAB 또는 iOS IPA를 생성한 것은 아닙니다. 서버 데이터는 인터넷 연결이 있을 때 사용합니다. 오프라인에서 수정하는 기능은 지원하지 않습니다.

## 7단계. 꼭 확인할 실제 테스트

- 테스트 고객 1명 등록 → 페이지 새로고침 → 고객이 유지되는지
- 예약 등록 → 목록형·일간·관리사 주간형에서 같은 예약이 보이는지
- 휴대폰/PC 로그인 → 두 기기에서 같은 데이터인지
- 예약 상태를 노쇼로 변경 → 다시 수정/복구 가능한지
- 관리 완료 → 횟수권 1회 차감 → 취소 시 차감 복원되는지
- 동의를 켠 테스트 고객의 사진을 업로드 → 다른 기기에서 확인되는지
- 매장 A 직원은 다른 매장 B의 데이터가 보이지 않는지(테스트 계정으로 검증)
- 일부러 다른 기기에서 먼저 수정한 후 오래 열린 브라우저에서 수정 → **동시 변경 충돌 경고**가 뜨는지

**충돌 발생 시:** 낡은 화면의 저장이 거부됩니다. 어느 기기 내용을 유지할지 먼저 확인한 후 새로고침하세요. 자동 병합은 아직 없습니다.

## 서버 비용과 제한

- Supabase Free: **월 $0**, DB 500MB, 파일 1GB, 월간 활성 사용자 5만 명. 프로젝트는 활동이 적을 때 7일 후 일시정지될 수 있습니다. **Free 자동 백업 없음.**
- Cloudflare Pages Free: 정적 사이트 무료 호스팅. 별도 도메인을 구매하지 않고 `*.pages.dev` 주소를 사용하면 도메인 구매비도 없습니다.
- SMS/알림톡/PG/AI: 이번 버전은 미연결, 외부 사용료도 발생하지 않습니다.

최신 한도/정책은 공식 문서 확인:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://developers.cloudflare.com/pages/get-started/direct-upload/

## 흔한 오류

| 현상 | 점검 |
|---|---|
| “Supabase 설정 필요” | `config.js` 두 값을 수정하고 웹앱 재배포했는지 |
| 로그인 실패 | 가입 이메일 인증 여부, 비밀번호, 프로젝트 일시정지 여부 |
| `Could not find function` | SQL 파일 전체 실행 여부, `public` Data API 스키마 노출 설정, 프로젝트의 schema cache 반영 여부 |
| `permission denied` | 로그인된 사용자의 매장 소속, SQL 실행·RLS 정책 생성 여부 |
| 저장 충돌 | 다른 기기에서 수정한 후 오래된 화면에서 저장함. 데이터 비교 후 새로고침 |
| 사진이 보이지 않음 | 비공개 `ongeol-private` Storage 버킷/정책, 사진 동의 체크, 서명 URL 만료 후 페이지 새로고침 |
| Cloudflare 404 | 웹 루트에 `index.html`이 있는지. 업로드 폴더 중첩 여부 |
| 계정 확인 메일 미도착 | 메일 스팸함, Supabase Auth 이메일 제한/설정 |

## 별도 개발 서버가 없는 이유

v0.6에는 FastAPI 서버 + PostgreSQL Docker가 있었지만, **v0.7 무료 배포 경로에서는 필요하지 않습니다.** Supabase가 로그인/DB/보안 정책을 제공하고 브라우저 앱은 HTTPS로 Supabase API를 호출합니다. LLM API 키가 필요한 다음 단계에서는 **Supabase Edge Function**을 통해 비밀 키를 서버에만 보관합니다.
