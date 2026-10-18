import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, useTicker } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { battleRunner } from '../battle/runner.js';
import { useStore } from '../store.js';
import { t, N_ } from '../../../shared/i18n.js';
import { combatMetricsLayout } from './combatMetricsLayout.js';

const TYPES = Object.freeze([
  { id: 'phys', label: N_('物理') }, { id: 'arts', label: N_('法术') },
  { id: 'true', label: N_('真实') }, { id: 'elemental', label: N_('元素') },
]);
const number = (n) => Math.round(n || 0).toLocaleString('zh-CN');
const rate = (n) => (n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
/** The three scopes: the round the match is in, the battle on screen, every battle of the match so far. */
const SCOPES = Object.freeze([
  { id: 'round', label: N_('本轮') }, { id: 'battle', label: N_('当前战斗') }, { id: 'match', label: N_('本局累计') },
]);

/** The playerId of the `n:<playerId>` field the page watches, or null (a shared field, the own one, or none). */
export function watchedPlayerId(watching, myId) {
  const m = typeof watching === 'string' ? /^n:(.+)$/.exec(watching) : null;
  const id = m ? m[1] : null;
  return id && id !== myId ? id : null;
}

/** The round 「本轮」 reads: the newest round <= the match's own that has a record (the round just settled). */
export function pickRound(rounds, round) {
  const now = Number.isInteger(round) ? round : 0;
  const inside = (Array.isArray(rounds) ? rounds : []).filter((r) => Number.isInteger(r) && r <= now);
  return inside.length ? Math.max(...inside) : now;
}

/**
 * The owner whose rows the panel shows: the teammate on screen, else the one watched until its replica was dropped
 * (a spectator keeps reading it while the next round's first battle is prepared), or a seat the player pinned.
 */
export function pickOwner(owner, watching, matchPlayers, myId, runner = battleRunner) {
  if (owner !== 'watched' && (matchPlayers || []).some((p) => p.playerId === owner)) return owner;
  const last = typeof runner?.lastWatchedOwner === 'function' ? runner.lastWatchedOwner() : null;
  return watchedPlayerId(watching, myId) || last || myId || null;
}

/** A modeless panel: the battlefield stays visible and keeps playing. Mounted only while open. */
export function CombatMetricsPanel({ myId, watching = null, onClose, runner = battleRunner }) {
  const [scope, setScope] = useState('battle');
  const [owner, setOwner] = useState('watched');
  const pub = useStore((s) => s.match.public);
  const matchPlayers = Array.isArray(pub?.players) ? pub.players : [];
  const closeRef = useRef(null);
  const panelRef = useRef(null);
  useTicker(250);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal, .guide')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const corner = panel?.parentElement;
    const viewport = window.visualViewport;
    const measure = () => {
      if (!panel || !corner) return;
      const rect = corner.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const layout = combatMetricsLayout({
        cornerTop: rect.top, cornerBottom: rect.bottom,
        viewportHeight: viewport?.height || window.innerHeight,
        viewportTop: viewport?.offsetTop || 0,
        rem: parseFloat(rootStyle.fontSize) || 40,
        safeTop: parseFloat(rootStyle.getPropertyValue('--sa-t')) || 0,
        safeBottom: parseFloat(rootStyle.getPropertyValue('--sa-b')) || 0,
      });
      panel.style.setProperty('--combat-corner-height', `${rect.height || 44}px`);
      panel.style.setProperty('--combat-available-height', `${layout.availableHeight}px`);
      panel.style.setProperty('--combat-viewport-height', `${layout.viewportSpace}px`);
      panel.style.setProperty('--combat-viewport-top', `${layout.viewportPanelTop}px`);
      panel.dataset.viewportDocked = String(layout.viewportDocked);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (corner) observer?.observe(corner);
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, []);
  const ownerId = pickOwner(owner, watching, matchPlayers, myId, runner);
  const viewed = watchedPlayerId(watching, myId) || (typeof runner?.lastWatchedOwner === 'function' ? runner.lastWatchedOwner() : null);  // 「本轮」: the round the match is in, or the newest round that still has a kept record (the one just settled)
  const currentRound = Number(pub?.round) || 0;
  const round = scope === 'round'
    ? pickRound(typeof runner?.combatRounds === 'function' ? runner.combatRounds() : [], currentRound)
    : null;
  const result = runner?.combatMetrics({ scope, ownerId, round, owner: 'self', fallback: true }) || { rows: [], damage: 0, healing: 0 };
  // A read answered out of a kept round (any phase without a battle on screen: a prep, a settle) names it; the panel
  // then shows that round instead of going blank between rounds, and says when it is not the match's current one.
  const keptRound = Number.isInteger(result.round) ? result.round : null;
  const shownRound = keptRound ?? round;
  const pastRound = keptRound != null && keptRound < currentRound;
  const maximum = Math.max(1, ...result.rows.map((r) => r.damage));
  const nameOf = (id) => matchPlayers.find((p) => p.playerId === id)?.name || t('队友');
  return html`<section ref=${panelRef} id="combat-metrics-panel" class="combat-metrics brackets" role="dialog" aria-label=${t('作战统计')}
      onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="combat-metrics__head">
      <div><span class="combat-metrics__micro">COMBAT ANALYSIS</span><h2>${t('作战统计')}</h2></div>
      <button ref=${closeRef} type="button" class="combat-metrics__close" aria-label=${t('关闭作战统计')} onClick=${onClose}><${Icon} name="close" /></button>
      <div class="combat-metrics__tools">
        <div class="combat-metrics__scopes" role="group" aria-label=${t('统计范围')}>
          ${SCOPES.map(({ id, label }) => html`<button type="button" key=${id}
            aria-pressed=${scope === id} onClick=${() => setScope(id)}>${t(label)}</button>`)}
        </div>
      </div>
    </header>
    <div class="combat-metrics__body" tabindex="0">
    <div class="combat-metrics__owners" role="group" aria-label=${t('查看谁的数据')}>
      ${[{ id: 'watched', name: viewed ? `${t('观战')} · ${nameOf(viewed)}` : t('自己'), me: !viewed }, ...matchPlayers
        .filter((p) => p.playerId !== viewed)
        .map((p) => ({ id: p.playerId, name: p.playerId === myId ? t('自己') : (p.name || t('队友')), me: p.playerId === myId }))]
        .map((p) => html`<button type="button" key=${p.id} aria-pressed=${owner === p.id} class=${p.me ? 'is-me' : null}
          onClick=${() => setOwner(p.id)}>${p.name}</button>`)}
    </div>
    <div class="combat-metrics__totals">
      <span>${t('总伤害')} <b>${number(result.damage)}</b></span><span>${t('总治疗')} <b>${number(result.healing)}</b></span>
      ${shownRound ? html`<span class="combat-metrics__round">${t('第 {r} 回合', { r: shownRound })}${pastRound ? ` · ${t('最近记录')}` : ''}</span>` : null}
    </div>
    <div class="combat-metrics__legend" aria-label=${t('伤害类型图例')}>
      ${TYPES.map((type) => html`<span key=${type.id} class=${`combat-metrics__type combat-metrics__type--${type.id}`}>${t(type.label)}</span>`)}
      <span class="combat-metrics__sort">${t('伤害降序')}</span>
    </div>
    <ol class="combat-metrics__list" tabindex="0" aria-label=${t('干员伤害排行')}>
      ${result.rows.length ? result.rows.map((r, i) => {
        const description = TYPES.map((type) => `${t(type.label)} ${number(r.types[type.id])}`).join('，');
        return html`<li key=${r.key} class="combat-metrics__row">
          <span class="combat-metrics__rank">${String(i + 1).padStart(2, '0')}</span>
          <${UnitThumb} kind=${r.kind === 'token' ? 'token' : 'chess'} id=${r.defId} showTier=${false} size="sm" />
          <div class="combat-metrics__unit">
            <div class="combat-metrics__name"><b title=${r.name}>${r.name || r.defId}</b></div>
            <div class="combat-metrics__bar" role="img" aria-label=${description} title=${description}>
              ${TYPES.map((t) => html`<span key=${t.id} class=${`combat-metrics__segment combat-metrics__segment--${t.id}`}
                style=${{ width: `${r.types[t.id] / maximum * 100}%` }}></span>`)}
            </div>
            <div class="combat-metrics__values">
              <span><small>${t('伤害')}</small><b>${number(r.damage)}</b></span>
              <span><small>DPS</small><b>${rate(r.dps)}</b></span>
              <span class="combat-metrics__heal"><small>${t('治疗')}</small><b>${number(r.healing)}</b></span>
              <span class="combat-metrics__heal"><small>HPS</small><b>${rate(r.hps)}</b></span>
            </div>
          </div>
        </li>`;
      }) : html`<li class="combat-metrics__empty">${t('暂无本地战斗记录')}<br /><small>${t('开始战斗后实时显示干员数据')}</small></li>`}
    </ol>
    <p class="combat-metrics__note">${viewed
      ? t('正在观战 {name} · 数据来自本机运行的观战副本', { name: nameOf(viewed) })
      : t('仅统计本机的战斗 · 同名干员合并 · 召唤物计入所属干员')}<br />${t('实际扣血 / 有效治疗，DPS / HPS 按该玩家的战斗秒数计算。刷新后重新累计。')}</p>
    </div>
  </section>`;
}
