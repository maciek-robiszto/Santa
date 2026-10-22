import crypto from 'node:crypto';

export class DrawError extends Error {}

function shuffle(items, randomInt) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Draws a Secret Santa assignment using a cryptographically secure RNG.
 *
 * Prefers a single random cycle (A→B→C→…→A): nobody draws themselves, there
 * are no mutual pairs and no one can infer anything from closed sub-groups.
 * With exclusions that make a single cycle impossible it falls back to a
 * randomized backtracking search (still avoiding mutual pairs when possible).
 *
 * @param {number[]} ids participant ids
 * @param {Array<[number, number]>} exclusions pairs that must not draw each other (both ways)
 * @returns {Map<number, number>} giver id → recipient id
 */
export function drawAssignments(ids, exclusions = [], randomInt = crypto.randomInt) {
  if (new Set(ids).size !== ids.length) throw new DrawError('Zduplikowani uczestnicy');
  if (ids.length < 3) throw new DrawError('Do losowania potrzeba co najmniej 3 osób');

  const excluded = new Set(exclusions.map(([a, b]) => pairKey(a, b)));
  const allowed = (giver, recipient) => giver !== recipient && !excluded.has(pairKey(giver, recipient));

  for (let attempt = 0; attempt < 5000; attempt++) {
    const order = shuffle(ids, randomInt);
    let ok = true;
    for (let i = 0; i < order.length && ok; i++) ok = allowed(order[i], order[(i + 1) % order.length]);
    if (ok) return new Map(order.map((g, i) => [g, order[(i + 1) % order.length]]));
  }

  return backtrack(ids, allowed, randomInt, true) ?? backtrack(ids, allowed, randomInt, false) ?? fail();
}

function fail() {
  throw new DrawError('Nie da się wylosować par przy obecnych wykluczeniach – usuń część z nich.');
}

function backtrack(ids, allowed, randomInt, avoidMutual) {
  const givers = shuffle(ids, randomInt);
  const result = new Map();
  const used = new Set();
  let steps = 0;

  const solve = (idx) => {
    if (idx === givers.length) return true;
    if (++steps > 200_000) return false;
    const giver = givers[idx];
    for (const recipient of shuffle(ids, randomInt)) {
      if (used.has(recipient) || !allowed(giver, recipient)) continue;
      if (avoidMutual && result.get(recipient) === giver) continue;
      result.set(giver, recipient);
      used.add(recipient);
      if (solve(idx + 1)) return true;
      result.delete(giver);
      used.delete(recipient);
    }
    return false;
  };

  return solve(0) ? result : null;
}
