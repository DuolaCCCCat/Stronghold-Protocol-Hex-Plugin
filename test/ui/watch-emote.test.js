// Watch emotes (观战表情, 2026-10-18): the per-screen side of a pulse, the sender's exclusion (it shows the combo,
// never a fall), the fall parameters, the pulse accumulation (a click storm sends ≤ 2 messages for 85 clicks in
// 300 ms, and every receiving screen still makes exactly 85 falls), and the wire shape. There is no life gate: the
// button is usable whenever another player's board is on screen (screens/game.js renders it only then; the browser
// suite covers that). The server relay is covered in test/match/connection.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  watchEmoteSide, watchRainSide, rainBurst, particleLife, RAIN, WATCH_EMOTE_COMBO_HOLD_MS, WATCH_EMOTE_NOTICE_HOLD_MS,
  WATCH_EMOTE_REPLAY_MS, rememberWatchEvent, takeWatchReplay, clearWatchReplay,
} from '../../public/js/ui/watchEmote.js';
import {
  createEmotePulse, WATCH_EMOTE_PULSE_MS, WATCH_EMOTE_DRAG_PX, WATCH_EMOTE_EDGE_PX, WATCH_EMOTE_POS_KEY, WATCH_EMOTE_COMBO_KEY,
  WATCH_EMOTE_OWN_RAIN_KEY, WATCH_EMOTE_SELECTION_KEY, normalizeWatchSelection, watchDragMoved, clampWatchPos, pickRandomEmote,
} from '../../public/js/ui/emotes.js';
import { WATCH_EMOTE_COUNT_MAX, WATCH_EMOTE_RATE_MS, SENDABLE_EMOTES } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';

describe('which screen a watch emote belongs to', () => {
  test('an event belongs to the watched player, the watcher, or neither', () => {
    const e = { playerId: 'watcher', id: 'custom_amiya_sit', watch: 'p_1' };
    assert.equal(watchEmoteSide(e, { myId: 'p_1', watchingOther: true, watchedPid: 'p_1' }), 'target');
    assert.equal(watchEmoteSide(e, { myId: 'p_2', watchingOther: true, watchedPid: 'p_1' }), 'watcher');
    assert.equal(watchEmoteSide(e, { myId: 'p_2', watchingOther: false, watchedPid: null }), null);
    assert.equal(watchEmoteSide(e, { myId: 'p_2', watchingOther: true, watchedPid: 'p_3' }), null);
    assert.equal(watchEmoteSide({ playerId: 'a', id: 'x' }, { myId: 'a' }), null, 'an ordinary 交流 emote');
    assert.equal(watchEmoteSide(null, {}), null);
    assert.equal(watchEmoteSide({ watch: '' }, {}), null);
  });

  test('the target always falls, a watcher of it falls, the sender only with its switch on', () => {
    const e = { playerId: 'p_1', id: 'custom_amiya_sit', watch: 'p_3' };
    const watching = { myId: 'p_1', watchingOther: true, watchedPid: 'p_3' };
    assert.equal(watchRainSide(e, { ...watching, ownRains: true }), 'sender', 'sender, switch on');
    assert.equal(watchRainSide(e, { ...watching, ownRains: false }), null, 'sender, switch off');
    assert.equal(watchRainSide(e, { myId: 'p_2', watchingOther: true, watchedPid: 'p_3' }), 'watcher', 'another viewer of B');
    assert.equal(watchRainSide(e, { myId: 'p_2', watchingOther: false, watchedPid: null }), null, 'not watching B at all');
    assert.equal(watchRainSide(e, { myId: 'p_2', watchingOther: true, watchedPid: 'p_4' }), null, 'watching somebody else');
    assert.equal(watchRainSide(e, { myId: 'p_3' }), 'target', 'the target always falls');
    assert.equal(watchRainSide(null, { myId: 'p_1' }), null);
    // the combo window is 1.5–2 s
    assert.ok(WATCH_EMOTE_COMBO_HOLD_MS >= 1500 && WATCH_EMOTE_COMBO_HOLD_MS <= 2000, String(WATCH_EMOTE_COMBO_HOLD_MS));
    assert.equal(WATCH_EMOTE_NOTICE_HOLD_MS, 2000);
  });
});

describe('2 s replay cache', () => {
  test('cached per target, counts preserved, expired entries dropped', () => {
    clearWatchReplay();
    assert.equal(WATCH_EMOTE_REPLAY_MS, 2000);
    rememberWatchEvent({ watch: 'b', playerId: 'a', id: 'x', count: 2, at: 1000 }, 1000);
    rememberWatchEvent({ watch: 'b', playerId: 'a', id: 'y', at: 1200 }, 1200);
    rememberWatchEvent({ watch: 'c', playerId: 'a', id: 'z', count: 5, at: 1000 }, 1000);
    assert.deepEqual(takeWatchReplay('b', 2500).map((e) => [e.id, e.count]), [['x', 2], ['y', 1]], 'per target, counts kept');
    assert.deepEqual(takeWatchReplay('c', 2500).map((e) => e.count), [5]);
    assert.deepEqual(takeWatchReplay('b', 3201), [], 'older than 2 s is gone');
    clearWatchReplay();
    assert.deepEqual(takeWatchReplay('b', 1000), []);
  });
});

describe('fall parameters (rainBurst)', () => {
  test('one click = one drop; each drop is inside the field and has its own random lane / clock / speed', () => {
    const singles = rainBurst();
    assert.equal(singles.length, 1, 'no hidden burst: the pulse count is the number of falls');
    for (let n = 1; n <= 12; n++) {
      const drops = rainBurst(Math.random, n);
      assert.equal(drops.length, n, `count ${n}`);
      for (const p of drops) {
        assert.ok(Number.isInteger(p.lane) && p.lane >= 0 && p.lane < RAIN.LANES, JSON.stringify(p));
        assert.ok(p.left >= RAIN.LEFT_MIN * 100 && p.left <= RAIN.LEFT_MAX * 100, `left ${p.left}`);
        assert.ok(p.delay >= 0 && p.delay <= RAIN.DELAY_MAX_MS, `delay ${p.delay}`);
        assert.ok(p.duration >= RAIN.DURATION_MIN_MS && p.duration <= RAIN.DURATION_MAX_MS, `duration ${p.duration}`);
        assert.ok(p.sway >= RAIN.SWAY_MIN_REM && p.sway <= RAIN.SWAY_MAX_REM, `sway ${p.sway}`);
        assert.ok(p.spin >= RAIN.SPIN_MIN_DEG && p.spin <= RAIN.SPIN_MAX_DEG, `spin ${p.spin}`);
        assert.ok(p.size >= RAIN.SIZE_MIN_REM && p.size <= RAIN.SIZE_MAX_REM, `size ${p.size}`);
        assert.ok(p.delay + p.duration >= particleLife(p) - 100);
      }
    }
  });

  test('a pulse count expands to exactly that many drops — 85 clicks → 85 falls, all independently random', () => {
    const drops = rainBurst(Math.random, 85);
    assert.equal(drops.length, 85);
    const lefts = new Set(drops.map((p) => p.left));
    const delays = new Set(drops.map((p) => p.delay));
    assert.ok(lefts.size > 10, `distinct horizontal positions (${lefts.size})`);
    assert.ok(delays.size > 10, `distinct delays (${delays.size})`);
    assert.equal(rainBurst(Math.random, 1).length, 1);
    assert.equal(rainBurst(Math.random, 0).length, 1, 'never zero drops for a click');
    assert.equal(rainBurst(() => 0.5, 12).length, 12);
  });
});

describe('draggable watch-emote button', () => {
  test('the 5 px threshold separates a click from a drag', () => {
    assert.equal(WATCH_EMOTE_DRAG_PX, 5);
    assert.equal(watchDragMoved(0, 0), false);
    assert.equal(watchDragMoved(3, 3), false, '4.2 px is still a click');
    assert.equal(watchDragMoved(5, 0), false, 'exactly 5 px is still a click');
    assert.equal(watchDragMoved(0, 6), true);
    assert.equal(watchDragMoved(40, 0), true);
    assert.equal(watchDragMoved(-30, 10), true);
  });

  test('positions are clamped to the screen with an 8 px margin', () => {
    const rect = { width: 1600, height: 900 };
    const [w, h] = [56, 56];
    assert.deepEqual(clampWatchPos({ x: 100, y: 200 }, rect, w, h), { x: 100, y: 200 });
    assert.deepEqual(clampWatchPos({ x: -500, y: -500 }, rect, w, h), { x: WATCH_EMOTE_EDGE_PX, y: WATCH_EMOTE_EDGE_PX });
    assert.deepEqual(clampWatchPos({ x: 5000, y: 5000 }, rect, w, h),
      { x: rect.width - w - WATCH_EMOTE_EDGE_PX, y: rect.height - h - WATCH_EMOTE_EDGE_PX });
    assert.deepEqual(clampWatchPos({ x: NaN, y: undefined }, rect, w, h), { x: WATCH_EMOTE_EDGE_PX, y: WATCH_EMOTE_EDGE_PX });
    const small = clampWatchPos({ x: 999, y: 999 }, { width: 40, height: 30 }, 56, 56);
    assert.deepEqual(small, { x: WATCH_EMOTE_EDGE_PX, y: WATCH_EMOTE_EDGE_PX }, 'a host smaller than the button keeps the margin');
    assert.equal(WATCH_EMOTE_EDGE_PX, 8);
    assert.equal(WATCH_EMOTE_POS_KEY, 'watchEmotePos', 'stored as sp.pref.watchEmotePos (one global spot)');
  });
});

describe('random ? option', () => {
  test('draws a sendable id, and 20 draws pick at least two different ids', () => {
    assert.equal(pickRandomEmote(() => 0), SENDABLE_EMOTES[0]);
    assert.equal(pickRandomEmote(() => 0.999999), SENDABLE_EMOTES[SENDABLE_EMOTES.length - 1]);
    let i = 0;
    const seen = new Set();
    for (let k = 0; k < 20; k++) seen.add(pickRandomEmote(() => (i++ % 7) / 10)); // a stub with variety
    assert.ok(seen.size >= 2, [...seen].join(','));
    for (const id of seen) assert.ok(SENDABLE_EMOTES.includes(id));
  });

  test('a window with several ids sends one message per id, counts add up, and the id cap folds the rest', () => {
    const sent = [];
    const pulse = createEmotePulse({ onSend: (id, count) => sent.push([id, count]), maxIds: 6 });
    for (const id of ['a', 'b', 'a', 'c', 'a']) pulse.click(id);
    assert.equal(pulse.pending, 5);
    pulse.flush();
    assert.deepEqual(sent, [['a', 3], ['b', 1], ['c', 1]], 'one message per id, clicks grouped');
    assert.equal(sent.reduce((n, [, c]) => n + c, 0), 5);
    sent.length = 0;
    const capped = createEmotePulse({ onSend: (id, count) => sent.push([id, count]), maxIds: 2 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) capped.click(id);
    assert.equal(capped.pending, 5, 'no click is lost at the cap');
    capped.flush();
    assert.equal(sent.length, 2, 'at most maxIds messages');
    assert.equal(sent.reduce((n, [, c]) => n + c, 0), 5);
  });

  test('the display switches are persisted under their own keys, both defaulting on', () => {
    assert.equal(WATCH_EMOTE_COMBO_KEY, 'watchEmoteCombo');
    assert.equal(WATCH_EMOTE_OWN_RAIN_KEY, 'watchEmoteOwnRain');
    assert.equal(WATCH_EMOTE_POS_KEY, 'watchEmotePos');
    assert.equal(WATCH_EMOTE_SELECTION_KEY, 'watchEmoteSelection');
  });

  test('a stored watch selection is validated: a sendable id, ?, null, or a stale id', () => {
    assert.deepEqual(normalizeWatchSelection(SENDABLE_EMOTES[0]), { random: false, picked: SENDABLE_EMOTES[0], valid: true });
    assert.deepEqual(normalizeWatchSelection('?'), { random: true, picked: null, valid: true });
    assert.deepEqual(normalizeWatchSelection(null), { random: false, picked: null, valid: true });
    assert.deepEqual(normalizeWatchSelection('no_such_emote'), { random: false, picked: null, valid: false });
    assert.deepEqual(normalizeWatchSelection(42), { random: false, picked: null, valid: false });
  });
});

describe('multi-id pulse (random ? mode)', () => {
  test('one message per id (a random window can pick several), counts summing to the clicks', () => {
    const sent = [];
    const pulse = createEmotePulse({
      onSend: (id, count) => sent.push([id, count]), maxIds: 6, setTimer: () => 1, clearTimer: () => {},
    });
    pulse.click('a'); pulse.click('b'); pulse.click('a');
    assert.equal(pulse.flush(), 3);
    assert.deepEqual(sent, [['a', 2], ['b', 1]]);
    pulse.flush();
    assert.deepEqual(sent, [['a', 2], ['b', 1]], 'an empty window sends nothing');
  });
});

describe('pulse accumulation (one message per 200 ms window)', () => {
  const fakeClock = () => {
    let t = 0;
    let seq = 0;
    const timers = [];
    const setTimer = (fn, ms) => { const id = ++seq; timers.push({ id, at: t + ms, fn }); return id; };
    const clearTimer = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
    const due = () => {
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= t) timers.shift().fn();
    };
    return { setTimer, clearTimer, due, at: (v) => { t = v; }, now: () => t };
  };

  test('85 clicks in 300 ms → at most 2 messages, and the counts add up to all 85 clicks', () => {
    const clock = fakeClock();
    const sent = [];
    const pulse = createEmotePulse({
      windowMs: 200, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      onSend: (id, count) => sent.push({ id, count, at: clock.now() }),
    });
    for (let i = 0; i < 85; i++) {
      clock.at(Math.round(((i + 1) * 300) / 85));
      pulse.click('custom_amiya_cheer');
      clock.due();
    }
    pulse.flush(); // leaving the watch: the open window goes out at once
    assert.ok(sent.length <= 2, `85 clicks must not make 85 messages (got ${sent.length})`);
    assert.equal(sent.reduce((n, m) => n + m.count, 0), 85, 'every click is counted exactly once');
    assert.equal(sent.reduce((n, m) => n + m.count, 0), 85);
    for (const m of sent) assert.equal(m.id, 'custom_amiya_cheer');
    assert.ok(WATCH_EMOTE_PULSE_MS >= 150 && WATCH_EMOTE_PULSE_MS <= 250, 'the window is 150–250 ms');
    assert.ok(WATCH_EMOTE_RATE_MS <= WATCH_EMOTE_PULSE_MS, 'the server floor leaves room for the client window');
  });

  test('the timer alone sends the window; flush / discard / switching the face behave', () => {
    const clock = fakeClock();
    const sent = [];
    const pulse = createEmotePulse({
      windowMs: 200, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      onSend: (id, count) => sent.push({ id, count }),
    });
    pulse.click('a'); pulse.click('a'); pulse.click('a');
    assert.equal(pulse.pending, 3);
    clock.at(200); clock.due();
    assert.deepEqual(sent, [{ id: 'a', count: 3 }]);
    assert.equal(pulse.pending, 0, 'the window closed');
    pulse.click('b'); pulse.click('b');
    pulse.flush();
    assert.deepEqual(sent, [{ id: 'a', count: 3 }, { id: 'b', count: 2 }]);
    pulse.click('c'); pulse.click('c');
    pulse.discard();
    pulse.flush();
    assert.equal(sent.length, 2, 'a discarded window is never sent');
    assert.equal(pulse.click(''), 0, 'an empty id is not counted');
  });
});

describe('wire shape (g.emote { id, watch?, count? })', () => {
  test('watch / count are accepted within bounds and refused outside them', () => {
    assert.equal(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', watch: 'p_1', count: 85 }), null);
    assert.equal(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', watch: 'p_1' }), null);
    assert.equal(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', count: 1 }), null);
    assert.notEqual(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', watch: 7 }), null);
    assert.notEqual(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', count: 0 }), null);
    assert.notEqual(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', count: 1.5 }), null);
    assert.notEqual(validateC2S({ t: 'g.emote', id: 'custom_amiya_sit', count: WATCH_EMOTE_COUNT_MAX + 1 }), null);
    assert.notEqual(validateC2S({ t: 'g.emote', id: 'custom_nope', watch: 'p_1' }), null);
  });
});
