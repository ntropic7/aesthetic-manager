// 1) Supabase → Project Settings → Data API의 Project URL 입력
// 2) Supabase → Project Settings → API Keys의 publishable key (sb_publishable_...) 입력
// 주의: secret / service_role 키는 절대 여기에 넣지 마세요.
window.ONGEOL_CONFIG = Object.freeze({
  apiMode: 'supabase',
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabasePublishableKey: 'sb_publishable_REPLACE_ME'
});
