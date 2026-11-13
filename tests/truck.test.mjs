import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const compiledDir = mkdtempSync(join(tmpdir(), 'branddna-truck-tests-'));
after(() => rmSync(compiledDir, { recursive: true, force: true }));
async function load(entry, name) {
  const bundled = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22' });
  const compiledPath = join(compiledDir, name);
  writeFileSync(compiledPath, bundled.outputFiles[0].text);
  return import(pathToFileURL(compiledPath).href);
}
const { seedTruckState, applyTruckAction, mutateTruckState, handleTruckRequest, publicView, referencedMediaKeys, normalizeTruckState, TRUCK_LIMITS, TRUCK_FIELD_LIMITS } = await load('api/src/routes/truck.ts', 'truck.mjs');
const { planPersist, rebuildState, emptyIndex } = await load('api/src/truck-store.ts', 'truck-store.mjs');
const { TONES, AUDIENCES, BASELINE } = await import('../pages/static/truck/brand-libraries.mjs');
const NOW = '2026-11-05T02:00:00.000Z';
function act(state, type, payload = {}) { return applyTruckAction(state, type, payload, NOW); }

test('content must be approved again after an edit and only approved content can be scheduled', () => {
  let state = seedTruckState(NOW);
  const generated = act(state, 'post.generate', { platform: 'instagram', topic: '週末餐車限定優惠' });
  state = generated.state;
  const id = generated.result.post.id;
  assert.equal(generated.result.post.mode, 'demo');
  assert.match(generated.result.post.caption, /週末餐車限定優惠/);
  assert.throws(() => act(state, 'post.schedule', { id, scheduledAt: '2026-11-06T03:00:00Z' }), /審核/);
  state = act(state, 'post.approve', { id }).state;
  assert.throws(() => act(state, 'post.schedule', { id, scheduledAt: '2026-11-04T03:00:00Z' }), /未來/);
  state = act(state, 'post.schedule', { id, scheduledAt: '2026-11-06T03:00:00Z' }).state;
  assert.equal(state.posts.find(p => p.id === id).status, 'scheduled');
  state = act(state, 'post.schedule', { id, scheduledAt: '2026-11-07T03:00:00Z' }).state;
  assert.equal(state.posts.find(p => p.id === id).scheduledAt, '2026-11-07T03:00:00.000Z');
  assert.equal(state.posts.find(p => p.id === id).status, 'scheduled');
  state = act(state, 'post.update', { id, caption: '調整後的文案' }).state;
  const edited = state.posts.find(p => p.id === id);
  assert.equal(edited.status, 'draft');
  assert.equal(edited.scheduledAt, null);
  assert.throws(() => act(state, 'post.publish', { id }), /審核/);
});

test('server prices orders from available menu items and requires each fulfillment step', () => {
  const state = seedTruckState(NOW);
  state.menu = [{ id: 'meal', name: '示範飯盒', price: 120, available: true, category: '主餐', description: '', image: '' }];
  const created = act(state, 'order.create', { customer: { name: '小海', phone: '0912345678', lineBound: true }, items: [{ menuId: 'meal', quantity: 2, price: 1 }], total: 1, note: '少飯' });
  const order = created.result.order;
  assert.equal(order.total, 240);
  assert.deepEqual(order.items, [{ menuId: 'meal', name: '示範飯盒', price: 120, quantity: 2 }]);
  assert.equal(order.status, 'new');
  assert.throws(() => act(created.state, 'order.status', { id: order.id, status: 'ready' }), /順序/);
  let next = created.state;
  for (const status of ['accepted', 'preparing', 'ready', 'completed']) next = act(next, 'order.status', { id: order.id, status }).state;
  assert.equal(next.orders.find(o => o.id === order.id).status, 'completed');
  assert.throws(() => act(next, 'order.status', { id: order.id, status: 'new' }), /順序/);
});

test('unavailable items, duplicate quantity overflow, unknown items, invalid quantities and empty customers cannot create orders', () => {
  const state = seedTruckState(NOW);
  state.menu = [{ id: 'meal', name: '飯盒', price: 120, available: true }, { id: 'sold', name: '售完', price: 50, available: false }];
  const base = { customer: { name: '小海', phone: '0912345678', lineBound: false } };
  for (const items of [[{ menuId: 'sold', quantity: 1 }], [{ menuId: 'missing', quantity: 1 }], [{ menuId: 'meal', quantity: 0 }], [{ menuId: 'meal', quantity: 1.5 }], [{ menuId: 'meal', quantity: 99 }, { menuId: 'meal', quantity: 2 }], []]) {
    assert.throws(() => act(state, 'order.create', { ...base, items }));
  }
  assert.throws(() => act(state, 'order.create', { customer: { name: '', phone: '' }, items: [{ menuId: 'meal', quantity: 1 }] }));
});

test('LINE demo member binding deduplicates phone and links orders without trusting a different member', () => {
  let state = seedTruckState(NOW);
  const saved = act(state, 'member.save', { name: '小海', phone: '0912-345-678', lineBound: true });
  state = saved.state;
  const id = saved.result.member.id;
  const again = act(state, 'member.save', { name: '小海同學', phone: '0912345678', lineBound: true });
  assert.equal(again.result.member.id, id);
  const created = act(again.state, 'order.create', { customer: { name: '小海同學', phone: '0912345678', lineBound: true }, memberId: id, items: [{ menuId: state.menu[0].id, quantity: 1 }] });
  assert.equal(created.result.order.memberId, id);
  assert.equal(created.result.order.customer.lineBound, true);
  assert.throws(() => act(again.state, 'order.create', { customer: { name: '別人', phone: '0988888888', lineBound: true }, memberId: id, items: [{ menuId: state.menu[0].id, quantity: 1 }] }), /會員/);
});

test('diagnosis analyzes sources, generation uses diagnosis, and feedback persists a measurable performance source', () => {
  let state = seedTruckState(NOW);
  const added = act(state, 'source.add', { title: '餐車新公告', type: 'instagram', content: '週末在台北服務，提供預訂取餐。' });
  const sourceId = added.result.source.id;
  state = act(added.state, 'diagnosis.run').state;
  assert.equal(state.sources.find(s => s.id === sourceId).status, 'analyzed');
  assert.equal(state.archetypes.length, 12);
  assert.equal(state.diagnosis.status, 'ready');
  const generated = act(state, 'post.generate', { platform: 'facebook', topic: '台北週末出攤' });
  assert.match(generated.result.post.caption, /海海人生/);
  assert.match(generated.result.post.caption, /台北週末出攤/);
  state = act(generated.state, 'analytics.feedback').state;
  assert.equal(state.diagnosis.feedbackAt, NOW);
  assert.ok(state.sources.some(s => s.type === 'performance' && /觸及/.test(s.content)));
});

test('stall edits validate time order and menu edits cannot lower a price below zero', () => {
  let state = seedTruckState(NOW);
  assert.throws(() => act(state, 'stall.save', { title: '市集', date: '2026-11-08', start: '17:00', end: '11:00', location: '台北' }), /時間/);
  const added = act(state, 'stall.save', { title: '週末市集', date: '2026-11-08', start: '11:00', end: '17:00', location: '台北', notes: '' });
  state = act(added.state, 'stall.save', { ...added.result.stall, title: '週末限定市集' }).state;
  assert.equal(state.stalls.find(s => s.id === added.result.stall.id).title, '週末限定市集');
  state = act(state, 'stall.delete', { id: added.result.stall.id }).state;
  assert.ok(!state.stalls.some(s => s.id === added.result.stall.id));
  assert.throws(() => act(state, 'menu.save', { name: '示範品項', price: -1 }), /價格/);
});

test('order display numbers remain unique across UTC midnight within one Taipei business day', () => {
  const state = seedTruckState(NOW);
  const payload = { customer: { name: '顧客', phone: '0955555555' }, items: [{ menuId: state.menu[0].id, quantity: 1 }] };
  const first = applyTruckAction(state, 'order.create', payload, '2026-11-04T17:00:00.000Z');
  const second = applyTruckAction(first.state, 'order.create', payload, '2026-11-05T01:00:00.000Z');
  assert.equal(first.result.order.number, 'H1105-001');
  assert.equal(second.result.order.number, 'H1105-002');
});

test('truck reset removes custom orders and leaves a new revision for concurrent readers', () => {
  const seeded = seedTruckState(NOW);
  const saved = act(seeded, 'source.add', { title: '自訂內容', type: 'note', content: '下週市集' });
  const reset = act(saved.state, 'demo.reset');
  assert.ok(!reset.state.sources.some(s => s.title === '自訂內容'));
  assert.equal(reset.state.revision, 2);
  assert.equal(reset.state.orders.length, seedTruckState(NOW).orders.length);
});

test('phone is required for members and guests; a signed-in member orders without retyping it', () => {
  const initial = seedTruckState(NOW);
  const menuId = initial.menu[0].id;
  assert.throws(() => act(initial, 'member.save', { name: '旅人甲' }), /手機/);
  assert.throws(() => act(initial, 'order.create', { customer: { name: '旅人丙', phone: '' }, items: [{ menuId, quantity: 1 }] }), /手機/);
  assert.throws(() => act(initial, 'member.save', { name: '旅人甲', phone: '12345' }), /有效/);
  const first = act(initial, 'member.save', { name: '旅人甲', phone: '0900111222' });
  const second = act(first.state, 'member.save', { name: '旅人乙', phone: '0900333444' });
  assert.notEqual(first.result.member.id, second.result.member.id);
  assert.equal(first.result.member.phone, '0900***222');
  const guest = act(second.state, 'order.create', { customer: { name: '旅人丙', phone: '0900555666' }, items: [{ menuId, quantity: 1 }] });
  assert.equal(guest.result.order.memberId, null);
  const bound = act(second.state, 'order.create', { customer: { name: '旅人乙' }, memberId: second.result.member.id, items: [{ menuId, quantity: 1 }] });
  assert.equal(bound.result.order.memberId, second.result.member.id);
  assert.equal(bound.result.order.customer.phone, '0900333444');
});

test('discount codes: amount, percent, buy-one-get-one, minimum spend, member-only and once per member', () => {
  let state = seedTruckState(NOW);
  const [main, pasta] = state.menu;
  const line = (item, quantity) => ({ menuId: item.id, quantity });
  state = act(state, 'coupon.create', { code: 'save15', kind: 'amount', value: 15, minSpend: 150, maxUses: 2 }).state;
  state = act(state, 'coupon.create', { code: 'TENOFF', kind: 'percent', value: 10 }).state;
  state = act(state, 'coupon.create', { code: 'BOGOMAIN', kind: 'bogo', itemId: main.id }).state;
  assert.throws(() => act(state, 'coupon.create', { code: 'SAVE15', kind: 'amount', value: 5 }), /已經存在/);
  const guest = { customer: { name: '客人', phone: '0900000001' } };
  assert.throws(() => act(state, 'order.create', { ...guest, items: [line(main, 1)], couponCode: 'SAVE15' }), /滿 NT\$150/);
  const saved = act(state, 'order.create', { ...guest, items: [line(main, 1), line(pasta, 1)], couponCode: 'save15' });
  assert.deepEqual([saved.result.order.subtotal, saved.result.order.discount.amount, saved.result.order.total], [220, 15, 205]);
  assert.equal(saved.state.coupons.find(c => c.code === 'SAVE15').uses, 1);
  assert.throws(() => act(saved.state, 'order.create', { ...guest, items: [line(main, 2)], couponCode: 'SAVE15' }), /使用過/);
  assert.equal(act(state, 'order.create', { ...guest, items: [line(pasta, 2)], couponCode: 'TENOFF' }).result.order.total, 216);
  assert.throws(() => act(state, 'order.create', { ...guest, items: [line(main, 1)], couponCode: 'BOGOMAIN' }), /2 份/);
  assert.equal(act(state, 'order.create', { ...guest, items: [line(main, 3)], couponCode: 'BOGOMAIN' }).result.order.total, 200);
  // Seeded comeback code only works for the churned members it was pushed to.
  assert.throws(() => act(state, 'order.create', { ...guest, items: [line(main, 2)], couponCode: 'BACK40' }), /會員專屬/);
  const member = state.members.find(m => m.id === 'demo-member-004');
  assert.equal(act(state, 'order.create', { customer: { name: member.name }, memberId: member.id, items: [line(main, 1)], couponCode: 'BACK40' }).result.order.total, 60);
});

test('an existing phone joins from the customer page only on its own device or with the code the truck hands over', () => {
  let state = seedTruckState(NOW);
  const owner = state.members.find(m => m.id === 'demo-member-001');
  // Someone typing another member's phone gets neither the membership nor a renamed member.
  assert.throws(() => act(state, 'member.join', { name: '冒用者', phone: owner.phone }), /登入碼/);
  assert.equal(state.members.find(m => m.id === owner.id).name, owner.name);
  // The device that already holds the membership signs in again without a code.
  assert.equal(act(state, 'member.join', { name: owner.name, phone: owner.phone, memberId: owner.id }).result.member.id, owner.id);
  // A code is required, expires, and allows five wrong tries.
  assert.throws(() => act(state, 'member.join', { name: owner.name, phone: owner.phone, loginCode: '123456' }), /失效/);
  const issued = act(state, 'member.loginCode', { id: owner.id });
  assert.match(issued.result.code, /^\d{6}$/);
  state = issued.state;
  const wrong = issued.result.code === '000000' ? '111111' : '000000';
  const miss = act(state, 'member.join', { name: owner.name, phone: owner.phone, loginCode: wrong });
  assert.match(miss.result.error, /不正確/);
  assert.equal(miss.result.member, undefined);
  assert.equal(miss.state.members.find(m => m.id === owner.id).loginCode.attempts, 1);
  const signed = act(miss.state, 'member.join', { name: owner.name, phone: owner.phone, loginCode: issued.result.code });
  assert.equal(signed.result.member.id, owner.id);
  assert.equal(signed.state.members.find(m => m.id === owner.id).loginCode, null);
  assert.throws(() => applyTruckAction(state, 'member.join', { name: owner.name, phone: owner.phone, loginCode: issued.result.code }, '2026-11-05T02:11:00.000Z'), /失效/);
  let tries = state;
  for (let i = 0; i < 5; i++) tries = act(tries, 'member.join', { name: owner.name, phone: owner.phone, loginCode: wrong }).state;
  assert.throws(() => act(tries, 'member.join', { name: owner.name, phone: owner.phone, loginCode: issued.result.code }), /失效/);
  // New phones still join directly.
  assert.ok(act(state, 'member.join', { name: '新朋友', phone: '0900987654' }).result.member.id);
});

test('orders can skip 已接單, step back after a mis-tap, be cancelled with the code returned, and be completed in bulk', () => {
  let state = seedTruckState(NOW);
  const main = state.menu[0];
  const created = act(state, 'order.create', { customer: { name: '小海', phone: '0912000111' }, items: [{ menuId: main.id, quantity: 2 }], couponCode: 'IG20' });
  const id = created.result.order.id;
  const coupon = created.state.coupons.find(c => c.code === 'IG20');
  assert.equal(coupon.uses, 1);
  state = act(created.state, 'order.status', { id, status: 'preparing' }).state;
  assert.equal(state.orders.find(o => o.id === id).status, 'preparing');
  state = act(state, 'order.status', { id, status: 'new' }).state;
  assert.equal(state.orders.find(o => o.id === id).status, 'new');
  const cancelled = act(state, 'order.cancel', { id, reason: '餐點售完' });
  const order = cancelled.state.orders.find(o => o.id === id);
  assert.deepEqual([order.status, order.cancelReason], ['cancelled', '餐點售完']);
  const released = cancelled.state.coupons.find(c => c.code === 'IG20');
  assert.equal(released.uses, 0);
  assert.equal(released.usedBy.includes('0912000111'), false);
  assert.throws(() => act(cancelled.state, 'order.status', { id, status: 'accepted' }), /已取消/);
  assert.throws(() => act(cancelled.state, 'order.cancel', { id }), /無法取消/);
  // The same customer can use the returned code again.
  assert.equal(act(cancelled.state, 'order.create', { customer: { name: '小海', phone: '0912000111' }, items: [{ menuId: main.id, quantity: 2 }], couponCode: 'IG20' }).result.order.discount.code, 'IG20');
  const ready = state.orders.filter(o => o.status === 'ready').length;
  const bulk = act(state, 'order.completeReady');
  assert.equal(bulk.result.completed, ready);
  assert.equal(bulk.state.orders.filter(o => o.status === 'ready').length, 0);
});

test('paused ordering rejects new customer orders and the customer page can follow several of its own orders', () => {
  let state = seedTruckState(NOW);
  const main = state.menu[0];
  state = act(state, 'settings.update', { ordering: { paused: true, message: '今天休息，週六見！' } }).state;
  assert.equal(publicView(state, {}, NOW).ordering.paused, true);
  assert.throws(() => act(state, 'order.create', { customer: { name: '小海', phone: '0912000111' }, items: [{ menuId: main.id, quantity: 1 }] }), /週六見/);
  state = act(state, 'settings.update', { ordering: { paused: false } }).state;
  const first = act(state, 'order.create', { customer: { name: 'A', phone: '0912000111' }, items: [{ menuId: main.id, quantity: 1 }] });
  const second = act(first.state, 'order.create', { customer: { name: 'B', phone: '0912000222' }, items: [{ menuId: main.id, quantity: 1 }] }, );
  const ids = [second.result.order.id, first.result.order.id];
  const view = publicView(second.state, { order: ids.join(',') }, NOW);
  assert.deepEqual(view.myOrders.map(o => o.id), ids);
  assert.equal(view.order.id, ids[0]);
  const queued = second.state.orders.filter(o => ['new', 'accepted', 'preparing'].includes(o.status)).length;
  assert.equal(view.myOrders[0].ahead, queued - 1);
  assert.equal(view.orders, undefined);
});

test('performance feedback updates its one source instead of adding copies', () => {
  let state = seedTruckState(NOW);
  const count = () => state.sources.filter(s => s.type === 'performance' && s.title === '貼文成效回饋' && s.mode !== 'meta').length;
  state = act(state, 'analytics.feedback').state;
  const first = state.sources[0].id;
  state = act(state, 'analytics.feedback').state;
  assert.equal(count(), 1);
  assert.equal(state.sources[0].id, first);
});

test('completing the member profile issues one reward code and shows up in the member center', () => {
  let state = seedTruckState(NOW);
  const demographics = { gender: '女', birthYear: 1995, city: '台北市', district: '大安區', occupation: '上班族', income: '4–6 萬', household: '單身', diet: ['不吃辣'], channel: 'Instagram' };
  assert.throws(() => act(state, 'member.save', { name: '小海', phone: '0900123123', demographics }), /同意/);
  assert.throws(() => act(state, 'member.save', { name: '小海', phone: '0900123123', consent: true, demographics: { ...demographics, income: '一百萬' } }), /月收入/);
  const joined = act(state, 'member.save', { name: '小海', phone: '0900123123', consent: true, demographics });
  assert.equal(joined.result.member.profileComplete, true);
  assert.match(joined.result.reward.code, /^HI[A-Z2-9]{6}$/);
  state = joined.state;
  // A district must belong to its city, and cannot be picked before the city.
  assert.throws(() => act(state, 'member.profile', { memberId: joined.result.member.id, demographics: { ...demographics, city: '新北市' } }), /新北市沒有「大安區」/);
  assert.throws(() => act(state, 'member.profile', { memberId: joined.result.member.id, demographics: { ...demographics, city: '' } }), /先選擇居住縣市/);
  // Editing later: consent was already given, optional answers can be cleared, the name can change, no second reward.
  const again = act(state, 'member.profile', { memberId: joined.result.member.id, name: '小海海', demographics: { ...demographics, city: '新北市', district: '板橋區', diet: [], household: '' } });
  assert.equal(again.result.reward, undefined);
  const edited = again.state.members.find(m => m.id === joined.result.member.id);
  assert.equal(edited.name, '小海海');
  assert.deepEqual([edited.demographics.city, edited.demographics.district, edited.demographics.household, edited.demographics.diet], ['新北市', '板橋區', '', []]);
  assert.equal(act(state, 'member.profile', { memberId: joined.result.member.id, demographics: { ...demographics, city: '臺北市' } }).state.members.find(m => m.id === joined.result.member.id).demographics.city, '台北市');
  // The member's own view carries their saved answers so the customer page can show and edit them.
  assert.equal(publicView(again.state, { member: joined.result.member.id }, NOW).member.demographics.district, '板橋區');
  const later = act(state, 'member.save', { name: '晚來的人', phone: '0900456456' });
  assert.equal(later.result.reward, undefined);
  assert.throws(() => act(later.state, 'member.profile', { memberId: later.result.member.id, consent: true, demographics: { gender: '男' } }), /出生年/);
  const filled = act(later.state, 'member.profile', { memberId: later.result.member.id, consent: true, demographics });
  assert.ok(filled.result.reward.code);
  const view = publicView(filled.state, { member: later.result.member.id }, NOW);
  assert.equal(view.member.profileComplete, true);
  assert.ok(view.offers.some(o => o.code === filled.result.reward.code));
  assert.equal(view.member.phone, '0900***456');
});

test('sold out today returns tomorrow automatically; unlisted items are hidden from customers', () => {
  let state = seedTruckState(NOW);
  const [main, pasta] = state.menu;
  state = act(state, 'menu.soldout', { id: main.id }).state;
  state = act(state, 'menu.listing', { id: pasta.id, available: false }).state;
  const order = { customer: { name: '客人', phone: '0900000002' } };
  assert.throws(() => act(state, 'order.create', { ...order, items: [{ menuId: main.id, quantity: 1 }] }), /售完/);
  const today = publicView(state, {}, NOW);
  assert.equal(today.menu.find(m => m.id === main.id).soldOut, true);
  assert.ok(!today.menu.some(m => m.id === pasta.id));
  const tomorrow = '2026-11-06T02:00:00.000Z';
  assert.equal(publicView(state, {}, tomorrow).menu.find(m => m.id === main.id).soldOut, false);
  assert.equal(applyTruckAction(state, 'order.create', { ...order, items: [{ menuId: main.id, quantity: 1 }] }, tomorrow).result.order.total, 100);
  state = act(state, 'menu.restock').state;
  assert.equal(state.menu.find(m => m.id === main.id).soldOutOn, null);
});

test('idle-post assistant prepares one draft after three quiet days and stays quiet otherwise', () => {
  let state = seedTruckState(NOW);
  // The seed has a scheduled post in the future: nothing to do.
  assert.equal(act(state, 'assistant.check').result.skipped, 'scheduled');
  state.posts = state.posts.filter(p => p.status === 'published');
  state.posts.forEach(p => { p.createdAt = p.publishedAt = '2026-10-30T02:00:00.000Z'; });
  const checked = act(state, 'assistant.check');
  const draft = checked.result.post;
  assert.equal(draft.suggested, true);
  assert.equal(draft.status, 'draft');
  assert.equal(checked.state.assistant.suggestionPostId, draft.id);
  assert.ok(checked.state.assistant.idleDays >= 3);
  // A stall within three days makes the outing preview the suitable topic.
  assert.equal(draft.topicKey, 'stall');
  const again = act(checked.state, 'assistant.check');
  assert.equal(again.noop, true);
  const dismissed = act(checked.state, 'assistant.dismiss', { discard: true });
  assert.ok(!dismissed.state.posts.some(p => p.id === draft.id));
  const withAi = applyTruckAction(state, 'assistant.check', {}, NOW, { ai: { title: 'AI 標題', caption: 'AI 寫的文案', cardTitle: '字卡' } });
  assert.equal(withAi.result.post.caption, 'AI 寫的文案');
  assert.equal(withAi.result.post.engine, 'ai');
});

test('post generation uses model output when valid and falls back to templates otherwise', () => {
  const state = seedTruckState(NOW);
  const ai = applyTruckAction(state, 'post.generate', { platform: 'instagram', topic: '週末出車' }, NOW, { ai: { title: '週末見', caption: '週末見！#海海人生', cardTitle: '' } });
  assert.equal(ai.result.post.caption, '週末見！#海海人生');
  assert.equal(ai.result.engine, 'ai');
  const fallback = applyTruckAction(state, 'post.generate', { platform: 'instagram', topic: '週末出車' }, NOW, { ai: { caption: '' }, aiError: 'AI 暫時無法回應，已改用內建範本。' });
  assert.equal(fallback.result.engine, 'rules');
  assert.match(fallback.result.post.caption, /週末出車/);
  assert.equal(fallback.result.aiNotice, 'AI 暫時無法回應，已改用內建範本。');
  assert.doesNotMatch(fallback.result.post.caption, /示範|課程/);
});

test('diagnosis covers five dimensions, with or without the model, using only the libraries', () => {
  const toneLabels = new Set(TONES.map(tone => tone.label));
  const audienceLabels = new Set(AUDIENCES.map(audience => audience.label));
  const rules = act(seedTruckState(NOW), 'diagnosis.run').state.diagnosis;
  for (const key of ['positioning', 'toneNote']) assert.ok(rules[key]);
  for (const key of ['tone', 'audience', 'differentiation', 'pillars']) assert.ok(rules[key].length >= 2, key);
  assert.ok(rules.tone.every(label => toneLabels.has(label)), 'rule tones come from the tone library');
  assert.ok(rules.audiences.every(row => audienceLabels.has(row.label)), 'rule audiences come from the audience library');
  assert.ok(rules.pillars.every(pillar => pillar.topics.length >= 2), 'every pillar suggests post topics');
  // The comparison lists every baseline line in order; the advantages become the differentiation.
  assert.deepEqual(rules.comparison.map(row => row.id), BASELINE.map(row => row.id));
  assert.deepEqual(rules.differentiation, rules.comparison.filter(row => row.verdict === 'advantage').map(row => `${row.label}：${row.store}`));
  assert.equal(rules.comparison.find(row => row.id === 'ordering').verdict, 'advantage');
  assert.equal(rules.comparison.find(row => row.id === 'ordering').basis, 'data');

  const ai = applyTruckAction(seedTruckState(NOW), 'diagnosis.run', {}, NOW, { ai: {
    summary: 'S', positioning: 'P', tone: ['warm', 'clear', 'not-in-library'], toneNote: 'N',
    audiences: [{ id: 'students', situation: '下課後結伴來' }, { id: 'made-up', situation: 'x' }],
    comparison: [{ id: 'story', store: '有清楚的品牌理念', verdict: 'advantage' }, { id: 'ordering', store: '偽造', verdict: 'advantage' }, { id: 'price', store: '平均 NT$110', verdict: 'weaker' }],
    pillars: [{ title: 'T', detail: 'X', topics: ['主題一', '主題二'] }, { title: 'U', detail: 'Y', topics: [] }], archetypes: [{ id: 'hero', score: 99 }]
  } });
  const d = ai.state.diagnosis;
  assert.equal(d.engine, 'ai');
  assert.equal(ai.state.archetypes.find(a => a.id === 'hero').score, 99);
  assert.deepEqual(d.tone, ['溫暖親切', '資訊清楚']);
  assert.deepEqual(d.audiences, [{ label: '學生族群', situation: '下課後結伴來' }]);
  assert.deepEqual(d.audience, ['學生族群：下課後結伴來']);
  const row = id => d.comparison.find(item => item.id === id);
  assert.deepEqual([row('story').verdict, row('story').basis], ['advantage', 'ai']);
  // Data-measured lines are never taken from the model; unknown verdicts are not trusted.
  assert.notEqual(row('ordering').store, '偽造');
  assert.equal(row('price').verdict, 'unknown');
  assert.equal(row('ingredients').verdict, 'unknown');
  assert.deepEqual(d.pillars.map(pillar => pillar.topics.length), [2, 2]);
  // Without a single library tone the model output is not used.
  assert.equal(applyTruckAction(seedTruckState(NOW), 'diagnosis.run', {}, NOW, { ai: { positioning: 'P', tone: ['溫暖'] } }).state.diagnosis.engine, 'rules');
});

test('hot topics: clustered from the fetched feeds, hottest playable three with joke hooks, high-risk ones set aside', () => {
  let state = seedTruckState(NOW);
  const signals = {
    headlines: [
      { id: 'h1', title: '黃仁勳請辭輝達', source: '鉅亨網', url: 'https://news.example.tw/nvda-1' },
      { id: 'h2', title: '黃仁勳下台掀風暴', source: '自由財經', url: 'https://news.example.tw/nvda-2' },
      { id: 'h3', title: '颱風逼近 多地停班停課', source: '公視', url: 'https://news.example.tw/typhoon' },
      { id: 'h4', title: '任天堂新作銷量創紀錄', source: 'Yahoo', url: 'https://news.example.tw/game' },
      { id: 'h5', title: '偽造', source: 'x', url: 'javascript:alert(1)' }
    ],
    searches: [{ id: 's1', title: '輝達', traffic: '5萬+', sources: [{ title: '輝達股價', url: 'https://news.example.tw/stock', source: '經濟日報' }] }]
  };
  // A forged client payload cannot add topics.
  const forged = act(state, 'trends.refresh', { signals });
  assert.equal(forged.state.trends.items.length, 0);
  assert.match(forged.state.trends.error, /暫時抓不到/);
  assert.ok(forged.state.trends.seasonal.length >= 1);
  const hook = (title, code) => ({ title, angle: '自嘲投資失利，推薦一盤炒麵', topic: `${title}：今天來吃炒麵`, offerLabel: '輝達跌、炒麵也跌：結帳折 NT$20', offerKind: 'amount', offerValue: 20, offerCode: code });
  const ai = { topics: [
    { name: '颱風', summary: '颱風逼近', refs: ['h3'], buzz: 5, riskLevel: 'high', riskNote: '不建議搭這個話題', hashtags: ['颱風'], hooks: [hook('颱風天', 'TY10')] },
    { name: '新遊戲', summary: '新作熱賣', refs: ['h4'], buzz: 2, riskLevel: 'low', riskNote: '注意商標', hashtags: [], hooks: [hook('邊吃邊玩', 'GAME10')] },
    { name: '黃仁勳／輝達', summary: '黃仁勳請辭，輝達股價震盪', refs: ['h1', 'h2', 's1', 'h5', 'h99'], buzz: 4, riskLevel: 'medium', riskNote: '別給投資建議', hashtags: ['#輝達'],
      hooks: [hook('買輝達賠錢，只好來吃炒麵', 'nvda-20!'), { ...hook('輝達打折，我們也打折', 'NVDA9'), offerKind: 'percent', offerValue: 90 }, hook('', 'X')] }
  ] };
  state = applyTruckAction(state, 'trends.refresh', {}, NOW, { prepared: { signals }, ai }).state;
  const { items, avoid } = state.trends;
  assert.deepEqual(items.map(item => item.title), ['黃仁勳／輝達', '新遊戲']);
  assert.deepEqual(avoid.map(item => item.title), ['颱風']);
  assert.deepEqual(avoid[0].hooks, []);
  const nvda = items[0];
  // Links come only from the feeds the model cited; unknown refs and unsafe URLs are dropped.
  assert.deepEqual(nvda.sources.map(source => source.url), ['https://news.example.tw/nvda-1', 'https://news.example.tw/nvda-2', 'https://news.example.tw/stock']);
  assert.equal(nvda.hooks.length, 2);
  assert.deepEqual(nvda.hooks[0].offer, { label: '輝達跌、炒麵也跌：結帳折 NT$20', kind: 'amount', value: 20, code: 'NVDA20' });
  assert.equal(nvda.hooks[1].offer.value, 50);
  assert.deepEqual(nvda.hashtags, ['輝達']);

  // Writing from a hook with the 時事 code: the caption tells customers the code; sources stay with the owner.
  state = act(state, 'coupon.create', { code: 'NVDA20', kind: 'amount', value: 20, label: '輝達跌、炒麵也跌：結帳折 NT$20', days: 3 }).state;
  const post = act(state, 'post.generate', { platform: 'instagram', topic: nvda.hooks[0].topic, trendId: nvda.id, hookId: nvda.hooks[0].id, couponCode: 'nvda20' }).result.post;
  assert.equal(post.topicKey, 'trend');
  assert.deepEqual([post.trend.title, post.trend.hook.title, post.trend.couponCode], ['黃仁勳／輝達', '買輝達賠錢，只好來吃炒麵', 'NVDA20']);
  assert.match(post.caption, /^買輝達賠錢，只好來吃炒麵！/);
  assert.match(post.caption, /結帳輸入折扣碼 NVDA20：輝達跌、炒麵也跌：結帳折 NT\$20（11\/08 前有效）\n\n#/);
  assert.doesNotMatch(post.caption, /news\.example/);
  assert.throws(() => act(state, 'post.generate', { platform: 'instagram', topic: 'x', couponCode: 'NOPE99' }), /找不到可以使用的折扣碼 NOPE99/);
  // A failed fetch later the same day keeps the morning's topics.
  assert.equal(applyTruckAction(state, 'trends.refresh', {}, NOW, { prepared: { signals: null, error: '連不上' } }).state.trends.items.length, 2);
  // Without the model: the top search spikes, each with one plain hook and a starter offer.
  const rules = applyTruckAction(seedTruckState(NOW), 'trends.refresh', {}, NOW, { prepared: { signals } }).state.trends;
  assert.deepEqual([rules.engine, rules.items[0].title, rules.items[0].hooks[0].offer.code], ['rules', '輝達', 'HOT1105']);
});

test('Google Trends feed is ranked by search volume and every topic carries a reference link', async () => {
  const { parseTrendsFeed } = await load('api/src/truck-ai.ts', 'truck-ai.mjs');
  const item = (title, traffic, news = '') => `<item><title>${title}</title><ht:approx_traffic>${traffic}</ht:approx_traffic>${news}</item>`;
  const news = '<ht:news_item><ht:news_item_title>標題 &amp; 副標</ht:news_item_title><ht:news_item_url>https://news.example.tw/1</ht:news_item_url><ht:news_item_source>報社</ht:news_item_source></ht:news_item>';
  const topics = parseTrendsFeed(`<rss><channel>${item('小話題', '500+')}${item('大新聞', '2,000+', news)}${item('中話題', '1000+')}${item('第四', '100+')}</channel></rss>`);
  assert.deepEqual(topics.map(topic => topic.title), ['大新聞', '中話題', '小話題']);
  assert.deepEqual(topics[0].sources, [{ title: '標題 & 副標', url: 'https://news.example.tw/1', source: '報社' }]);
  assert.match(topics[1].sources[0].url, /^https:\/\/news\.google\.com\/search\?q=/);
});

test('Google News headlines become numbered signals with the outlet as source', async () => {
  const { parseNewsFeed } = await load('api/src/truck-ai.ts', 'truck-ai-news.mjs');
  const item = (title, source, link) => `<item><title>${title} - ${source}</title><link>${link}</link><source url="https://x.example">${source}</source></item>`;
  const headlines = parseNewsFeed(`<rss><channel>${item('黃仁勳請辭輝達 &amp; 股價震盪', '鉅亨網', 'https://news.google.com/rss/articles/a')}${item('沒有連結', '某報', 'not-a-url')}${item('任天堂新作', 'Yahoo', 'https://news.google.com/rss/articles/b')}</channel></rss>`);
  assert.deepEqual(headlines, [
    { id: 'h1', title: '黃仁勳請辭輝達 & 股價震盪', source: '鉅亨網', url: 'https://news.google.com/rss/articles/a' },
    { id: 'h2', title: '任天堂新作', source: 'Yahoo', url: 'https://news.google.com/rss/articles/b' }
  ]);
});

test('calendar labels: custom type/colour pairs are remembered and pre-selected for the same kind of post', () => {
  let state = seedTruckState(NOW);
  assert.throws(() => act(state, 'label.save', { name: '節慶', color: 'neon' }), /色票/);
  assert.throws(() => act(state, 'label.save', { name: '出攤', color: 'blue' }), /已經有/);
  const saved = act(state, 'label.save', { name: '節慶活動', color: 'red' });
  state = saved.state;
  const label = saved.result.label;
  const draft = act(state, 'post.generate', { platform: 'instagram', topic: '會員專屬優惠活動', topicKey: 'offer' });
  state = act(draft.state, 'post.approve', { id: draft.result.post.id }).state;
  assert.throws(() => act(state, 'post.schedule', { id: draft.result.post.id, scheduledAt: '2026-11-06T03:00:00Z', label: 'label-missing' }), /找不到這個標籤/);
  state = act(state, 'post.schedule', { id: draft.result.post.id, scheduledAt: '2026-11-06T03:00:00Z', label: label.id }).state;
  assert.equal(state.posts.find(p => p.id === draft.result.post.id).label, label.id);
  assert.equal(state.settings.labelRules.offer, label.id);
  const stall = act(state, 'stall.save', { title: '聖誕市集', date: '2026-12-20', start: '12:00', end: '18:00', location: '廣場', notes: '', label: label.id });
  state = stall.state;
  assert.equal(stall.result.stall.label, label.id);
  // Editing a stall without choosing again keeps its label; deleting the label returns events to their default colour.
  state = act(state, 'stall.save', { id: stall.result.stall.id, title: '聖誕市集', date: '2026-12-20', start: '12:00', end: '19:00', location: '廣場', notes: '' }).state;
  assert.equal(state.stalls.find(s => s.id === stall.result.stall.id).label, label.id);
  state = act(state, 'label.delete', { id: label.id }).state;
  assert.equal(state.stalls.find(s => s.id === stall.result.stall.id).label, undefined);
  assert.equal(state.posts.find(p => p.id === draft.result.post.id).label, undefined);
  assert.deepEqual(state.settings.labelRules, {});
});

test('segment push creates a member-only code that appears in each recipient member center', () => {
  const state = seedTruckState(NOW);
  const recipients = ['demo-member-002', 'demo-member-003'];
  const sent = act(state, 'campaign.send', { segment: 'potential', segmentLabel: '潛在客', kind: 'activity', title: '第二份買一送一', message: '這週限定', recipients, offer: { kind: 'bogo', itemId: state.menu[0].id }, days: 7 });
  const { campaign, coupon } = sent.result;
  assert.deepEqual(coupon.memberIds, recipients);
  assert.match(campaign.message, new RegExp(coupon.code));
  const inbox = publicView(sent.state, { member: 'demo-member-002' }, NOW);
  assert.ok(inbox.inbox.some(m => m.id === campaign.id));
  assert.ok(inbox.offers.some(o => o.code === coupon.code));
  assert.equal(publicView(sent.state, { member: 'demo-member-001' }, NOW).inbox.some(m => m.id === campaign.id), false);
  assert.throws(() => act(state, 'campaign.send', { segment: 'x', segmentLabel: 'x', title: 't', message: 'm', recipients: [], offer: { kind: 'amount', value: 10 } }), /沒有可推播/);
});

test('version-1 workspaces drop sample labels and gain the new collections', () => {
  const v1 = seedTruckState(NOW);
  delete v1.workspace; delete v1.coupons; delete v1.campaigns; delete v1.settings; delete v1.assistant; delete v1.trends;
  v1.members = [{ id: 'demo-member-001', name: '示範顧客｜小林', phone: '0911111111', lineBound: true, createdAt: NOW }, { id: 'member-team', name: '團隊測試', phone: '0900999999', lineBound: true, createdAt: NOW }];
  v1.posts[0].caption += '\n\n〔課程示範文案〕';
  v1.menu[0].available = false;
  const upgraded = normalizeTruckState(structuredClone(v1), NOW);
  assert.equal(upgraded.workspace.version, 2);
  assert.ok(upgraded.members.some(m => m.id === 'member-team'));
  assert.equal(upgraded.members.find(m => m.id === 'demo-member-001').name, '林小姐');
  assert.doesNotMatch(JSON.stringify(upgraded), /示範|課程|模擬/);
  assert.ok(Array.isArray(upgraded.coupons) && upgraded.settings.profileReward > 0);
  assert.equal(upgraded.menu[0].available, true);
  assert.equal(upgraded.menu[0].soldOutOn, '2026-11-05');
  assert.deepEqual(normalizeTruckState(structuredClone(upgraded), NOW), upgraded);
});

test('data center sources can be edited, deleted and batch imported', () => {
  let state = seedTruckState(NOW);
  const added = act(state, 'source.add', { title: '舊標題', type: 'note', content: '內容' });
  const id = added.result.source.id;
  state = act(added.state, 'source.update', { id, title: '新標題', type: 'menu', content: '新內容' }).state;
  assert.deepEqual(['新標題', 'menu', '新內容'], ['title', 'type', 'content'].map(k => state.sources.find(s => s.id === id)[k]));
  state = act(state, 'source.delete', { id }).state;
  assert.ok(!state.sources.some(s => s.id === id));
  const batch = act(state, 'source.import', { kind: 'batch', items: [{ title: 'IG 1', type: 'instagram', content: '第一篇' }, { title: 'IG 2', type: 'instagram', content: '第二篇' }] });
  assert.equal(batch.result.imported, 2);
  assert.equal(batch.state.sources[0].title, 'IG 1');
  // Prepared (server-fetched) items are only taken from extras, never from the client payload.
  assert.throws(() => act(state, 'source.import', { kind: 'url', items: [{ title: 'x', content: 'forged' }] }), /沒有可匯入/);
});

test('published posts take manual metrics that feed the data center', () => {
  const generated = act(seedTruckState(NOW), 'post.generate', { platform: 'instagram', topic: '新品' });
  const id = generated.result.post.id;
  assert.throws(() => act(generated.state, 'post.metrics', { id, reach: 1 }), /發布後/);
  let next = act(act(generated.state, 'post.approve', { id }).state, 'post.publish', { id }).state;
  assert.equal(next.posts.find(p => p.id === id).metrics, null);
  next = act(next, 'post.metrics', { id, reach: 500, likes: 40, comments: 3, saves: 7, clicks: 12 }).state;
  assert.equal(next.posts.find(p => p.id === id).metrics.likes, 40);
  const fed = act(next, 'analytics.feedback');
  assert.equal(fed.result.source.title, '貼文成效回饋');
});

test('optional image card title persists as content and changing it invalidates approval', () => {
  const generated = act(seedTruckState(NOW), 'post.generate', { platform: 'instagram', topic: '週末出發' });
  const id = generated.result.post.id;
  assert.equal(generated.result.post.cardTitle, '');
  const approved = act(generated.state, 'post.approve', { id });
  const edited = act(approved.state, 'post.update', { id, cardTitle: '把日常，帶上路' });
  assert.equal(edited.result.post.cardTitle, '把日常，帶上路');
  assert.equal(edited.result.post.status, 'draft');
  assert.throws(() => act(edited.state, 'post.update', { id, cardTitle: '字'.repeat(61) }), /60/);
});

test('verified employment mission informs diagnosis and copy only while present in source evidence', () => {
  const original = seedTruckState(NOW);
  const diagnosed = act(original, 'diagnosis.run');
  assert.match(diagnosed.state.diagnosis.positioning, /自立/);
  const missionPost = act(diagnosed.state, 'post.generate', { platform: 'instagram', topic: '街角相遇' });
  assert.match(missionPost.result.post.caption, /餐飲技能/);
  original.sources = [{ id: 'ordinary', title: '一般餐車', type: 'note', content: '餐車販售餐點，歡迎預訂。', status: 'analyzed', createdAt: NOW }];
  const ordinary = act(original, 'post.generate', { platform: 'instagram', topic: '街角相遇' });
  assert.doesNotMatch(ordinary.result.post.caption, /餐飲技能/);
});

// D1 is external to the reducer; this adapter models the conditional-write boundary,
// including a real competing state edit between SELECT and UPDATE.
class MemoryD1 {
  row = null;
  collide = null;
  withSession() { return this; }
  prepare(sql) {
    const db = this;
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return db.row ? structuredClone(db.row) : null; },
      async run() {
        if (/INSERT OR IGNORE/.test(sql)) {
          if (!db.row) db.row = { state_json: values[0], revision: values[1] };
          return { success: true, meta: { changes: 1 } };
        }
        if (/UPDATE truck_workspace/.test(sql)) {
          if (db.collide) { const fn = db.collide; db.collide = null; fn(db); }
          if (db.row.revision !== values[3]) return { success: true, meta: { changes: 0 } };
          db.row = { state_json: values[0], revision: values[1] };
          return { success: true, meta: { changes: 1 } };
        }
        throw Error('Unexpected SQL: ' + sql);
      }
    };
  }
}

test('CAS retry preserves a concurrent order and increments the shared revision', async () => {
  const db = new MemoryD1();
  const original = seedTruckState(NOW);
  db.row = { state_json: JSON.stringify(original), revision: original.revision };
  const menuId = original.menu[0].id;
  db.collide = other => {
    const competing = act(JSON.parse(other.row.state_json), 'order.create', { customer: { name: '先下單', phone: '0911111111' }, items: [{ menuId, quantity: 1 }] }).state;
    other.row = { state_json: JSON.stringify(competing), revision: competing.revision };
  };
  const result = await mutateTruckState(db, 'order.create', { customer: { name: '後下單', phone: '0922222222' }, items: [{ menuId, quantity: 1 }] }, NOW);
  assert.ok(result.state.orders.some(o => o.customer.name === '先下單'));
  assert.ok(result.state.orders.some(o => o.customer.name === '後下單'));
  assert.equal(result.state.revision, original.revision + 2);
  const persisted = JSON.parse(db.row.state_json);
  assert.equal(persisted.orders.length, original.orders.length + 2);
});

test('HTTP actions reject invalid JSON and expose persistent state through the contract', async () => {
  const DB = new MemoryD1();
  const env = { DB };
  const response = await handleTruckRequest(new Request('http://test/api/truck/state'), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.archetypes.length, 12);
  const malformed = await handleTruckRequest(new Request('http://test/api/truck/actions', { method: 'POST', body: '{' }), env);
  assert.equal(malformed.status, 400);
  const mutation = await handleTruckRequest(new Request('http://test/api/truck/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'member.save', payload: { name: '小海', phone: '0933333333', lineBound: true } }) }), env);
  const data = await mutation.json();
  assert.equal(data.success, true);
  assert.ok(data.result.member.id);
  const after = await handleTruckRequest(new Request('http://test/api/truck/state'), env);
  assert.ok((await after.json()).state.members.some(m => m.phone === '0933333333'));
});

// Models the Durable Object's SQLite tables so the row-level persistence can be checked without the runtime.
function persistTo(table, plan) {
  for (const [k, v] of plan.meta) table.meta.set(k, v);
  for (const row of plan.upserts) table.items.set(`${row.col}/${row.id}`, row);
  for (const row of plan.deletes) table.items.delete(`${row.col}/${row.id}`);
}
function restore(table) {
  return rebuildState([...table.meta].map(([k, v]) => ({ k, v })), [...table.items.values()]);
}

test('row-level workspace persistence rebuilds exactly the in-memory state and writes only touched rows', () => {
  const table = { meta: new Map(), items: new Map() };
  let state = seedTruckState(NOW);
  let index = emptyIndex();
  const step = (type, payload) => {
    const next = act(state, type, payload);
    const plan = planPersist(index, next.state);
    persistTo(table, plan); index = plan.index; state = next.state;
    return { next, plan };
  };
  const initial = planPersist(index, state); persistTo(table, initial); index = initial.index;
  step('source.add', { title: '新來源', type: 'note', content: '溫暖的街角餐車' });
  step('stall.save', { title: '更早的場次', date: '2026-11-01', start: '09:00', end: '10:00', location: '台北' });
  step('menu.save', { name: '新品', price: 80 });
  const order = step('order.create', { customer: { name: '小海', phone: '0912345678' }, items: [{ menuId: state.menu[0].id, quantity: 1 }] }).next.result.order;
  const status = step('order.status', { id: order.id, status: 'accepted' });
  // revision + the order row + one activity row + the sequence counter (unchanged rows are skipped).
  assert.ok(status.plan.upserts.length + status.plan.meta.length <= 4, JSON.stringify(status.plan.upserts.map(r => r.col)));
  step('stall.delete', { id: 'demo-stall-next' });
  assert.deepEqual(restore(table).state, state);
  // Reordering the menu renumbers its rows so the order survives a restart.
  step('menu.move', { id: state.menu.at(-1).id, direction: 'up' });
  assert.deepEqual(restore(table).state.menu.map(m => m.id), state.menu.map(m => m.id));
  step('demo.reset');
  assert.deepEqual(restore(table).state, state);
});

test('customer view exposes only the menu, schedule and the caller own records', () => {
  const state = seedTruckState(NOW);
  const view = publicView(state, { order: 'demo-order-002', member: 'demo-member-001' });
  assert.equal(view.order.id, 'demo-order-002');
  assert.equal(view.member.id, 'demo-member-001');
  assert.equal(view.orders, undefined);
  assert.equal(view.members, undefined);
  assert.doesNotMatch(JSON.stringify(view), /0933333333/);
  assert.equal(publicView(state, {}).order, null);
});

test('collections stay bounded and order numbers never repeat after old orders are trimmed', () => {
  let state = seedTruckState(NOW);
  const payload = { customer: { name: '顧客', phone: '0912345678' }, items: [{ menuId: state.menu[0].id, quantity: 1 }] };
  for (let i = 0; i < TRUCK_LIMITS.orders + 5; i++) state = act(state, 'order.create', payload).state;
  assert.equal(state.orders.length, TRUCK_LIMITS.orders);
  assert.equal(new Set(state.orders.map(order => order.number)).size, TRUCK_LIMITS.orders);
  assert.equal(state.orders[0].number, `H1105-${TRUCK_LIMITS.orders + 5}`);
  assert.equal(state.activity.length, TRUCK_LIMITS.activity);
});

test('media cleanup keeps every photo still referenced by posts, menu or sources', () => {
  const state = seedTruckState(NOW);
  const key = '0123abcd-0000-4000-8000-0123456789ab.webp';
  state.posts[0].image = `/api/truck/media/${key}`;
  state.sources[0].content += `\n圖片位置：/api/truck/media/${key.replace('.webp', '.jpg')}`;
  assert.deepEqual([...referencedMediaKeys(state)].sort(), [key.replace('.webp', '.jpg'), key].sort());
});

test('merchant and customer forms never allow longer input than the API accepts', async () => {
  const { readFileSync } = await import('node:fs');
  const merchant = ['merchant.mjs', 'merchant-ui.mjs', 'merchant-views.mjs', 'merchant-modals.mjs', 'merchant-menu.mjs', 'merchant-members.mjs'].map(name => readFileSync(`pages/static/truck/${name}`, 'utf8')).join('\n');
  const customer = readFileSync('pages/static/truck/customer.mjs', 'utf8');
  const maxlength = (source, attribute) => {
    const match = source.match(new RegExp(`${attribute}[^>]*?maxlength="(\\d+)"`)) || source.match(new RegExp(`maxlength="(\\d+)"[^>]*?${attribute}`));
    assert.ok(match, `maxlength missing for ${attribute}`);
    return Number(match[1]);
  };
  const L = TRUCK_FIELD_LIMITS;
  for (const [attribute, limit] of [['id="source-title"', L.sourceTitle], ['id="source-content"', L.sourceContent], ['id="post-topic"', L.postTopic], ['id="edit-title"', L.postTitle], ['id="edit-caption"', L.postCaption], ['id="edit-card"', L.cardTitle], ['id="stall-title"', L.stallTitle], ['id="stall-location"', L.stallLocation], ['id="stall-notes"', L.stallNotes], ['id="menu-name"', L.menuName], ['id="menu-category"', L.menuCategory], ['id="menu-desc"', L.menuDescription]]) {
    assert.ok(maxlength(merchant, attribute) <= limit, `${attribute} allows more than ${limit}`);
  }
  assert.ok(Number(merchant.match(/id="menu-price"[^>]*max="(\d+)"/)[1]) <= L.menuPriceMax);
  for (const attribute of ['data-field="name"']) assert.ok(maxlength(customer, attribute) <= L.customerName);
  assert.ok(maxlength(customer, 'data-field="note"') <= L.orderNote);
});
