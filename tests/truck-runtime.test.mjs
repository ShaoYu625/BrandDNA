import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { Miniflare } from 'miniflare';

const bundled = buildSync({ entryPoints: ['api/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });

const durableObjects = { TRUCK_WORKSPACE: { className: 'TruckWorkspace', useSQLite: true } };
const compatibilityDate = '2026-06-11';
const ORIGIN = 'http://branddna.test';

async function applyMigrations(db, migrations) {
  for (const migration of migrations) {
    const statements = readFileSync(`api/migrations/${migration}`, 'utf8').split(';').filter(sql => sql.trim());
    for (const sql of statements) await db.prepare(sql).run();
  }
}
function nextMessage(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', listener); reject(new Error('Timed out waiting for a WebSocket message')); }, timeout);
    function listener(event) {
      const data = JSON.parse(event.data);
      if (!predicate(data)) return;
      clearTimeout(timer); ws.removeEventListener('message', listener); resolve(data);
    }
    ws.addEventListener('message', listener);
  });
}
const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
/** A browser-like client: keeps the merchant cookies between calls. */
function client(mf) {
  let cookie = '';
  const call = (path, init = {}) => mf.dispatchFetch(`${ORIGIN}${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
  const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return {
    call, post,
    async login(username = 'haihai', password = 'haihai2026') {
      const res = await post('/api/truck/session', { username, password });
      assert.equal(res.status, 200, await res.clone().text());
      cookie = mergeCookies(cookie, cookieFrom(res));
      return res.json();
    },
    async register(storeName, username, password = 'truck-pass-123') {
      const res = await post('/api/truck/register', { storeName, username, password });
      assert.equal(res.status, 200, await res.clone().text());
      cookie = mergeCookies(cookie, cookieFrom(res));
      return res.json();
    },
    async action(type, payload = {}, headers = {}) {
      const res = await post('/api/truck/actions', { type, payload }, headers);
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      assert.equal(data.success, true);
      return data;
    },
    async state(headers = {}) { return (await (await call('/api/truck/state', { headers })).json()).state; },
    set cookie(value) { cookie = value; },
    get cookie() { return cookie; }
  };
}
function mergeCookies(previous, next) {
  const jar = new Map(previous.split('; ').filter(Boolean).map(pair => pair.split('=')));
  for (const pair of next.split('; ').filter(Boolean)) { const [k, v] = pair.split('='); jar.set(k, v); }
  return [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
}

test('Durable Object workspace pushes realtime views, replays idempotent actions and hides other customers', async t => {
  const mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate, d1Databases: ['DB'], durableObjects });
  t.after(() => mf.dispose());
  await applyMigrations(await mf.getD1Database('DB'), ['0003_truck_workspace.sql', '0004_truck_media.sql']);
  const merchant = client(mf);
  assert.equal((await merchant.call('/api/truck/state')).status, 401);
  await merchant.login();
  const first = await (await merchant.call('/api/truck/state')).json();
  assert.equal(first.realtime, 'ws://branddna.test/api/truck/ws');
  const unchanged = await merchant.call(`/api/truck/state?since=${first.state.revision}`);
  assert.equal(unchanged.status, 204);

  const customer = client(mf);
  const publicState = await (await customer.call('/api/truck/public')).json();
  assert.equal(publicState.state.menu.length, 3);
  assert.equal(publicState.state.order, null);
  assert.equal(publicState.state.orders, undefined);
  assert.doesNotMatch(JSON.stringify(publicState), /0911111111|0922222222/);
  assert.equal((await customer.post('/api/truck/public/actions', { type: 'demo.reset' })).status, 403);
  assert.equal((await customer.call('/api/truck/public?truck=nope-missing')).status, 404);

  const menuId = first.state.menu[0].id;
  const orderBody = { type: 'order.create', payload: { customer: { name: '重送測試', phone: '0900000123' }, items: [{ menuId, quantity: 1 }], couponCode: 'IG20' } };
  const check = await (await customer.post('/api/truck/public/actions', { type: 'coupon.check', payload: { code: 'IG20', items: [{ menuId, quantity: 2 }] } })).json();
  assert.deepEqual([check.result.ok, check.result.amount], [true, 20]);
  const tooSmall = await customer.post('/api/truck/public/actions', orderBody, { 'idempotency-key': 'order-key-000000' });
  assert.equal(tooSmall.status, 400);
  orderBody.payload.items[0].quantity = 2;
  const created = await (await customer.post('/api/truck/public/actions', orderBody, { 'idempotency-key': 'order-key-123456' })).json();
  const retried = await (await customer.post('/api/truck/public/actions', orderBody, { 'idempotency-key': 'order-key-123456' })).json();
  assert.equal(created.success, true);
  assert.equal(created.result.order.total, 180);
  assert.equal(retried.result.order.id, created.result.order.id);
  assert.equal(retried.result.replayed, true);
  assert.equal(created.state.order.id, created.result.order.id);
  assert.doesNotMatch(JSON.stringify(created.state), /0911111111/);
  const afterRetry = await merchant.state();
  assert.equal(afterRetry.orders.filter(order => order.customer.name === '重送測試').length, 1);

  const orderId = created.result.order.id;
  const socketResponse = await customer.call(`/api/truck/ws?view=public&order=${orderId}`, { headers: { upgrade: 'websocket' } });
  assert.equal(socketResponse.status, 101);
  const ws = socketResponse.webSocket;
  const initial = nextMessage(ws, data => data.type === 'state');
  ws.accept();
  t.after(() => ws.close());
  assert.equal((await initial).state.order.status, 'new');
  const accepted = nextMessage(ws, data => data.state?.order?.status === 'accepted');
  await merchant.action('order.status', { id: orderId, status: 'accepted' });
  const pushed = await accepted;
  assert.equal(pushed.state.orders, undefined);
  assert.doesNotMatch(JSON.stringify(pushed), /0922222222/);
  assert.equal((await customer.call('/api/truck/ws?view=merchant', { headers: { upgrade: 'websocket' } })).status, 401);
});

test('each registered truck is its own account and workspace; one browser can switch between trucks', async t => {
  const mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate, d1Databases: ['DB'], durableObjects });
  t.after(() => mf.dispose());
  await applyMigrations(await mf.getD1Database('DB'), ['0003_truck_workspace.sql', '0004_truck_media.sql']);
  const browser = client(mf);
  const wrong = await browser.post('/api/truck/session', { username: 'haihai', password: 'not-the-password' });
  assert.equal(wrong.status, 401);
  await browser.login();
  const registered = await browser.register('小島咖哩車', 'island.curry');
  assert.equal(registered.account.name, '小島咖哩車');
  assert.match(registered.account.slug, /^t[a-f0-9]{10}$/);
  assert.deepEqual(registered.accounts.map(a => a.name), ['海海人生行動餐車', '小島咖哩車']);
  assert.equal((await browser.post('/api/truck/register', { storeName: '重複', username: 'island.curry', password: 'another-pass' })).status, 409);
  assert.equal((await browser.post('/api/truck/register', { storeName: '短密碼', username: 'short.pw', password: '123' })).status, 400);

  // The new truck starts empty; the flagship keeps its own data.
  const island = await browser.state();
  assert.equal(island.brand.name, '小島咖哩車');
  assert.equal(island.menu.length, 0);
  assert.equal(island.diagnosis.status, 'empty');
  await browser.action('menu.save', { name: '椰香咖哩飯', price: 150, category: '飯類' });
  const flagship = await browser.state({ 'x-truck-workspace': 'haihai' });
  assert.equal(flagship.brand.shortName, '海海人生');
  assert.ok(!flagship.menu.some(item => item.name === '椰香咖哩飯'));
  const publicIsland = await (await browser.call(`/api/truck/public?truck=${registered.account.slug}`)).json();
  assert.deepEqual(publicIsland.state.menu.map(item => item.name), ['椰香咖哩飯']);

  // Switching changes the default truck; an explicit workspace header always wins.
  const switchResponse = await browser.post('/api/truck/session/switch', { slug: 'haihai' });
  browser.cookie = mergeCookies(browser.cookie, cookieFrom(switchResponse));
  assert.equal((await switchResponse.json()).active, 'haihai');
  const session = await (await browser.call('/api/truck/session')).json();
  assert.equal(session.accounts.length, 2);
  assert.equal(session.active, 'haihai');
  assert.equal((await browser.state()).brand.shortName, '海海人生');
  assert.equal((await browser.call('/api/truck/state', { headers: { 'x-truck-workspace': 'not-signed-in' } })).status, 401);

  // Renaming the store renames the account.
  await browser.action('brand.update', { name: '小島咖哩餐車' }, { 'x-truck-workspace': registered.account.slug });
  const renamed = await (await browser.call('/api/truck/session')).json();
  assert.ok(renamed.accounts.some(a => a.name === '小島咖哩餐車'));

  // Logging out of one truck keeps the other signed in.
  const out = await browser.call('/api/truck/session', { method: 'DELETE', headers: { 'x-truck-workspace': registered.account.slug } });
  const remaining = await out.json();
  assert.deepEqual(remaining.accounts.map(a => a.slug), ['haihai']);
  browser.cookie = mergeCookies(browser.cookie, cookieFrom(out));
  assert.equal((await browser.call('/api/truck/state', { headers: { 'x-truck-workspace': registered.account.slug } })).status, 401);
  assert.equal((await browser.call('/api/truck/state')).status, 200);
  const other = client(mf);
  await other.login('island.curry', 'truck-pass-123');
  assert.equal((await other.state()).menu[0].name, '椰香咖哩飯');
  assert.equal((await other.post('/api/truck/account/password', { current: 'wrong', next: 'new-password-1' })).status, 401);
  assert.equal((await other.post('/api/truck/account/password', { current: 'truck-pass-123', next: 'new-password-1' })).status, 200);
});

test('Durable Object imports the workspace previously stored in the D1 row', async t => {
  // A D1-only runtime (no Durable Object binding) produces the legacy row format.
  const legacy = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate, d1Databases: ['DB'] });
  await applyMigrations(await legacy.getD1Database('DB'), ['0003_truck_workspace.sql']);
  const legacyClient = client(legacy);
  await legacyClient.login();
  const seeded = await legacyClient.state();
  await legacy.dispose();
  const legacyState = { ...seeded, brand: { ...seeded.brand, shortName: '舊資料餐車' }, revision: 41 };
  const mf2 = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate, d1Databases: ['DB'], durableObjects });
  t.after(() => mf2.dispose());
  const db2 = await mf2.getD1Database('DB');
  await applyMigrations(db2, ['0003_truck_workspace.sql']);
  await db2.prepare('INSERT INTO truck_workspace (id, state_json, revision, updated_at) VALUES (1, ?, ?, ?)').bind(JSON.stringify(legacyState), 41, new Date().toISOString()).run();
  const merchant = client(mf2);
  await merchant.login();
  const imported = await merchant.state();
  assert.equal(imported.brand.shortName, '舊資料餐車');
  assert.equal(imported.revision, 41);
  assert.equal(imported.orders.length, legacyState.orders.length);
});

test('real Worker D1/R2 runtime preserves legacy data and completes both flows', async t => {
  const mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate, d1Databases: ['DB'], r2Buckets: ['BUCKET'], durableObjects });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await applyMigrations(db, ['0001_init.sql', '0002_remove_account_usage_scope.sql', '0003_truck_workspace.sql']);
  const merchant = client(mf);
  await merchant.login();
  async function uploadForm(form) {
    const request = new Request(`${ORIGIN}/api/truck/photo`, { method: 'POST', body: form });
    return merchant.call('/api/truck/photo', { method: 'POST', headers: Object.fromEntries(request.headers), body: await request.arrayBuffer() });
  }

  const legacy = await mf.dispatchFetch(`${ORIGIN}/api/health`);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).success, true);
  const initial = await merchant.state();
  assert.equal(initial.brand.shortName, '海海人生');

  await merchant.action('source.add', { title: '活動公告', type: 'note', content: '週五午間提供餐車預訂取餐，溫暖親切的活動服務。' });
  const diagnosed = await merchant.action('diagnosis.run');
  assert.equal(diagnosed.result.engine, 'rules');
  const generated = await merchant.action('post.generate', { platform: 'instagram', topic: '週五午間餐車預訂', image: '/static/truck/brand/truck-official.jpg' });
  const postId = generated.result.post.id;
  await merchant.action('post.approve', { id: postId });
  const scheduled = await merchant.action('post.schedule', { id: postId, scheduledAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(scheduled.result.post.status, 'scheduled');
  const published = await merchant.action('post.publish', { id: postId });
  assert.equal(published.result.post.status, 'published');
  const measured = await merchant.action('post.metrics', { id: postId, reach: 800, likes: 60, comments: 5, saves: 9, clicks: 14 });
  assert.equal(measured.result.post.metrics.reach, 800);

  const member = await merchant.action('member.save', { name: '海風同學', phone: '0900777888' });
  const menuId = initial.menu[0].id;
  const orders = await Promise.all(Array.from({ length: 4 }, (_, i) => merchant.action('order.create', { customer: { name: `測試客人${i}`, phone: `090000000${i}` }, items: [{ menuId, quantity: i + 1 }] })));
  const order = await merchant.action('order.create', { customer: { name: '海風同學' }, memberId: member.result.member.id, items: [{ menuId, quantity: 2 }] });
  assert.equal(order.result.order.total, 200);
  assert.equal(order.result.order.customer.lineBound, true);
  assert.equal(new Set(orders.map(data => data.result.order.number)).size, 4);
  for (const status of ['accepted', 'preparing', 'ready', 'completed']) await merchant.action('order.status', { id: order.result.order.id, status });
  const stored = await merchant.state();
  assert.equal(stored.orders.length, initial.orders.length + 5);
  assert.equal(stored.orders.find(row => row.id === order.result.order.id).status, 'completed');

  // Idle assistant: the seed has a scheduled post, so the daily check has nothing to add.
  const checked = await merchant.action('assistant.check');
  assert.equal(checked.result.skipped, 'scheduled');
  const ai = await (await merchant.call('/api/truck/ai/status')).json();
  assert.equal(ai.ai.enabled, false);
  assert.equal(ai.ai.model, 'gpt-6-luna');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.set('file', new Blob([png], { type: 'image/png' }), 'photo.png');
  const upload = await uploadForm(form);
  assert.equal(upload.status, 200, await upload.clone().text());
  const media = await upload.json();
  assert.match(media.url, /^\/api\/truck\/media\/.*\.png$/);
  const download = await mf.dispatchFetch(`${ORIGIN}${media.url}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);

  const spoof = new FormData(); spoof.set('file', new Blob(['<script>invalid</script>'], { type: 'image/png' }), 'not-a-photo.png');
  assert.equal((await uploadForm(spoof)).status, 400);
  const excessive = await merchant.call('/api/truck/photo', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.alloc(6 * 1024 * 1024) });
  assert.equal(excessive.status, 413);

  await merchant.action('demo.reset');
  assert.equal((await db.prepare('SELECT count(*) AS count FROM brands').first()).count, 1);
  const reset = await merchant.state();
  assert.equal(reset.orders.length, initial.orders.length);
  assert.ok(reset.revision > initial.revision);
});

test('D1-only deployment stores a 5MB image in bounded chunks and preserves the photo validation contract', async t => {
  const mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-06-11', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await applyMigrations(db, ['0003_truck_workspace.sql', '0004_truck_media.sql']);
  const merchant = client(mf);
  async function upload(bytes, type = 'image/jpeg') {
    const form = new FormData(); form.set('file', new Blob([bytes], { type }), 'upload.jpg');
    const request = new Request(`${ORIGIN}/api/truck/photo`, { method: 'POST', body: form });
    return merchant.call('/api/truck/photo', { method: 'POST', headers: Object.fromEntries(request.headers), body: await request.arrayBuffer() });
  }
  const jpeg = readFileSync('pages/static/truck/brand/truck-official.jpg');
  assert.equal((await upload(jpeg)).status, 401);
  await merchant.login();
  // Extra JPEG trailing data keeps the signature valid and exercises the 5MB upload limit.
  const large = Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024 - jpeg.length)]);
  const saved = await upload(large);
  assert.equal(saved.status, 200, await saved.clone().text());
  const { url } = await saved.json();
  const chunks = await db.prepare('SELECT COUNT(*) AS count, MAX(length(body)) AS largest FROM truck_media_chunks').first();
  assert.ok(chunks.count > 1);
  assert.ok(chunks.largest <= 256 * 1024);
  const downloaded = await mf.dispatchFetch(`${ORIGIN}${url}`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), large);
  assert.match(downloaded.headers.get('cache-control'), /immutable/);
  const revalidated = await mf.dispatchFetch(`${ORIGIN}${url}`, { headers: { 'if-none-match': downloaded.headers.get('etag') } });
  assert.equal(revalidated.status, 304);
  assert.equal((await upload(Buffer.from('not a JPEG'))).status, 400);
  assert.equal((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status, 400);
  assert.equal((await upload(Buffer.concat([large, Buffer.from([0])]))).status, 413);
  assert.equal((await mf.dispatchFetch(`${ORIGIN}/api/truck/media/00000000-0000-0000-0000-000000000000.jpg`)).status, 404);
  assert.equal((await merchant.call('/api/truck/state')).status, 200);
});
