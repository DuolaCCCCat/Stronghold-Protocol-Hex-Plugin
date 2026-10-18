// 作战统计 in the spectator seat: whose rows the panel shows, and the contract behind it. The panel is a CORE feature
// (public/js/ui/combatMetrics.js + battle/runner.js `combatMetrics({ ownerId })` + battle/metrics.js) — no ui plugin is
// involved, and the numbers are read out of the viewer's OWN local replica of the watched battle, so they are the
// watched player's own numbers rather than a sampled channel reply:
//   * `watchedPlayerId` — the `n:<playerId>` field the page watches, and only that;
//   * `pickOwner` — the seat the panel reads by default (the teammate on screen, then the one whose replica was just
//     dropped, then the viewer), and what an explicit pick does;
//   * `pickRound` — the round the 「本轮」 scope lands on.
// The runner half of the contract (the battle on screen is the one `ownerId` is read from, and a teammate's damage is
// never mixed into the own reading) is asserted with the real runner rig in test/match/runner.test.js («own battle
// statistics stay available when viewing a teammate»); a real match with three browsers is
// test/e2e/out/spectator-core-check.mjs (local verification script, not part of the suite).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { watchedPlayerId, pickOwner, pickRound } = await import('../../public/js/ui/combatMetrics.js');

const PLAYERS = [{ playerId: 'me', name: '自己' }, { playerId: 'mate', name: '队友甲' }, { playerId: 'other', name: '队友乙' }];
/** A runner whose replica is gone: only the teammate watched last is still named. */
const runnerWith = (lastWatched = null) => ({ lastWatchedOwner: () => lastWatched });

describe('watchedPlayerId — the field the page watches names its player', () => {
  test('a teammate replica (`n:<playerId>`) names that player', () => {
    assert.equal(watchedPlayerId('n:mate', 'me'), 'mate');
    assert.equal(watchedPlayerId('n:other', 'me'), 'other');
  });

  test('the own field is not somebody else’s: it names nobody', () => {
    assert.equal(watchedPlayerId('n:me', 'me'), null, 'watching the own replica must not switch the panel away from 自己');
  });

  test('a shared / boss field, no field and an empty id name nobody', () => {
    assert.equal(watchedPlayerId('boss:1', 'me'), null);
    assert.equal(watchedPlayerId('unite:2', 'me'), null);
    assert.equal(watchedPlayerId(null, 'me'), null);
    assert.equal(watchedPlayerId('', 'me'), null);
    assert.equal(watchedPlayerId('n:', 'me'), null);
  });
});

describe('pickOwner — the seat the panel reads', () => {
  test('the default (`watched`) follows the teammate on screen', () => {
    assert.equal(pickOwner('watched', 'n:mate', PLAYERS, 'me', runnerWith()), 'mate');
    assert.equal(pickOwner('watched', 'n:other', PLAYERS, 'me', runnerWith()), 'other');
  });

  test('an explicit seat is kept while that seat exists', () => {
    assert.equal(pickOwner('other', 'n:mate', PLAYERS, 'me', runnerWith()), 'other', 'a pinned seat wins over the watched one');
  });

  test('a teammate whose replica was dropped is still named (the kept round answers)', () => {
    assert.equal(pickOwner('watched', null, PLAYERS, 'me', runnerWith('mate')), 'mate');
  });

  test('with nothing watched and nothing remembered the viewer reads themself', () => {
    assert.equal(pickOwner('watched', null, PLAYERS, 'me', runnerWith()), 'me');
    assert.equal(pickOwner('watched', 'n:me', PLAYERS, 'me', runnerWith()), 'me', 'the own field keeps the own rows');
  });

  test('a seat that is not in the match any more falls back to the follow rules', () => {
    assert.equal(pickOwner('ghost', 'n:mate', PLAYERS, 'me', runnerWith()), 'mate');
    assert.equal(pickOwner('ghost', null, PLAYERS, 'me', runnerWith('other')), 'other');
  });
});

describe('pickRound — the round 「本轮」 lands on', () => {
  test('the round the match is in, when it has a record', () => {
    assert.equal(pickRound([1, 2, 3], 3), 3);
    assert.equal(pickRound([2], 2), 2);
  });

  test('the newest round at or below the match round (the one just settled)', () => {
    assert.equal(pickRound([1, 2], 4), 2);
    assert.equal(pickRound([1, 2, 2], 2), 2);
  });

  test('nothing at or below it, nothing recorded, no round at all: the match round itself', () => {
    assert.equal(pickRound([5], 3), 3);
    assert.equal(pickRound([], 3), 3);
    assert.equal(pickRound(null, 3), 3);
    assert.equal(pickRound([2, 3], undefined), 0);
  });
});
