import { hasTrait } from './traits';
import { attackPath } from './geometry';
import { allegiance, asTarget, getStats, passive } from './state';
import type { GamePosition, Unit } from '../types';

/** 旧档不能还原总保护标志由哪个来源消耗，保守地将当时已有友方来源标为已用；新部署来源仍可使用。 */
export function spentGuardSources(s: GamePosition, u: Unit): readonly string[] {
  return (
    u.guardSourceIds ??
    (u.guardUsed
      ? s.units.filter((v) => hasTrait(v, 3) && v.owner === u.owner).map((v) => v.id)
      : [])
  );
}
export function normalizeLegacyGuards(s: GamePosition) {
  for (const u of s.units) {
    if (u.guardUsed && u.guardSourceIds === undefined)
      u.guardSourceIds = [...spentGuardSources(s, u)];
  }
}
/** 伤害、AI 和状态面板共用；入场时间相同时按数组顺序决定先后。 */
export function guardProtections(s: GamePosition, u: Unit) {
  const used = spentGuardSources(s, u);
  return s.units
    .filter(
      (v) =>
        hasTrait(v, 3) &&
        allegiance(s, v) === u.owner &&
        passive(s, v) &&
        attackPath(s, v, asTarget(u), getStats(s, v).range),
    )
    .sort((a, b) => a.deployedAt - b.deployedAt)
    .map((source) => ({ source, used: used.includes(source.id) }));
}
export function availableGuardians(s: GamePosition, u: Unit): Unit[] {
  return guardProtections(s, u)
    .filter((p) => !p.used)
    .map((p) => p.source);
}
