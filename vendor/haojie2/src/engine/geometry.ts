import { allPieces, hasTrait, isLandmark } from './traits';
import { landmarkAt, landmarkSquare, liveLandmark } from './shrines';
import { definition } from './catalog';
import { allegiance, getStats, has, passive, piercing, hasWeapon } from './state';
import type { AttackDirection, GamePosition, Player, Point, Target, Unit } from './types';
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
  return Array.from({ length: size * size }, (_, i) => ({
    x: u.x + (i % size),
    y: u.y + Math.floor(i / size),
  }));
}
export const occupants = (s: GamePosition, p: Point) =>
  s.units.filter((u) => cells(u).some((c) => equal(c, p)));
export const occupant = (s: GamePosition, p: Point) => occupants(s, p)[0];
export function targets(s: GamePosition): Target[] {
  return [
    ...allPieces(s).map((u) => ({ id: u.id, owner: u.owner, x: u.x, y: u.y, unit: u })),
    ...([1, 2] as Player[]).map((p) => ({ id: `base-${p}`, owner: p, ...basePoint(p) })),
  ];
}
export function targetAt(s: GamePosition, p: Point): Target | undefined {
  return targets(s).find((t) => (t.unit ? cells(t.unit).some((c) => equal(c, p)) : equal(t, p)));
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
export function canPlace(
  s: GamePosition,
  u: Unit,
  at: Point,
  deployment = false,
  ignore: string[] = [],
): boolean {
  const moved = { ...u, ...at },
    footprint = cells(moved);
  if (footprint.some((p) => !inside(p) || equal(p, basePoint(1)) || equal(p, basePoint(2))))
    return false;
  if (isLandmark(u)) {
    if (!deployment) return equal(u, at);
    if (!landmarkSquare(u.kind, at) || landmarkAt(s, at)) return false;
    const over = occupants(s, at).filter((v) => !ignore.includes(v.id));
    return over.length <= 1 && over.every((v) => allegiance(s, v) === u.owner);
  }
  if (
    deployment &&
    !hasTrait(u, 'u27') &&
    footprint.some((p) => {
      const land = landmarkAt(s, p);
      return (
        !s.deployRows[u.owner].includes(p.y) &&
        !(liveLandmark(land) && allegiance(s, land) === u.owner)
      );
    })
  )
    return false;
  for (const p of footprint) {
    const land = landmarkAt(s, p);
    if (!land) continue;
    if (u.size > 1) return false;
    if (deployment && liveLandmark(land) && allegiance(s, land) !== u.owner) return false;
    // Landmarks support one unit, never a clone stack, even while dormant.
    if (occupants(s, p).some((v) => v.id !== u.id && !ignore.includes(v.id))) return false;
  }
  const others = s.units.filter((v) => v.id !== u.id && !ignore.includes(v.id));
  if (
    others.some(
      (v) =>
        cells(v).some((c) => footprint.some((p) => equal(c, p))) &&
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
  if (
    others.some(
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
  if (!inside(to) || equal(u, to) || !canPlace(s, u, to)) return null;
  if (straight) {
    if (distance(u, to) !== 3 || (u.x !== to.x && u.y !== to.y)) return null;
    const path = Array.from({ length: 4 }, (_, i) => ({
      x: u.x + Math.sign(to.x - u.x) * i,
      y: u.y + Math.sign(to.y - u.y) * i,
    }));
    return path.slice(1).every((p) => canPlace(s, u, p)) ? path : null;
  }
  const queue: Point[][] = [[{ x: u.x, y: u.y }]],
    seen = new Set([key(u)]);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (path.length - 1 >= limit) continue;
    for (const p of neighbors(path.at(-1)!)) {
      if (seen.has(key(p)) || !canPlace(s, u, p)) continue;
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
  // When attacking a stack, other members on its target square are not intervening blockers.
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
export function refreshDeployment(s: GamePosition, owner: Player) {
  s.deployRows[owner] = [];
  for (let y = 1; y <= 13; y++) {
    const count = (p: Player) =>
      s.units.filter((u) => allegiance(s, u) === p && cells(u).some((c) => c.y === y)).length;
    if ((owner === 1 ? y <= 8 : y >= 6) || count(owner) - count(other(owner)) >= 2)
      s.deployRows[owner].push(y);
  }
}
export function inSquare(u: Unit, p: Point, radius = 5) {
  return inside(p) && Math.abs(p.x - u.x) <= radius && Math.abs(p.y - u.y) <= radius;
}

/** Final travel direction, shared by combat, previews and AI. */
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
/** One shortest legal route per incoming direction, not just globally shortest routes.
 * Target cells are terminal: a shot cannot pass through its target to hit its back.
 * No RNG, state mutation or user-supplied path coordinates are involved. */
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
/** Direction-sensitive abilities use this same bounded choice set in UI and AI. */
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

/** Grow around the original square; every final cell must be unoccupied in both layers. */
export function expansionAnchors(s: GamePosition, u: Unit): Point[] {
  if (u.size !== 1 || isLandmark(u)) return [];
  return [
    { x: u.x, y: u.y },
    { x: u.x - 1, y: u.y },
    { x: u.x, y: u.y - 1 },
    { x: u.x - 1, y: u.y - 1 },
  ].filter((p) => canPlace(s, { ...u, size: 2 }, p));
}
/** Used by the board preview AND command validation. Enemy bases are terminal. */
export function validAttackRoute(s: GamePosition, u: Unit, path: Point[], limit: number): boolean {
  if (!Array.isArray(path) || !path.length || path.length > Math.min(117, limit + 1)) return false;
  if (path.some((p) => !p || !inside(p))) return false;
  if (!cells(u).some((p) => equal(p, path[0])) || new Set(path.map(key)).size !== path.length)
    return false;
  for (let i = 1; i < path.length; i++) {
    if (distance(path[i - 1], path[i]) !== 1 || cells(u).some((p) => equal(p, path[i])))
      return false;
    if (i < path.length - 1 && equal(path[i], basePoint(other(u.owner)))) return false;
  }
  return true;
}
/** Snapshot at selection time: each stack top and landmark is hit once per volley, not per cell.
 * AOE is intentionally different. Prefixes preserve each victim's actual incoming direction. */
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
