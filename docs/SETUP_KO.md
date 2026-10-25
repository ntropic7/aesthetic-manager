# 온결 / Aesthetic Manager v0.9 설치 가이드

## 1. 신규 설치인지 기존 설치인지 결정

**기존에 만든 Supabase 프로젝트를 꼭 지울 필요는 없습니다.** 가입한 이메일 계정과 Supabase 프로젝트를 유지하면서 SQL만 추가할 수 있습니다. 백업할 샵 데이터가 없다면 신규 프로젝트로 재시작해도 되지만 불필요한 데이터 삭제는 하지 않는 편이 안전합니다.

| 상태 | Supabase SQL Editor에서 실행할 파일 |
|---|---|
| 새 Supabase 프로젝트 | `supabase/INSTALL_NEW_PROJECT.sql` (한 번만) |
| v0.7 / v0.7.1 SQL(001)만 실행 | `002_accounts_staff_phone_ready.sql` → `003_positions_email_only.sql` |
| v0.8 SQL(002)까지 실행 | **`003_positions_email_only.sql`만** |

> 주의: 002 파일 이름에 `phone_ready`가 있어도 v0.9 로그인은 **이메일만 사용**합니다. 002는 기존 직원·초대 DB 구조의 선행 SQL로 필요합니다.

SQL 실행 절차: `https://supabase.com/dashboard` → 프로젝트 → 왼쪽 **SQL Editor** → New query → 파일 내용 붙여넣기 → **Run**. 오류가 있으면 다음 단계로 가지 말고 오류 문구를 확인하세요.

## 2. Cloudflare 배포 파일 준비

ZIP 압축 해제 후 컴퓨터에 Python 3이 있으면:

```bash
cd aesthetic-manager-v0.9
python configure_cloudflare.py
```

다음 두 값만 입력합니다.

1. Supabase Dashboard → **Project Settings / Data API**에서 프로젝트 URL (`https://...supabase.co`)
2. Supabase Dashboard → **Project Settings / API Keys**에서 `sb_publishable_...` 공개 키

**비밀번호, DB 접속문자열, service_role / secret 키는 입력하면 안 됩니다.**

완료 시 `aesthetic_manager_pages_configured.zip`이 생성됩니다. Cloudflare Dashboard → **Workers & Pages → 기존 Pages 프로젝트 → Deployments** → 새 배포/Direct Upload에서 해당 ZIP을 업로드합니다. 메뉴 표시는 서비스 UI 버전에 따라 조금 다를 수 있습니다.

## 3. 이메일 인증 및 리다이렉트

Supabase **Authentication → URL Configuration**의 `Site URL`과 `Redirect URLs`에 Cloudflare에서 받은 실제 `https://...pages.dev` URL을 설정합니다.

Supabase **Authentication → Sign In / Providers → Email**에서 이메일 로그인을 활성화하고 `Confirm Email` 설정을 확인합니다. 이메일 인증은 실제 앱 주소로 돌아오도록 해야 합니다. Supabase Auth 기본 메일 발송에는 제한이 있으므로 초기에 소규모로 테스트하세요.

**Phone/SMS Provider 설정은 필요 없습니다.** 로그인은 이메일/비밀번호만 제공합니다. 개인 설정의 연락처는 인증 여부를 확인하지 않습니다.

## 4. 새로 로그인한 뒤 업무 흐름

1. 이메일 회원가입·메일 확인·로그인
2. **매장 브랜드명만** 입력해 개설. 최고관리자 계정만 생성, **직원 0명/직책 0개**
3. 설정 → 직원·계정 → **직책 신규**: 필요 시 `원장`, `실장`, `피부관리사` 등 직접 추가
4. **직원 신규**: 이름 입력, 직책 연결은 선택. `관리자`/`직원` 권한은 직책과 별도 선택
5. 예약·관리 프로그램·고객 등을 등록
6. 다른 직원이 개인 계정으로 참여하려면 등록된 직원 옆 **초대코드 발급** → 해당 직원이 자신의 이메일로 가입 → **기존 매장 참여**에 코드 입력

> 공용 관리자 계정만 써도 예약/관리 담당 직원 선택 가능. 개인 계정이 있어야 하는 직원만 초대합니다.

## 5. DB에서 결과 확인

Supabase → **Table Editor** → `public.staff_positions`에 직책, `public.staff_profiles`에 실제 직원, `public.shop_members`에 로그인 계정 권한이 저장됩니다. `public.shop_states`에 예약/고객 등이 JSONB로 저장됩니다.

예시 읽기 전용 SQL:

```sql
select s.name as staff_name, p.name as position, s.access_role, s.auth_user_id
from public.staff_profiles s
left join public.staff_positions p on p.id = s.position_id
order by s.created_at;
```

## 6. 운영 전에 확인할 점

- 고객의 건강·피부·상담 정보는 민감할 수 있으니 실고객 데이터 투입 전 동의와 접근 통제 검증 필수
- 일반 직원은 현재 **조회 전용**, 관리자/최고관리자만 저장 가능. 사용자별 변경 이력은 상용 수준이 아님
- 무료 Supabase의 장기 미사용 일시중지, 저장공간, 자동 백업 부재에 유의
- 앱 로고/런처 이름은 `온결`, 내부 프로젝트명은 `aesthetic-manager`, 메인에는 등록 매장명 표시

**관리자와 직원 연결(선택):** 실무도 하는 관리자라면 기존 직원의 `내 관리자계정 연결`을 사용할 수 있습니다. 연결 해제 후에도 최고관리자 권한은 유지됩니다.
