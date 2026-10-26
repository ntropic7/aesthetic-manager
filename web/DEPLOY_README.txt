온결 매니저 v1.2.1 Cloudflare Pages 업로드 폴더

1. 신규 Supabase 프로젝트일 때만 docs/SETUP_KO.md에 따라 최초 SQL을 실행합니다. v1.2에서 v1.2.1로 업데이트할 때 SQL은 필요 없습니다. 직원 프로필은 기존 데이터 그대로 사용합니다.
2. 소스 프로젝트의 configure_cloudflare.py로 Supabase URL과 Publishable key가 포함된 배포 ZIP을 만듭니다. 또는 config.js의 두 값을 직접 설정합니다.
3. 이 web 폴더의 파일들이 Pages 루트에 오도록 업로드합니다. index.html이 최상위여야 합니다.
4. 별도 docs/SETUP_KO.md에 전체 설명이 있습니다.

이 ZIP/폴더에 secret key/service_role/DB password를 넣지 마세요.
