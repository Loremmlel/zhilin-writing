import { emptyFor } from './movement';
import { allPieces, hasTrait } from './traits';
import { captureClockFrame, endShrines, rebuildLandmarks, syncBanners } from './shrines';
import { availableSyntheses } from './synthesis';
import { firelordStrike } from './firelord';
import { COMBAT_RULES } from './catalog';
import { eventActor, withEventFacts } from './event-facts';
import { definition, isStored } from './catalog';
import {
  alive,
  damage,
  areaDamage,
  findTarget,
  freeze,
  heal,
  kill,
  pruneSiphons,
  resolution,
} from './combat';
import type { Resolution } from './combat';
import {
  ALL_CELLS,
  attackPath,
  basePoint,
  canPlace,
  cells,
  equal,
  occupants,
  refreshDeployment,
  ring,
  targets,
} from './geometry';
import {
  activeEffect,
  allegiance,
  asTarget,
  emit,
  ensure,
  faction,
  getStats,
  has,
  now,
  passive,
  resetUnit,
  template,
} from './state';
import type { GamePosition, Player, Source, Unit } from './types';
export function processIceMarks(s: GamePosition, ctx: Resolution, only?: Unit) {
  for (const mark of [...s.iceMarks]) {
    if (only && mark.sourceId !== only.id) continue;
    const u = s.units.find((v) => v.id === mark.sourceId);
    if (!u) {
      s.iceMarks = s.iceMarks.filter((m) => m.id !== mark.id);
      continue;
    }
    if (mark.due > now(s, u)) continue;
    s.iceMarks = s.iceMarks.filter((m) => m.id !== mark.id);
    if (u.silenced) continue;
    ctx.token++;
    for (const victim of occupants(s, mark).slice(0, 1))
      if (allegiance(s, victim) !== u.owner)
        freeze(s, asTarget(victim), { owner: u.owner, unit: u, kind: 'skill' }, ctx, 5);
  }
}
export function advanceUnit(s: GamePosition, u: Unit, ctx: Resolution) {
  u.offset += 2;
  resetUnit(s, u);
  processIceMarks(s, ctx, u);
  emit(
    s,
    { type: 'skill', to: u, owner: u.owner, text: '独立推进回合' },
    `${definition(u.kind).name}提前进入自己的下一回合`,
  );
}
export function beginTurn(s: GamePosition, ctx: Resolution) {
  const owner = s.active;
  s.turns[owner]++;
  rebuildLandmarks(s);
  for (const u of [...s.units]) {
    u.effects = u.effects.filter((e) => e.until > (e.global ? s.ply : now(s, u)));
    if (u.expiresAt !== undefined && u.expiresAt <= s.ply) kill(s, u, { kind: 'expire' }, ctx);
    if (u.owner === owner) resetUnit(s, u);
  }
  for (const p of [1, 2] as Player[])
    s.baseEffects[p] = s.baseEffects[p].filter((e) => e.until > s.ply);
  s.hands[owner] = s.hands[owner].filter((c) => {
    if (c.expiresAt !== undefined && c.expiresAt <= s.turns[owner]) {
      emit(s, { type: 'skill', owner, text: '储存到期' }, `${definition(c.kind).name}已过期`);
      return false;
    }
    return true;
  });
  for (const h of [...s.hazards])
    if (h.due <= s.ply) {
      s.hazards = s.hazards.filter((v) => v.id !== h.id);
      ctx.token++;
      const packet: Source = {
        owner: h.owner,
        kind: 'spell',
        base: h.owner,
      };
      const victims = targets(s).filter((t) =>
        (t.unit ? cells(t.unit) : [t]).some((p) =>
          h.axis === 'row' ? p.y === h.line : p.x === h.line,
        ),
      );
      withEventFacts(
        s,
        {
          action: 'storm',
          stage: 'trigger',
          ability: 'u9',
          actor: eventActor(targets(s).find((t) => t.id === `base-${h.owner}`)),
          area: ALL_CELLS.filter((p) => (h.axis === 'row' ? p.y === h.line : p.x === h.line)),
        },
        () => {
          emit(s, { type: 'skill', owner: h.owner, text: '烈焰风暴 · 再临' });
          areaDamage(
            s,
            victims.filter((t) => (t.unit ? allegiance(s, t.unit) : t.owner) !== h.owner),
            (p) => ((h.axis === 'row' ? p.y === h.line : p.x === h.line) ? 20 : 0),
            packet,
            ctx,
          );
        },
      );
    }
  processIceMarks(s, ctx);
  refreshDeployment(s, owner);
  pruneSiphons(s);
  s.phase = availableSyntheses(s).length ? 'synthesis' : 'summon';
  s.summonSlots = 2 + s.bonus[owner];
  s.bonus[owner] = 0;
  if (s.mode === 'shrine') s.regularSummons = 2;
  syncBanners(s);
  captureClockFrame(s);
  emit(
    s,
    {
      type: 'turn',
      owner,
      text: `${faction(owner)} · ${s.phase === 'synthesis' ? '合成阶段' : '召唤阶段'}`,
    },
    `${faction(owner)}第${s.turns[owner]}回合开始，可召唤${s.summonSlots}次`,
  );
}
export function endTurn(s: GamePosition, ctx: Resolution) {
  ensure(s.phase === 'play', '请先完成召唤并进入行动阶段。');
  for (const u of s.units)
    ensure(
      (!hasTrait(u, 'u12p') && !hasTrait(u, 'u12')) || u.mode !== 'move' || emptyFor(s, u),
      '冲撞棋子必须离开棋子、地标或基地占位后才能结束回合。',
    );
  for (const c of s.hands[s.active].filter((c) => !isStored(definition(c.kind)))) {
    const ghost = template(c.kind, s.active, s.turns[s.active], { x: 1, y: 1 });
    ensure(
      !ALL_CELLS.some((p) => canPlace(s, ghost, p, true)),
      `请先部署${definition(c.kind).name}，随从不能储存。`,
    );
    emit(
      s,
      { type: 'skill', owner: s.active, text: '无处部署' },
      `${definition(c.kind).name}无合法格，自动弃置`,
    );
  }
  s.hands[s.active] = s.hands[s.active].filter((c) => isStored(definition(c.kind)));
  // DOTs and persistent links resolve at every player's end, as explicitly documented.
  for (const u of [...allPieces(s)])
    for (const e of [...u.effects])
      if ((e.type === 'burn' || e.type === 'freeze') && activeEffect(s, e, u)) {
        ctx.token++;
        damage(
          s,
          asTarget(u),
          e.amount ?? 5,
          { owner: e.owner, kind: 'status', unit: s.units.find((v) => v.id === e.sourceId) },
          ctx,
        );
      }
  pruneSiphons(s);
  for (const link of [...s.siphons]) {
    const source = s.units.find((u) => u.id === link.sourceId),
      from = targets(s).find((t) => t.id === link.fromId),
      to = targets(s).find((t) => t.id === link.toId);
    if (!source || !from || !to) continue;
    ctx.token++;
    withEventFacts(
      s,
      { action: 'siphon', stage: 'trigger', actor: eventActor(from), subject: eventActor(to) },
      () => {
        damage(s, from, 20, { owner: link.owner, unit: source, kind: 'skill' }, ctx);
        heal(s, to, 20, ctx);
      },
    );
  }
  for (const lord of [...s.units]) {
    if (!alive(s, lord) || lord.owner !== s.active) continue;
    const strike = firelordStrike(s, lord);
    if (!strike) continue;
    ctx.token++;
    withEventFacts(s, { action: 'judgement', actor: eventActor(lord), area: strike.area }, () => {
      emit(s, {
        type: 'attack',
        from: lord,
        to: strike.impact,
        owner: lord.owner,
        text: '末日审判',
        ultimate: true,
      });
      const victims = [
        ...new Map([...strike.primary, ...strike.splash].map((t) => [t.id, t])).values(),
      ];
      areaDamage(
        s,
        victims,
        (p) =>
          equal(p, strike.impact)
            ? COMBAT_RULES.firelord.damage
            : strike.area.some((q) => equal(p, q))
              ? COMBAT_RULES.firelord.splash
              : 0,
        { owner: lord.owner, unit: lord, kind: 'skill' },
        ctx,
      );
    });
  }
  endShrines(s, ctx);
  // End effects can require choices. The actual player switch is deferred until that queue drains.
  if (s.pending.length) {
    s.phase = 'play';
    s.summonSlots = -1;
    emit(s, { type: 'turn', text: '回合结束效果结算' });
    return;
  }
  if (s.bases[1] <= 0 || s.bases[2] <= 0) return;
  switchTurn(s, ctx);
}
export function switchTurn(s: GamePosition, ctx: Resolution) {
  s.active = s.active === 1 ? 2 : 1;
  s.ply++;
  beginTurn(s, ctx);
}
