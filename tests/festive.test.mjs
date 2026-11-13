import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFestival, festiveMark, FESTIVAL_IDS } from '../pages/static/truck/festive.mjs';

// Noon in Taipei on the given date.
const at = date => Date.parse(`${date}T12:00:00+08:00`);
const on = date => currentFestival(at(date), false)?.id ?? null;

test('festive logo follows the Taipei calendar for all ten festivals', () => {
  assert.equal(FESTIVAL_IDS.length, 10);
  assert.equal(on('2026-11-12'), null);
  assert.equal(on('2026-12-17'), null);
  assert.equal(on('2026-12-18'), 'christmas');
  assert.equal(on('2026-12-25'), 'christmas');
  assert.equal(on('2026-12-31'), 'newyear');
  assert.equal(on('2027-01-02'), 'newyear');
  assert.equal(on('2027-01-03'), null);
  assert.equal(on('2027-02-06'), 'lunar'); // 春節 2027
  assert.equal(on('2027-02-11'), 'lunar'); // 初六
  assert.equal(on('2027-02-14'), 'valentine');
  assert.equal(on('2027-02-15'), null);
  assert.equal(on('2027-02-20'), 'lantern'); // 元宵 2027
  assert.equal(on('2027-05-09'), 'mother'); // 2nd Sunday of May 2027
  assert.equal(on('2027-05-10'), null);
  assert.equal(on('2027-06-09'), 'dragonboat');
  assert.equal(on('2027-08-08'), 'qixi');
  assert.equal(on('2027-09-15'), 'midautumn');
  assert.equal(on('2027-10-31'), 'halloween');
  // Taipei midnight, not UTC midnight: 12-18 00:30 in Taipei is still 12-17 in UTC.
  assert.equal(currentFestival(Date.parse('2026-12-18T00:30:00+08:00'), false)?.id, 'christmas');
});

test('festive mark wraps the logo only on festival days', () => {
  assert.equal(festiveMark('<svg></svg>', null), '<svg></svg>');
  const html = festiveMark('<svg></svg>', { id: 'christmas', name: '聖誕節', greeting: '聖誕快樂' });
  assert.match(html, /class="festive festive-christmas"/);
  assert.match(html, /fx-hat/);
  assert.match(html, /fx-snowcap/);
  assert.match(html, /fx-snow/);
  assert.match(html, /aria-hidden="true"/);
});
