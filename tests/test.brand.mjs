import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('product name is consistent across PWA, HTML, and login', () => {
  const meta = JSON.parse(read('../web/manifest.webmanifest'));
  const index = read('../web/index.html');
  const app = read('../web/app.js');
  assert.match(meta.name, /온결 매니저/);
  assert.equal(meta.short_name, '온결 매니저');
  assert.match(index, /<title>온결 매니저/);
  assert.match(index, /<b>온결 매니저<\/b>/);
  assert.match(app, /<strong>온결 매니저<\/strong>/);
  assert.match(app, /document.querySelector\('\.brand b'\)\.textContent=remote\.shopName/);
});
test('main labels are multi-industry, while business identifiers remain compatible', () => {
  const app = read('../web/app.js');
  const sync = read('../web/sync.js');
  assert.match(app, /서비스\/프로그램/);
  assert.match(app, /담당 직원/);
  assert.match(app, /공간·좌석/);
  assert.match(app, /고객 특성·선호 프로필/);
  assert.match(app, /방문 전후 사진/);
  assert.doesNotMatch(app, /피부관리샵 운영|관리사별/);
  assert.match(sync, /ongeol_save_state/);
  assert.match(sync, /window\.ONGEOL_CONFIG|ONGEOL_CONFIG/);
});
