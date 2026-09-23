import { allPieces, hasTrait, isLandmark } from './traits';
import { landmarkAt, landmarkSquare, liveLandmark } from '../setup/shrines';
import { definition } from '../catalog';
import { allegiance, getStats, has, passive, piercing, hasWeapon } from './state';
import type { AttackDirection, GamePosition, Player, Point, Target, Unit } from '../types';
export const WIDTH = 9,
  HEIGHT = 13;
export const ALL_CELLS: Point[] = Array.from({ length: 117 }, (_, i) => ({
  x: (i % 9) + 1,
  y: Math.floor(i / 9) + 1,
}));
export const other = (p: Player): Player => (p === 1 ? 2 : 1);
export const basePoint = (p: Player): Point => ({ x: 5, y: p === 1 ? 1 : 13 });
export const inside = (p: Point) =>
  Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 1 && p.x <= 9 && p.y >= 1 && p.y <= 13;
export const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const key = (p: Point) => `${p.x},${p.y}`;
export function cells(u: { kind: Unit['kind']; x: number; y: number; size?: number }): Point[] {
  const size = u.size ?? definition(u.kind).size ?? 1;
  // 常见占位直接构造新坐标，保留逐行顺序与调用方可独立修改返回值的约定。
  if (size === 1) return [{ x: u.x, y: u.y }];
  if (size === 2)
    return [
      { x: u.x, y: u.y },
      { x: u.x + 1, y: u.y },
      { x: u.x, y: u.y + 1 },
      { x: u.x + 1, y: u.y + 1 },
    ];
  return Array.from({ length: size * size }, (_, i) => ({
    x: u.x + (i % size),
    y: u.y + Math.floor(i / size),
  }));
}
/** 只读占位查询，不分配坐标数组；整数偏移保留逐格匹配，不能把格间位置当作占位。 */
function covers(u: Unit, p: Point): boolean {
  const size = u.size ?? definition(u.kind).size ?? 1;
  const dx = p.x - u.x,
    dy = p.y - u.y;
  return (
    Number.isInteger(dx) && Number.isInteger(dy) && dx >= 0 && dy >= 0 && dx < size && dy < size
  );
}
export const occupants = (s: GamePosition, p: Point) => s.units.filter((u) => covers(u, p));
export const occupant = (s: GamePosition, p: Point) => s.units.find((u) => covers(u, p));
export function targets(s: GamePosition): Target[] {
  return [
    ...allPieces(s).map((u) => ({ id: u.id, owner: u.owner, x: u.x, y: u.y, unit: u })),
    ...([1, 2] as Player[]).map((p) => ({ id: `base-${p}`, owner: p, ...basePoint(p) })),
  ];
}
export function targetAt(s: GamePosition, p: Point): Target | undefined {
  return targets(s).find((t) => (t.unit ? covers(t.unit, p) : equal(t, p)));
}
export function topTarget(s: GamePosition, t: Target) {
  if (!t.unit) return true;
  if (isLandmark(t.unit)) {
    const over = occupant(s, t);
    return !over || allegiance(s, over) !== t.owner;
  }
  return occupant(s, t)?.id === t.id;
}
export function adjacent(a: Unit, b: Unit) {
  return cells(a).some((c) => cells(b).some((d) => distance(c, d) === 1));
}
export function ring(a: Unit, b: Point | Unit) {
  const bc = 'kind' in b ? cells(b) : [b];
  return (
    cells(a).some((c) =>
      bc.some((d) => Math.max(Math.abs(c.x - d.x), Math.abs(c.y - d.y)) === 1),
    ) && !cells(a).some((c) => bc.some((d) => equal(c, d)))
  );
}
interface PlacementContext {
  occupants: Unit[][];
  friends: Record<Player, Unit[]>;
  loners: Record<Player, Unit[]>;
  rows: Partial<Record<Player, number[]>>;
}
/**
 * 为同步只读查询批次创建索引。调用期间不得修改 s 或其棋子；新局面必须重新创建。
 * 不挂载全局缓存、不改变权威 canPlace 的默认入口，不保存到局面或消耗随机数。
 */
export function createPlacementQuery(s: GamePosition) {
  const context: PlacementContext = {
    occupants: Array.from({ length: 117 }, () => []),
    friends: { 1: [], 2: [] },
    loners: { 1: [], 2: [] },
    rows: {},
  };
  for (const v of s.units) {
    for (const p of cells(v)) if (inside(p)) context.occupants[(p.y - 1) * 9 + p.x - 1].push(v);
    const owner = allegiance(s, v);
    if (owner) {
      context.friends[owner].push(v);
      if (hasTrait(v, 23) && passive(s, v)) context.loners[owner].push(v);
    }
  }
  const place = (u: Unit, at: Point, deployment = false, ignore: string[] = []) =>
    placement(s, u, at, deployment, ignore, context);
  return {
    canPlace: place,
    movementPath: (u: Unit, to: Point, limit: number, straight = false) =>
      movement(s, u, to, limit, straight, place),
  };
}
export function canPlace(
  s: GamePosition,
  u: Unit,
  at: Point,
  deployment = false,
  ignore: string[] = [],
): boolean {
  return placement(s, u, at, deployment, ignore);
}
function placement(
  s: GamePosition,
  u: Unit,
  at: Point,
  deployment: boolean,
  ignore: string[],
  context?: PlacementContext,
): boolean {
  const occupied = (p: Point) =>
    context ? context.occupants[(p.y - 1) * 9 + p.x - 1] : occupants(s, p);
  const moved = { ...u, ...at },
    footprint = cells(moved);
  if (footprint.some((p) => !inside(p) || equal(p, basePoint(1)) || equal(p, basePoint(2))))
    return false;
  if (isLandmark(u)) {
    if (!deployment) return equal(u, at);
    if (!landmarkSquare(u.kind, at) || landmarkAt(s, at)) return false;
    const over = occupied(at).filter((v) => !ignore.includes(v.id));
    return over.length <= 1 && over.every((v) => allegiance(s, v) === u.owner);
  }
  const rows = deployment
    ? context
      ? (context.rows[u.owner] ??= deploymentRows(s, u.owner))
      : deploymentRows(s, u.owner)
    : [];
  if (
    deployment &&
    !hasTrait(u, 'u27') &&
    footprint.some((p) => {
      const land = landmarkAt(s, p);
      return !rows.includes(p.y) && !(liveLandmark(land) && allegiance(s, land) === u.owner);
    })
  )
    return false;
  for (const p of footprint) {
    const land = landmarkAt(s, p);
    if (!land) continue;
    if (u.size > 1) return false;
    if (deployment && liveLandmark(land) && allegiance(s, land) !== u.owner) return false;
    // 地标即使休眠也只能承载一个随从，不能承载克隆叠放。
    if (occupied(p).some((v) => v.id !== u.id && !ignore.includes(v.id))) return false;
  }
  // 候选落点的重叠查询只读对应格；默认权威路径仍扫描原始单位数组。
  const others = context
    ? footprint.flatMap(occupied).filter((v) => v.id !== u.id && !ignore.includes(v.id))
    : s.units.filter((v) => v.id !== u.id && !ignore.includes(v.id));
  if (
    others.some(
      (v) =>
        footprint.some((p) => covers(v, p)) &&
        !(
          u.kind === 'u25' &&
          v.kind === 'u25' &&
          u.owner === v.owner &&
          u.size === 1 &&
          v.size === 1
        ),
    )
  )
    return false;
  const isolation = context
    ? (hasTrait(u, 23) && passive(s, u)
        ? context.friends[u.owner]
        : context.loners[u.owner]
      ).filter((v) => v.id !== u.id && !ignore.includes(v.id))
    : others;
  if (
    isolation.some(
      (v) =>
        allegiance(s, v) === u.owner &&
        ((hasTrait(v, 23) && passive(s, v)) || (hasTrait(u, 23) && passive(s, u))) &&
        cells(v).some((c) =>
          footprint.some((p) => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= 1),
        ),
    )
  )
    return false;
  return true;
}
export const neighbors = (p: Point): Point[] =>
  [
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
  ].filter(inside);
export function movementPath(
  s: GamePosition,
  u: Unit,
  to: Point,
  limit: number,
  straight = false,
): Point[] | null {
  return movement(s, u, to, limit, straight, (unit, p) => canPlace(s, unit, p));
}
function movement(
  s: GamePosition,
  u: Unit,
  to: Point,
  limit: number,
  straight: boolean,
  place: (unit: Unit, p: Point) => boolean,
): Point[] | null {
  if (!inside(to) || equal(u, to) || !place(u, to)) return null;
  if (straight) {
    if (distance(u, to) !== 3 || (u.x !== to.x && u.y !== to.y)) return null;
    const path = Array.from({ length: 4 }, (_, i) => ({
      x: u.x + Math.sign(to.x - u.x) * i,
      y: u.y + Math.sign(to.y - u.y) * i,
    }));
    return path.slice(1).every((p) => place(u, p)) ? path : null;
  }
  const queue: Point[][] = [[{ x: u.x, y: u.y }]],
    seen = new Set([key(u)]);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (path.length - 1 >= limit) continue;
    for (const p of neighbors(path.at(-1)!)) {
      if (seen.has(key(p)) || !place(u, p)) continue;
      const next = [...path, p];
      if (equal(p, to)) return next;
      seen.add(key(p));
      queue.push(next);
    }
  }
  return null;
}
export function attackPath(
  s: GamePosition,
  u: Unit,
  target: Target | Point,
  limit: number,
  direction?: AttackDirection,
  pierce = false,
): Point[] | null {
  if (direction !== undefined)
    return (
      attackRoutes(s, u, target, limit, pierce).find((r) => r.direction === direction)?.path ?? null
    );
  const t = 'id' in target ? target : undefined,
    ends = t?.unit ? cells(t.unit) : [target],
    blocked = new Set<string>();
  for (const v of allPieces(s))
    if (!pierce && v.id !== u.id && v.id !== t?.id && allegiance(s, v) !== u.owner)
      for (const p of cells(v)) blocked.add(key(p));
  // 攻击叠放目标时，同一目标格的其他成员不算中途阻挡。
  for (const end of ends) blocked.delete(key(end));
  if (t?.id !== `base-${other(u.owner)}`) blocked.add(key(basePoint(other(u.owner))));
  const queue = cells(u).map((p) => [p]),
    seen = new Set(cells(u).map(key));
  let fallback: Point[] | null = null;
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i],
      depth = path.length - 1;
    if (ends.some((p) => equal(p, path[depth]))) return path;
    if (depth >= limit || (fallback && depth >= fallback.length - 1)) continue;
    for (const p of neighbors(path[depth])) {
      if (blocked.has(key(p))) continue;
      const next = [...path, p];
      if (ends.some((e) => equal(e, p))) {
        fallback ??= next;
        if (!t?.unit || !hasTrait(t.unit, 24) || t.unit.silenced || frontal(next, t.owner))
          return next;
        continue;
      }
      if (!seen.has(key(p))) {
        seen.add(key(p));
        queue.push(next);
      }
    }
  }
  return fallback;
}
export function frontal(path: Point[], owner: Player) {
  if (path.length < 2) return false;
  const a = path.at(-2)!,
    b = path.at(-1)!;
  return owner === 1 ? b.y < a.y : b.y > a.y;
}
/** 从当前占位派生部署行；每枚棋子在接触行计一次，中立与独立地标不计数。 */
export function deploymentRows(s: GamePosition, owner: Player): number[] {
  const counts = Array<number>(14).fill(0);
  for (const u of s.units) {
    const side = allegiance(s, u);
    if (!side) continue;
    // 正方形每个覆盖行只计一枚；无需先展开所有格子再去重。
    const size = u.size ?? definition(u.kind).size ?? 1;
    for (let offset = 0; offset < size; offset++) counts[u.y + offset] += side === owner ? 1 : -1;
  }
  return Array.from({ length: 13 }, (_, i) => i + 1).filter(
    (y) => (owner === 1 ? y <= 8 : y >= 6) || counts[y] >= 2,
  );
}
/** 保留 v2 序列化字段，但它只镜像当前局面，不能作为权限来源。 */
export function refreshDeployment(s: GamePosition, owner: Player) {
  s.deployRows[owner] = deploymentRows(s, owner);
}
export function inSquare(u: Unit, p: Point, radius = 5) {
  return inside(p) && Math.abs(p.x - u.x) <= radius && Math.abs(p.y - u.y) <= radius;
}

/** 最后一步行进方向，供战斗、预览和 AI 共用。 */
export function pathDirection(path: Point[]): AttackDirection | undefined {
  if (path.length < 2) return undefined;
  const a = path.at(-2)!,
    b = path.at(-1)!;
  return b.y < a.y ? 'up' : b.y > a.y ? 'down' : b.x < a.x ? 'left' : 'right';
}
export interface AttackRoute {
  direction: AttackDirection;
  path: Point[];
}
/** 为每个入射方向各保留一条最短合法路径，而非只保留全局最短路。目标格为终点，攻击不能穿过目标再击中背面。不消耗随机数、不改局面，也不接收客户端路径坐标。 */
export function attackRoutes(
  s: GamePosition,
  u: Unit,
  target: Target | Point,
  limit: number,
  pierce = false,
): AttackRoute[] {
  const t = 'id' in target ? target : undefined,
    ends = new Set((t?.unit ? cells(t.unit) : [target]).map(key)),
    blocked = new Set<string>();
  for (const v of allPieces(s))
    if (!pierce && v.id !== u.id && v.id !== t?.id && allegiance(s, v) !== u.owner)
      for (const p of cells(v)) blocked.add(key(p));
  for (const end of ends) blocked.delete(end);
  if (t?.id !== `base-${other(u.owner)}`) blocked.add(key(basePoint(other(u.owner))));
  const queue = cells(u)
      .filter((p) => !ends.has(key(p)))
      .map((p) => [p]),
    seen = new Set(queue.map((p) => key(p[0]))),
    result = new Map<AttackDirection, Point[]>();
  for (let i = 0; i < queue.length && result.size < 4; i++) {
    const path = queue[i];
    if (path.length - 1 >= limit) continue;
    for (const p of neighbors(path.at(-1)!)) {
      if (blocked.has(key(p))) continue;
      const next = [...path, p];
      if (ends.has(key(p))) {
        const direction = pathDirection(next)!;
        if (!result.has(direction)) result.set(direction, next);
      } else if (!seen.has(key(p))) {
        seen.add(key(p));
        queue.push(next);
      }
    }
  }
  return [...result].map(([direction, path]) => ({ direction, path }));
}
/** 方向敏感能力在界面与 AI 中共用同一有界候选集合。 */
export function selectableAttackRoutes(s: GamePosition, u: Unit, t: Target): AttackRoute[] {
  if (piercing(u) && !hasWeapon(u, 'u28')) return [];
  if (
    !(
      piercing(u) ||
      (hasTrait(u, 'u20') && !u.silenced) ||
      (t.unit && hasTrait(t.unit, 24) && !t.unit.silenced)
    )
  )
    return [];
  return attackRoutes(s, u, t, getStats(s, u).range, piercing(u));
}

/** 围绕原格扩展，最终覆盖格在两层都必须无占位。 */
export function expansionAnchors(s: GamePosition, u: Unit): Point[] {
  if (u.size !== 1 || isLandmark(u)) return [];
  return [
    { x: u.x, y: u.y },
    { x: u.x - 1, y: u.y },
    { x: u.x, y: u.y - 1 },
    { x: u.x - 1, y: u.y - 1 },
  ].filter((p) => canPlace(s, { ...u, size: 2 }, p));
}
/** 棋盘预览与命令验证共用；敌方基地只能作为路径终点。 */
export function validAttackRoute(s: GamePosition, u: Unit, path: Point[], limit: number): boolean {
  if (!Array.isArray(path) || !path.length || path.length > Math.min(117, limit + 1)) return false;
  if (path.some((p) => !p || !inside(p))) return false;
  if (!covers(u, path[0]) || new Set(path.map(key)).size !== path.length) return false;
  for (let i = 1; i < path.length; i++) {
    if (distance(path[i - 1], path[i]) !== 1 || covers(u, path[i])) return false;
    if (i < path.length - 1 && equal(path[i], basePoint(other(u.owner)))) return false;
  }
  return true;
}
/** 选定时捕获目标快照，每次齐射对每个栈顶及地标只命中一次，不按格重复。AOE 另按规则处理；路径前缀保留各目标的真实入射方向。 */
export function piercingTargets(s: GamePosition, u: Unit, path: Point[]) {
  const victims: { target: Target; path: Point[] }[] = [];
  const seen = new Set<string>();
  const available = targets(s).filter(
    (t) =>
      t.id !== u.id &&
      (t.unit ? allegiance(s, t.unit) : t.owner) !== u.owner &&
      (topTarget(s, t) || (t.unit && isLandmark(t.unit))),
  );
  for (let i = 1; i < path.length; i++)
    for (const t of available)
      if (!seen.has(t.id) && (t.unit ? cells(t.unit) : [t]).some((p) => equal(p, path[i]))) {
        seen.add(t.id);
        victims.push({ target: t, path: path.slice(0, i + 1) });
      }
  return victims;
}
