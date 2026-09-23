import type { GameEvent, GamePosition, Kind, Player, Point, Target, Unit } from '../types';

/** 只保存事实，不记录动画时长、渲染对象或额外游戏序号。 */
export interface EventActor extends Point {
  id: string;
  owner: Player;
  kind?: Kind;
  size: number;
}
export type EventAction =
  | 'attack'
  | 'mend'
  | 'charge'
  | 'pull'
  | 'rush'
  | 'bomb'
  | 'storm'
  | 'cross'
  | 'ward'
  | 'execution'
  | 'conversion'
  | 'freeze'
  | 'burn'
  | 'mark'
  | 'siphon'
  | 'buff'
  | 'equip'
  | 'counter'
  | 'judgement'
  | 'silence'
  | 'ice-mark'
  | 'clock'
  | 'inner-fire'
  | 'quake';
export interface EventFacts {
  action?: EventAction;
  stage?: 'apply' | 'trigger' | 'blocked';
  ability?: Kind;
  actor?: EventActor;
  subject?: EventActor;
  area?: Point[];
  causeId?: string;
  parentId?: string;
}

export function eventActor(p?: Point): EventActor | undefined {
  if (!p) return;
  const raw = p as Unit | Target;
  if (!('id' in raw) || !('owner' in raw)) return;
  const u = 'kind' in raw ? raw : raw.unit;
  return {
    id: raw.id,
    owner: raw.owner,
    x: raw.x,
    y: raw.y,
    size: u?.size ?? 1,
    ...(u ? { kind: u.kind } : {}),
  };
}

// 同步作用域与模拟随机源相同，不将上下文存入局面。
const contexts = new WeakMap<GamePosition, EventFacts>();
export function withEventFacts<T>(s: GamePosition, facts: EventFacts, run: () => T): T {
  const previous = contexts.get(s);
  contexts.set(s, { ...facts, ...(previous?.causeId ? { parentId: previous.causeId } : {}) });
  try {
    return run();
  } finally {
    if (previous) contexts.set(s, previous);
    else contexts.delete(s);
  }
}

/** 在棋子移动、死亡、巨大化或换阵营前，复制其身份与几何快照。 */
export function enrichEvent(s: GamePosition, e: GameEvent): GameEvent {
  const context = contexts.get(s);
  if (context && !context.causeId) context.causeId = e.id;
  const inferred = eventActor(e.to) ?? (e.type === 'move' ? eventActor(e.from) : undefined);
  const result: GameEvent = { ...context, ...e };
  result.actor =
    e.actor ?? context?.actor ?? (e.type === 'attack' ? eventActor(e.from) : undefined);
  result.subject = e.subject ?? inferred ?? context?.subject;
  if (result.actor) result.actor = { ...result.actor };
  else delete result.actor;
  if (result.subject) result.subject = { ...result.subject };
  else delete result.subject;
  if (result.area && (['attack', 'skill', 'move'].includes(e.type) || e.area))
    result.area = result.area.map(({ x, y }) => ({ x, y }));
  else delete result.area;
  return result;
}
