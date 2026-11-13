import { test } from 'node:test';
import assert from 'node:assert/strict';

test('client refuses failed server writes and preserves last authoritative state', async () => {
  const client = await import('../pages/static/truck/client.mjs');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({success:true,state:{revision:1,posts:[]}}) });
  await client.init();
  globalThis.fetch = async () => ({ ok: false, json: async () => ({success:false,error:'請先確認草稿'}) });
  await assert.rejects(client.dispatch('post.publish',{id:'draft'}), /請先確認草稿/);
  assert.equal(client.getState().revision, 1);
});

test('client uses returned server state after mutation', async () => {
  const client = await import('../pages/static/truck/client.mjs');
  globalThis.fetch = async () => ({ ok:true,json:async()=>({success:true,state:{revision:2,orders:[{id:'server-order'}]},result:{order:{id:'server-order'}}}) });
  const result = await client.dispatch('order.create',{items:[]});
  assert.equal(result.result.order.id, 'server-order');
  assert.equal(client.getState().orders[0].id,'server-order');
});

test('a network failure is retried once with the same idempotency key', async () => {
  const client = await import('../pages/static/truck/client.mjs');
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, key: options.headers['Idempotency-Key'] });
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ success: true, state: { revision: 3, orders: [] }, result: { order: { id: 'once' } } }) };
  };
  const result = await client.dispatch('order.create', { items: [] });
  assert.equal(result.result.order.id, 'once');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].key && calls[0].key === calls[1].key);
});

test('customer pages use the public endpoints and keep state on an unchanged (204) poll', async () => {
  const client = await import('../pages/static/truck/client.mjs');
  const urls = [];
  globalThis.fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ success: true, state: { revision: 9, menu: [], order: null } }) }; };
  await client.init({ view: 'public', order: 'order-1' });
  assert.equal(urls.at(-1), '/api/truck/public?order=order-1');
  globalThis.fetch = async url => { urls.push(url); return { ok: true, status: 204 }; };
  await client.refresh();
  assert.equal(urls.at(-1), '/api/truck/public?order=order-1&since=9');
  assert.equal(client.getState().revision, 9);
  await client.dispatch('member.save', { name: 'x' }).catch(() => {});
  assert.equal(urls.at(-1), '/api/truck/public/actions?order=order-1');
});
