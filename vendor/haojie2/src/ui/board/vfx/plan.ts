import type { GameEvent, Kind, Player, Point } from '../../../engine';
import type { EventActor } from '../../../engine/event-facts';

export type Family =
  | 'slash'
  | 'arrow'
  | 'cannon'
  | 'stone'
  | 'bolt'
  | 'hook'
  | 'mend'
  | 'rush'
  | 'bomb'
  | 'storm'
  | 'cross'
  | 'quake'
  | 'ward'
  | 'execution'
  | 'conversion'
  | 'freeze'
  | 'burn'
  | 'mark'
  | 'charge'
  | 'siphon'
  | 'buff'
  | 'equip'
  | 'counter'
  | 'silence'
  | 'ice-mark'
  | 'clock'
  | 'inner-fire'
  | 'spawn'
  | 'death'
  | 'damage'
  | 'heal'
  | 'move';
export interface Cue {
  id: string;
  family: Family;
  owner: Player;
  from: Point;
  to: Point;
  /** Projectile contact may precede a relocation to the final `to` square. */
  impactTo?: Point;
  route: Point[];
  movement?: Point[];
  area: Point[];
  actor?: EventActor;
  subject?: EventActor;
  ability?: Kind;
  stage?: GameEvent['stage'];
  amount?: number;
  numberSlot?: number;
  label?: string;
  start: number;
  impact: number;
  end: number;
}
export interface EffectBatch {
  id: number;
  born: number;
  expires: number;
  cues: Cue[];
}
export const MAX_BATCHES = 4;
export const MAX_CUES = 96;
export const MOVE_MS = 360;
export const center = (p: Point, size = 1): Point => ({
  x: (p.x - 0.5 + (size - 1) / 2) * 100,
  y: (p.y - 0.5 + (size - 1) / 2) * 100,
});
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const resultTypes = new Set(['damage', 'heal', 'death']);
const specials = new Set<Family>([
  'ward',
  'counter',
  'conversion',
  'execution',
  'freeze',
  'burn',
  'mark',
  'silence',
]);
const ballistic = new Set<Family>(['arrow', 'cannon', 'stone', 'bolt', 'hook', 'mend']);
const priority = (cue: Cue) => (resultTypes.has(cue.family) ? 3 : cue.family === 'move' ? 0 : 1);

/** Cosmetic identity only. No ranges, probabilities or damage values live here. */
function attackFamily(e: GameEvent): Family {
  if (e.action === 'mend') return 'mend';
  if (e.action === 'judgement') return 'cannon';
  const k = e.actor?.kind;
  if (k === 9) return 'arrow';
  if (k === 4 || k === 'u2') return 'cannon';
  if (k === 10) return 'stone';
  if (k === 7 || k === 'u23') return 'hook';
  const pathLength = e.path
    ? e.path.length - 1
    : e.from && e.to
      ? Math.abs(e.from.x - e.to.x) + Math.abs(e.from.y - e.to.y)
      : 2;
  return pathLength <= 1 ? 'slash' : 'bolt';
}
function family(e: GameEvent): Family {
  if (e.type === 'attack') return attackFamily(e);
  if (e.type === 'move')
    return e.action === 'pull' ? 'hook' : e.action === 'rush' ? 'rush' : 'move';
  if (e.type === 'spawn') return 'spawn';
  if (e.action === 'pull') return 'hook';
  if (e.action === 'attack' || e.action === 'judgement' || e.action === 'mend') return 'buff';
  return e.action ?? (e.type === 'shield' ? 'ward' : 'buff');
}
function make(e: GameEvent, kind: Family, start: number, id: string): Cue | undefined {
  const p = e.subject ?? e.to ?? e.area?.[0] ?? e.actor;
  if (!p) return;
  const to =
    e.type === 'move' && e.to
      ? center(e.to, e.subject?.size)
      : e.subject
        ? center(e.subject, e.subject.size)
        : center(p);
  let from = e.from
    ? center(e.from, e.type === 'move' ? e.subject?.size : e.actor?.size)
    : e.actor
      ? center(e.actor, e.actor.size)
      : to;
  let route = e.path?.map((p) => center(p)) ?? [from, to];
  // Connect contact cells to the centers inside each unit footprint; never shortcut the rule path.
  if (!same(route[0], from)) route = [from, ...route];
  if (!same(route.at(-1)!, to)) route = [...route, to];
  const movement = e.type === 'move' ? [...route] : undefined;
  if (e.type === 'move' && kind === 'hook' && e.actor) {
    from = center(e.actor, e.actor.size);
    // Hook extends to the old victim position; relocation remains a separate rule fact.
    route = [from, center(e.from!, e.subject?.size)];
  }
  const windup = kind === 'cannon' ? 130 : kind === 'slash' ? 30 : 60;
  const length = route
    .slice(1)
    .reduce((n, p, i) => n + Math.hypot(p.x - route[i].x, p.y - route[i].y), 0);
  const flight = ballistic.has(kind)
    ? Math.min(430, Math.max(150, length * 0.5))
    : kind === 'siphon'
      ? 280
      : 110;
  const impact = start + windup + flight;
  return {
    id,
    family: kind,
    owner: e.owner ?? e.actor?.owner ?? 1,
    from,
    to,
    route,
    ...(kind === 'hook' && movement ? { impactTo: route.at(-1)! } : {}),
    movement,
    area: e.stage === 'blocked' ? [] : (e.area ?? []).map((p) => center(p)),
    actor: e.actor,
    subject: e.subject,
    ability: e.ability,
    stage: e.stage,
    amount: e.amount,
    label: e.text,
    start,
    impact,
    end: impact + (kind === 'hook' && movement ? MOVE_MS : 0) + 650,
  };
}

/** No clock, random draws or state mutations; old events fall back to a generic safe cue. */
export function planEffects(events: readonly GameEvent[]): Cue[] {
  const groups = new Map<string, GameEvent[]>();
  for (const event of events) {
    const key = event.causeId ?? event.id;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const cues: Cue[] = [];
  const impacts = new Map<string, number>();
  for (const [key, group] of groups) {
    const parent = group.find((e) => e.parentId)?.parentId;
    const start = parent ? Math.min(700, (impacts.get(parent) ?? 0) + 80) : 0;
    const countered = group.some((e) => e.action === 'counter');
    const primary =
      group.find((e) => e.type === 'attack') ??
      group.find((e) => e.type === 'move') ??
      group.find(
        (e) =>
          !resultTypes.has(e.type) &&
          e.stage !== 'blocked' &&
          (e.to || e.subject || e.area?.length || e.actor) &&
          !['turn', 'summon'].includes(e.type),
      );
    let main: Cue | undefined;
    if (primary && !countered) {
      const failed =
        group.some((e) => e.stage === 'blocked') &&
        ['pull', 'inner-fire'].includes(primary.action ?? '');
      if (!failed) main = make(primary, family(primary), start, key + ':action');
      if (main) {
        cues.push(main);
        impacts.set(key, main.impact);
      }
    }
    const at = main?.impact ?? start;
    const numbers = new Map<string, Cue>();
    for (const e of group) {
      if (e === primary && main) continue;
      const position = e.subject?.id ?? e.unitId ?? `${e.to?.x},${e.to?.y}`;
      if (e.type === 'damage' || e.type === 'heal') {
        let delay = at;
        // Drain is drawn only for an actual heal, not for a predicted or blocked hit.
        if (e.type === 'heal' && e.action === 'siphon') {
          const flow = make(e, 'siphon', at, e.id + ':flow');
          if (flow) {
            cues.push(flow);
            delay = flow.impact;
          }
        }
        const numberKey = `${position}:${e.type}`;
        const old = numbers.get(numberKey);
        if (old) old.amount = (old.amount ?? 0) + (e.amount ?? 0);
        else {
          const number = make(e, e.type, delay, e.id + ':number');
          if (number) {
            number.impact = delay;
            number.end = delay + 920;
            numbers.set(numberKey, number);
          }
        }
        if (e.action === 'mark' && e.stage === 'trigger') {
          const mark = make(e, 'mark', at, e.id + ':mark');
          if (mark) cues.push(mark);
        }
      } else if (e.type === 'death') {
        const death = make(e, e.action === 'execution' ? 'execution' : 'death', at + 50, e.id);
        if (death) cues.push(death);
      } else if (e.type === 'spawn') {
        const spawn = make(e, 'spawn', at, e.id);
        if (spawn) cues.push(spawn);
      } else if (
        (e.stage === 'blocked' || (e.action && specials.has(e.action as Family))) &&
        e.to
      ) {
        const effect = make(e, family(e), at, e.id);
        if (effect) cues.push(effect);
      }
    }
    cues.push(...numbers.values());
  }
  return limitCues(cues);
}

/** Enforce the same priority cap at both the planner and the playback boundary. */
function limitCues(cues: readonly Cue[]): Cue[] {
  if (cues.length <= MAX_CUES) return [...cues];
  // Evict decoration before numeric/death feedback in unusually large packets.
  const kept = new Set(
    cues
      .map((c, i) => ({ c, i }))
      .sort((a, b) => priority(b.c) - priority(a.c) || a.i - b.i)
      .slice(0, MAX_CUES)
      .map(({ c }) => c),
  );
  return cues.filter((c) => kept.has(c));
}
export function appendBatch(
  previous: readonly EffectBatch[],
  next: EffectBatch,
  now: number,
): EffectBatch[] {
  const living = previous.filter((b) => b.expires > now);
  const used = new Map<string, Set<number>>();
  const key = (c: Cue) => `${c.to.x},${c.to.y}`;
  for (const batch of living)
    for (const cue of batch.cues) {
      if (!['damage', 'heal'].includes(cue.family) || batch.born + cue.end <= now) continue;
      const slots = used.get(key(cue)) ?? new Set<number>();
      slots.add(cue.numberSlot ?? 0);
      used.set(key(cue), slots);
    }
  const positioned = {
    ...next,
    cues: limitCues(next.cues).map((cue) => {
      if (!['damage', 'heal'].includes(cue.family)) return cue;
      const slots = used.get(key(cue)) ?? new Set<number>();
      let slot = 0;
      while (slots.has(slot)) slot++;
      slots.add(slot);
      used.set(key(cue), slots);
      return { ...cue, numberSlot: slot };
    }),
  };
  const rows = [...living, positioned].filter((b) => b.cues.length);
  while (rows.length > MAX_BATCHES || rows.reduce((n, b) => n + b.cues.length, 0) > MAX_CUES)
    rows.shift();
  return rows;
}
