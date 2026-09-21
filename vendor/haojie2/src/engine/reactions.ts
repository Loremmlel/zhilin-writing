import { hasTrait, isHookImmune } from './traits';
import { ALL_CELLS, attackPath, canPlace } from './geometry';
import { allegiance, getStats, passive, template } from './state';
import type { GamePosition, Reaction } from './types';
export function hutSpawnPoints(s: GamePosition, r: Reaction) {
  const hut = s.units.find((u) => u.id === r.source.id);
  if (!hut || !passive(s, hut) || hut.owner !== r.owner || hut.maxHp < 10) return [];
  const ghost = template(20, r.owner, s.turns[r.owner], { x: 1, y: 1 });
  return ALL_CELLS.filter(
    (p) => canPlace(s, ghost, p) && attackPath(s, hut, p, getStats(s, hut).range),
  );
}
export function hitPullDestination(s: GamePosition, r: Reaction) {
  const source = s.units.find((u) => u.id === r.source.id);
  const victim = s.units.find((u) => u.id === r.targetId);
  if (
    !source ||
    !victim ||
    isHookImmune(victim) ||
    source.owner !== r.owner ||
    !passive(s, source) ||
    allegiance(s, victim) === r.owner
  )
    return null;
  const to = {
    x: source.x,
    y: source.owner === 1 ? source.y + source.size : source.y - victim.size,
  };
  return canPlace(s, victim, to) ? to : null;
}
export function canSkipReaction(s: GamePosition) {
  const r = s.pending[0];
  if (!r) return false;
  return (
    r.kind !== 'bounce' &&
    !(r.kind === 'hut-spawn' && hasTrait(r.source, 'citadel') && hutSpawnPoints(s, r).length)
  );
}
