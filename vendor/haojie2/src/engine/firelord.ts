import { hasTrait } from './traits';
import { COMBAT_RULES } from './catalog';
import { cells, equal, inside, neighbors, other, targets } from './geometry';
import { allegiance, passive, has } from './state';
import type { GamePosition, Unit } from './types';
/** Exact target/impact snapshot. 13×13 geometry is not ordinary path-based attack range. */
export function firelordStrike(s: GamePosition, lord: Unit) {
  if (!hasTrait(lord, 'firelord') || !passive(s, lord) || has(s, lord, 'freeze')) return null;
  const inArea = (p: { x: number; y: number }) =>
    inside(p) &&
    Math.abs(p.x - lord.x) <= COMBAT_RULES.firelord.radius &&
    Math.abs(p.y - lord.y) <= COMBAT_RULES.firelord.radius;
  const enemies = targets(s).filter(
    (t) => (t.unit ? allegiance(s, t.unit) : t.owner) !== lord.owner,
  );
  const candidates = enemies.filter((t) => (t.unit ? cells(t.unit) : [t]).some(inArea));
  candidates.sort(
    (a, b) =>
      (b.unit?.hp ?? s.bases[b.owner]) - (a.unit?.hp ?? s.bases[a.owner]) ||
      a.y - b.y ||
      a.x - b.x ||
      a.id.localeCompare(b.id),
  );
  const target = candidates[0];
  if (!target) return null;
  const cell = (target.unit ? cells(target.unit) : [target])
    .filter(inArea)
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
  const impact = { x: cell.x, y: cell.y };
  const primary = enemies.filter((t) =>
    (t.unit ? cells(t.unit) : [t]).some((p) => equal(p, impact)),
  );
  const area = neighbors(impact);
  const splash = enemies.filter((t) =>
    (t.unit ? cells(t.unit) : [t]).some((p) => area.some((q) => equal(p, q))),
  );
  return { target, impact, primary, splash, area: [impact, ...area] };
}
