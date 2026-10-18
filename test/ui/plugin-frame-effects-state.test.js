// A mounted ui plugin's record must carry its own effect state from the moment it exists (`effects`, and the
// `dj-rotate` fields read next to it). The host's effect helpers run over EVERY mounted frame — `effectWanted` /
// `effectVariant` (both called by `setFieldView`, the match screen's field-view handover) and `rotateHolder` — so a
// missing `effects` does not stay dormant: the first match a browser with any ui plugin switched on mounts throws
// `Cannot read properties of undefined (reading 'has')` inside effectWanted, the handover never reaches
// `setState({ view })` (public/js/ui/fieldHost.js useFieldView), and the board never loads (debug.views: 0).
//
// `mount` is the only place that makes a record and it needs a browser. This test gives it the smallest document the
// mount path touches and drives the host directly: no `window`, so the module's `boot()` stays out of the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The handful of element members `mount` / `place` / `moveFrame` touch. */
function fakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false }, dataset: {}, attrs: {},
    isConnected: false, parentElement: null,
    setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return el.attrs[k] ?? null; },
    addEventListener() {}, removeEventListener() {}, remove() {},
    appendChild(child) { child.parentElement = el; child.isConnected = true; el.children.push(child); return child; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  };
  return el;
}

const host = fakeElement('div');
globalThis.document = {
  body: fakeElement('body'),
  createElement: (tag) => fakeElement(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
};
// `boot()` returns while there is no window: this test mounts the frame itself, as `mountPluginPreview` does.
const { mountPluginPreview, setFieldView } = await import('../../public/js/ui/pluginFrame.js');

test('a frame record carries the effect state the host helpers read, so the field-view handover never throws', () => {
  const entry = { id: 'probe', class: 'ui', entry: 'ui/index.html', frameFiles: { 'ui/index.html': 'deadbeefcafe' }, slots: ['hud.right'] };
  const handle = mountPluginPreview(entry, host);
  assert.ok(handle, 'the preview mounts a frame record');
  try {
    // the reported crash: a mounted frame + the match screen handing its field view over
    assert.doesNotThrow(() => setFieldView(null), 'setFieldView(null) with a mounted frame must not throw');
    assert.doesNotThrow(() => setFieldView({ setUnitsGif: () => true, setDjRotate: () => true }), 'and neither must the handover of a real view');
    assert.doesNotThrow(() => setFieldView(null), 'and taking it away again');
  } finally {
    handle.close();
  }
});
