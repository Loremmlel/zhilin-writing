import { allPieces } from '../../engine/core/traits';
import { attackRoutes, frontal } from '../../engine/core/geometry';
/** 只读空间估算；最终命令始终使用引擎的精确路径及合法性校验。 */
import { cells, basePoint, inside, distance, neighbors } from '../../engine/core/geometry';
import { allegiance, getStats, resetUnit, piercing, hasWeapon } from '../../engine/core/state';
import type { GameState, Player, Point, Stats, Target, Unit } from '../../engine/types';
const index = (p: Point) => (p.y - 1) * 9 + p.x - 1;
interface Spatial {
  occupants: Unit[][];
  stats: Map<string, Stats>;
  reaches: Map<string, Int16Array>;
  windows: Map<string, GameState>;
  members: Set<Unit>;
}
const cache = new WeakMap<GameState, Spatial>();
function spatial(s: GameState): Spatial {
  let result = cache.get(s);
  if (!result) {
    const occupants = Array.from({ length: 117 }, () => [] as Unit[]);
    for (const u of allPieces(s))
      for (const p of cells(u)) if (inside(p)) occupants[index(p)].push(u);
    result = {
      occupants,
      stats: new Map(),
      reaches: new Map(),
      windows: new Map(),
      members: new Set(allPieces(s)),
    };
    cache.set(s, result);
  }
  return result;
}
export const occupantsAt = (s: GameState, p: Point) =>
  inside(p) ? spatial(s).occupants[index(p)] : [];
export function statsFor(s: GameState, u: Unit): Stats {
  const data = spatial(s);
  // 预览棋子可能同 ID 但坐标或蓄力不同；只缓存局面中实际持有的对象。
  if (!data.members.has(u)) return getStats(s, u);
  let result = data.stats.get(u.id);
  if (!result) {
    result = getStats(s, u);
    data.stats.set(u.id, result);
  }
  return result;
}
/** 只投影行动可用性，不模拟完整回合，不虚构抽牌或额外蓄力。response 表示本回合剩余行动或对方下回合，next 表示下个完整己方回合。保留原对象，不消费随机数、推进全局时钟或凭空组合移动与攻击。 */
export function actionWindow(s: GameState, side: Player, next = false): GameState {
  const delta = s.active !== side ? 1 : next ? 2 : 0;
  if (!delta && s.phase === 'play') return s;
  const key = `${side}:${delta}`;
  const data = spatial(s);
  const old = data.windows.get(key);
  if (old) return old;
  const view: GameState = {
    ...s,
    ply: s.ply + delta,
    active: side,
    phase: 'play',
    pending: [],
    turns: { ...s.turns, [side]: s.turns[side] + (delta ? 1 : 0) },
    ...(s.landmarks
      ? { landmarks: s.landmarks.map((l) => ({ ...l, effects: [...l.effects] })) }
      : {}),
    units: s.units
      .filter((u) => u.expiresAt === undefined || u.expiresAt > s.ply + delta)
      .map((u) => ({
        ...u,
        effects: [...u.effects],
        ...(u.abilityCharges ? { abilityCharges: structuredClone(u.abilityCharges) } : {}),
      })),
  };
  if (delta) for (const u of allPieces(view)) if (u.owner === side) resetUnit(view, u);
  data.windows.set(key, view);
  return view;
}
/** 敌方占格是路径终点：可命中但不能穿过。对当前占位的可达性等价于 attackPath，但不分配路径数组。评估候选落点时，ignoreId 排除防守者的旧占位。 */
export function attackField(s: GameState, u: Unit, range: number, ignoreId = ''): Int16Array {
  const data = spatial(s),
    k = `${u.id}:${u.x},${u.y}:${u.size}:${range}:${ignoreId}:${hasWeapon(u, 'u28')}`;
  const old = data.reaches.get(k);
  if (old) return old;
  const distances = new Int16Array(117).fill(-1);
  const queue: Point[] = [];
  for (const p of cells(u))
    if (inside(p)) {
      distances[index(p)] = 0;
      queue.push(p);
    }
  const enemyBase = basePoint(u.owner === 1 ? 2 : 1);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i],
      depth = distances[index(from)];
    if (depth >= range) continue;
    for (const p of neighbors(from)) {
      const at = index(p);
      if (distances[at] >= 0) continue;
      distances[at] = depth + 1;
      const blocked =
        (p.x === enemyBase.x && p.y === enemyBase.y) ||
        (!hasWeapon(u, 'u28') &&
          data.occupants[at].some(
            (v) => v.id !== u.id && v.id !== ignoreId && allegiance(s, v) !== u.owner,
          ));
      if (!blocked) queue.push(p);
    }
  }
  data.reaches.set(k, distances);
  return distances;
}
export function hitDistance(s: GameState, u: Unit, t: Target, ignoreId = ''): number {
  const st = statsFor(s, u),
    ends = t.unit ? cells(t.unit) : [t];
  if (piercing(u) && !hasWeapon(u, 'u28')) {
    let shortest = Infinity;
    for (const a of cells(u))
      for (const b of ends)
        if ((a.x === b.x || a.y === b.y) && (distance(a, b) > 0 || t.id !== u.id))
          shortest = Math.min(shortest, distance(a, b));
    return shortest <= st.range ? shortest : Infinity;
  }
  const field = attackField(s, u, st.range, ignoreId);
  return Math.min(
    ...ends.filter(inside).map((p) => (field[index(p)] < 0 ? Infinity : field[index(p)])),
  );
}
export function isFrontHit(s: GameState, u: Unit, t: Target, ignoreId = ''): boolean {
  if (!piercing(u) || hasWeapon(u, 'u28')) {
    const view = ignoreId ? { ...s, units: s.units.filter((v) => v.id !== ignoreId) } : s;
    const routes = attackRoutes(view, u, t, statsFor(s, u).range, hasWeapon(u, 'u28'));
    return routes.length > 0 && routes.every((r) => frontal(r.path, t.owner));
  }
  const d = hitDistance(s, u, t, ignoreId);
  if (!Number.isFinite(d) || d < 1) return false;
  const field = attackField(s, u, statsFor(s, u).range, ignoreId);
  return (t.unit ? cells(t.unit) : [t]).some((p) => {
    const before = { x: p.x, y: p.y + (t.owner === 1 ? 1 : -1) };
    return inside(before) && field[index(before)] === d - 1;
  });
}
