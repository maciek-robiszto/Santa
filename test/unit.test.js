import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { drawAssignments, DrawError } from '../src/draw.js';
import { createCipher, hashPassword, verifyPassword } from '../src/crypto.js';
import { html, safeUrl } from '../src/html.js';
import * as v from '../src/validate.js';

const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('draw: permutation, no self, single cycle', () => {
  for (let n = 3; n <= 40; n++) {
    const m = drawAssignments(ids(n));
    assert.equal(m.size, n);
    assert.equal(new Set(m.values()).size, n);
    for (const [g, r] of m) assert.notEqual(g, r);
    // follow the cycle from 1 – must visit everyone
    let cur = 1, steps = 0;
    do { cur = m.get(cur); steps++; } while (cur !== 1);
    assert.equal(steps, n);
  }
});

test('draw: respects exclusions', () => {
  const excl = [[1, 2], [3, 4], [5, 6]];
  for (let i = 0; i < 200; i++) {
    const m = drawAssignments(ids(6), excl);
    for (const [a, b] of excl) {
      assert.notEqual(m.get(a), b);
      assert.notEqual(m.get(b), a);
    }
  }
});

test('draw: impossible constraints and too few people', () => {
  assert.throws(() => drawAssignments([1, 2]), DrawError);
  assert.throws(() => drawAssignments([1, 2, 3], [[1, 2], [1, 3]]), DrawError);
});

test('draw: roughly uniform recipients', () => {
  const counts = new Map();
  for (let i = 0; i < 3000; i++) {
    const r = drawAssignments(ids(5)).get(1);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  assert.equal(counts.size, 4);
  for (const c of counts.values()) assert.ok(c > 600 && c < 900, `count ${c}`);
});

test('cipher: round-trip and AAD binding', () => {
  const c = createCipher(crypto.randomBytes(32));
  const blob = c.encrypt('42', 'assignment:1:7');
  assert.equal(c.decrypt(blob, 'assignment:1:7'), '42');
  assert.throws(() => c.decrypt(blob, 'assignment:1:8'));
  assert.notEqual(c.encrypt('42', 'x'), c.encrypt('42', 'x'));
  const other = createCipher(crypto.randomBytes(32));
  assert.throws(() => other.decrypt(blob, 'assignment:1:7'));
});

test('password hashing', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(await verifyPassword('correct horse battery', h));
  assert.ok(!(await verifyPassword('wrong password!!', h)));
});

test('html escapes and safeUrl', () => {
  assert.equal(String(html`<p>${'<script>"x"</script>'}</p>`), '<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p>');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
});

test('validators', () => {
  assert.equal(v.safeNext('//evil.com'), '/');
  assert.equal(v.safeNext('/\\evil.com'), '/');
  assert.equal(v.safeNext('https://evil.com'), '/');
  assert.equal(v.safeNext('/events/3'), '/events/3');
  assert.equal(v.url('instagram.com/maker').value, 'https://instagram.com/maker');
  assert.ok(v.url('javascript:alert(1)').error);
  assert.ok(v.email('nope').error);
  assert.equal(v.text('a\r\nb\u0000', 10).value, 'a\nb');
});
