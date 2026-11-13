
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { Miniflare } from 'miniflare';

const script = buildSync({
  entryPoints: ['api/src/index.ts'], bundle: true, write: false, format: 'esm', target: 'es2022',
}).outputFiles[0].text;
const origin = 'https://branddna.test';
const key = 'local-test-only-a-random-length-access-key';
const appSecret = 'local-test-only-app-secret';
const verifyToken = 'local-webhook-test-only-verify-token';
const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 17, 8, 4, 56, 4, 56, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
const remoteDate = '2026-11-01T09:00:00+0000';

async function runtime(t, graph) {
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-06-11', d1Databases: ['DB'],
    durableObjects: { TRUCK_WORKSPACE: { className: 'TruckWorkspace', useSQLite: true } },
    bindings: {
      TRUCK_PUBLIC_ORIGIN: origin, TRUCK_MERCHANT_KEY: key, META_APP_ID: '101', META_APP_SECRET: appSecret,
      META_WEBHOOK_VERIFY_TOKEN: verifyToken,
      META_GRAPH_VERSION: 'v27.0', META_IG_CONFIG_ID: '102', META_FB_CONFIG_ID: '103',
    },
    outboundService: async req => {
      const url = new URL(req.url);
      assert.equal(url.origin, 'https://graph.facebook.com');
      return Response.json(await graph(url, req));
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of ['0003_truck_workspace.sql', '0004_truck_media.sql']) {
    for (const sql of readFileSync('api/migrations/' + name, 'utf8').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  }
  let cookie;
  const call = (path, init = {}) => mf.dispatchFetch(origin + '/api/truck/' + path, {
    ...init, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...init.headers },
  });
  const post = (path, data, headers) => call(path, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(data),
  });
  const json = async response => {
    const res = await response;
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data;
  };
  const login = async () => {
    const res = await post('session', { username: 'haihai', password: key });
    assert.equal(res.status, 200, await res.text());
    assert.match(res.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax.*Secure/i);
    cookie = res.headers.get('set-cookie').split(';')[0];
  };
  const action = (type, payload) => json(post('actions', { type, payload }));
  const connect = async (platform, accountId) => {
    const start = await json(post('meta/connect', { platform }));
    const url = new URL(start.url);
    assert.equal(url.origin, 'https://www.facebook.com');
    assert.equal(url.searchParams.get('config_id'), platform === 'instagram' ? '102' : '103');
    const callback = 'meta/callback?code=mock-code&state=' + url.searchParams.get('state');
    assert.equal((await call(callback, { headers: { cookie: '' } })).status, 401);
    const authorized = await call(callback);
    assert.equal(authorized.status, 303);
    assert.match(authorized.headers.get('location'), /meta=choose/);
    assert.match((await call(callback)).headers.get('location'), /meta=invalid/);
    const status = await json(call('meta/status'));
    assert.equal(status.platforms[platform].candidates[0].id, accountId);
    assert.doesNotMatch(JSON.stringify(status), /private-token|mock-code/);
    return json(post('meta/select', { platform, accountId }));
  };
  const upload = async () => {
    const form = new FormData();
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'confirmed.jpg');
    const req = new Request(origin, { method: 'POST', body: form });
    return (await json(call('photo?publish=1', {
      method: 'POST', headers: { ...Object.fromEntries(req.headers), origin }, body: await req.arrayBuffer(),
    }))).url;
  };
  const draft = async (platform, accountId, options = {}) => {
    const { post: p } = (await action('post.generate', { platform, topic: '本機發文驗收' })).result;
    const image = options.kind && options.kind !== 'photo' ? undefined : await upload();
    const approval = { id: p.id, accountId, image, content: { caption: p.caption, image: p.image, cardTitle: p.cardTitle }, ...options };
    await json(post('meta/approve', approval));
    return p.id;
  };
  const getPost = async id => (await json(call('state'))).state.posts.find(p => p.id === id);
  const awaitStatus = async (id, status) => {
    for (let i = 0; i < 80; i++) {
      const p = await getPost(id);
      if (p.meta?.status === status) return p;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail('Did not reach ' + status + ': ' + JSON.stringify(await getPost(id)));
  };
  return { call, post, json, login, action, connect, getPost, awaitStatus, draft };
}

test('Meta webhook verifies the challenge and authenticates the unchanged raw body without merchant login', async t => {
  const api = await runtime(t, () => assert.fail('Graph should not be called'));
  const webhook = 'meta/webhook';
  const challenge = webhook + '?hub.mode=subscribe&hub.challenge=109204&hub.verify_token=';
  assert.equal((await api.call(challenge + 'wrong')).status, 403);
  const verified = await api.call(challenge + verifyToken);
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get('cache-control'), 'no-store');
  assert.equal(await verified.text(), '109204');

  const send = (body, signature) => api.call(webhook, {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
  });
  const raw = '{ "object":"instagram", "entry": [] }\n';
  const signature = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  assert.equal((await send(raw)).status, 403);
  assert.equal((await send(raw.trim(), signature)).status, 403);
  assert.equal((await send(raw, signature)).status, 200);
  assert.equal((await send('x'.repeat(1024 * 1024 + 1), signature)).status, 413);
});

test('Meta mode protects merchant state, direct writes, uploads and merchant sockets', async t => {
  const api = await runtime(t, () => assert.fail('Graph should not be called'));
  for (const [path, init] of [
    ['state', {}], ['meta/status', {}], ['actions', { method: 'POST' }],
    ['photo', { method: 'POST' }], ['ws?view=merchant', { headers: { upgrade: 'websocket' } }],
  ]) assert.equal((await api.call(path, init)).status, 401, path);
  assert.equal((await api.call('public')).status, 200);
  assert.equal((await api.post('session', { username: 'haihai', password: key }, { origin: 'https://evil.example', 'x-forwarded-host': 'branddna.test' })).status, 403);
  await api.login();
  assert.equal((await api.post('actions', { type: 'demo.reset' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await api.call('state')).status, 200);
});

test('Instagram OAuth, import, nullable insights and scheduled JPEG publish share durable state', async t => {
  let publications = 0;
  let publishedCaption;
  let remoteCreated = false;
  let entered;
  const sending = new Promise(resolve => { entered = resolve; });
  let release;
  const response = new Promise(resolve => { release = resolve; });
  t.after(release);
  const api = await runtime(t, async (url, req) => {
    const path = url.pathname.slice('/v27.0/'.length);
    switch (path) {
      case 'oauth/access_token': return { access_token: 'ig-private-token', expires_in: 3600 };
      case 'debug_token': return { data: { app_id: '101', is_valid: true, scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights'] } };
      case 'me': return { client_business_id: '777' };
      case 'me/assigned_instagram_accounts': return { data: [{ id: '201', username: 'test_truck' }] };
      case '201/media':
        if (req.method === 'GET') return { data: [{
          id: '900', caption: '既有的品牌貼文', media_type: 'IMAGE', timestamp: remoteDate,
          permalink: 'https://www.instagram.com/p/existing/', media_url: 'https://scontent.cdninstagram.com/existing.jpg',
        }, ...(remoteCreated ? [{ id: '902', caption: publishedCaption, media_type: 'IMAGE', timestamp: remoteDate,
          permalink: 'https://www.instagram.com/p/published/' }] : [])] };
        const content = await req.formData();
        publishedCaption = content.get('caption');
        assert.match(content.get('image_url'), /^https:\/\/branddna\.test\/api\/truck\/media\/.+\.jpg$/);
        return { id: '901' };
      case '901': return { status_code: 'FINISHED' };
      case '201/content_publishing_limit': return { data: [{ quota_usage: 3, config: { quota_total: 50 } }] };
      case '201/media_publish':
        publications++;
        assert.equal((await req.formData()).get('creation_id'), '901');
        remoteCreated = true;
        entered();
        await response;
        return { id: '902' };
      case '902': return { permalink: 'https://www.instagram.com/p/published/' };
      case '900/insights':
      case '902/insights':
        return { data: [{ name: 'reach', values: [{ value: 19 }] }, { name: 'likes', values: [{ value: 0 }] }] };
      default: assert.fail('Unexpected Graph path: ' + path);
    }
  });
  await api.login();
  await api.connect('instagram', '201');
  assert.equal((await api.json(api.post('meta/import', { platform: 'instagram' }))).imported, 1);
  assert.equal((await api.json(api.post('meta/import', { platform: 'instagram' }))).imported, 0);
  const id = await api.draft('instagram', '201');
  assert.equal((await api.post('actions', { type: 'post.publish', payload: { id } })).status, 409);
  const { version } = (await api.getPost(id)).meta;
  assert.equal((await api.post('meta/queue', { id, version: 'stale-version' })).status, 409);
  await api.json(api.post('meta/queue', { id, version, scheduledAt: new Date(Date.now() + 500).toISOString() }));
  await Promise.race([sending, new Promise((_, reject) => setTimeout(() => reject(new Error('Publish did not start')), 2500))]);
  const duringPublish = await api.json(api.post('meta/import', { platform: 'instagram' }));
  assert.equal(duringPublish.imported, 1);
  release();
  const p = await api.awaitStatus(id, 'published');
  const state = (await api.json(api.call('state'))).state;
  assert.equal(state.posts.filter(post => post.meta?.remoteId === '902').length, 1);
  assert.equal(state.posts.find(post => post.meta?.remoteId === '900').meta.thumbnail, 'https://scontent.cdninstagram.com/existing.jpg');
  assert.equal(p.meta.remoteId, '902');
  assert.equal(publications, 1);
  assert.equal((await api.post('meta/queue', { id })).status, 409);
  await api.json(api.post('meta/insights/sync', {}));
  const synced = await api.getPost(id);
  assert.equal(synced.metrics.reach, 19);
  assert.equal(synced.metrics.likes, 0);
  assert.equal(synced.metrics.clicks, null);
  const { result } = await api.action('analytics.feedback', { mode: 'meta' });
  assert.match(result.source.content, /201.+902/s);
  assert.doesNotMatch(result.source.content, /模擬/);
  await api.action('demo.reset', {});
  assert.equal((await api.getPost(id)).meta.remoteId, '902');
});

test('Facebook publish with a lost response stays unknown without an automatic retry', async t => {
  let sends = 0;
  let caption;
  const api = await runtime(t, async (url, req) => {
    switch (url.pathname.slice('/v27.0/'.length)) {
      case 'oauth/access_token': return { access_token: 'fb-private-token', expires_in: 3600 };
      case 'debug_token': return { data: { app_id: '101', is_valid: true, scopes: ['pages_read_engagement', 'pages_manage_posts', 'read_insights'] } };
      case 'me/accounts': return { data: [{ id: '301', name: 'Test Page', access_token: 'page-private-token', tasks: ['CREATE_CONTENT', 'ANALYZE'] }] };
      case '301/photos': {
        sends++;
        const photo = await req.formData();
        assert.equal(photo.get('published'), 'true');
        caption = photo.get('caption');
        return {}; // The remote may have acted, but we did not get a post ID.
      }
      case '301/posts': return { data: [{ id: '301_1011', message: caption, created_time: new Date().toISOString(), permalink_url: 'https://www.facebook.com/301/posts/1011' }] };
      case '301/feed': {
        const content = await req.formData();
        assert.match(content.get('message'), /本機發文驗收/);
        if (content.get('link')) assert.equal(content.get('link'), 'https://example.com/menu');
        return { id: content.get('link') ? '301_1012' : '301_1013' };
      }
      case '301_1012':
      case '301_1013': return { permalink_url: 'https://www.facebook.com/301/posts/1012' };
      default: assert.fail('Unexpected Facebook call: ' + url.pathname);
    }
  });
  await api.login();
  await api.connect('facebook', '301');
  const id = await api.draft('facebook', '301');
  const { version } = (await api.getPost(id)).meta;
  await api.json(api.post('meta/queue', { id, version }));
  assert.equal((await api.awaitStatus(id, 'unknown')).status, 'approved');
  assert.equal((await api.post('meta/queue', { id })).status, 409);
  assert.equal(sends, 1);
  const imported = await api.json(api.post('meta/import', { platform: 'facebook' }));
  const candidate = imported.state.posts.find(post => post.meta?.remoteId === '301_1011');
  await api.json(api.post('meta/reconcile', { id, importId: candidate.id }));
  assert.equal((await api.getPost(id)).meta.remoteId, '301_1011');
  for (const kind of ['link', 'text']) {
    const postId = await api.draft('facebook', '301', { kind, ...(kind === 'link' ? { link: 'https://example.com/menu' } : {}) });
    await api.json(api.post('meta/queue', { id: postId, version: (await api.getPost(postId)).meta.version }));
    assert.equal((await api.awaitStatus(postId, 'published')).meta.remoteId, kind === 'link' ? '301_1012' : '301_1013');
  }
});
