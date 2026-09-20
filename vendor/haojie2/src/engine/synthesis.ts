import { grantLaoqian } from './shrines';
import { hasAura } from './traits';
/** Author's 2.5 recipes. Eligibility and atomic placement are shared by UI and AI. */
import { definition } from './catalog';
import { ALL_CELLS, canPlace } from './geometry';
import { addUnit, allegiance, emit, ensure, point, template } from './state';
import type { Command, GamePosition, Kind, Point } from './types';
export interface SynthesisRecipe {
  id: string;
  material: Kind;
  result: Kind;
  source: 'board' | 'hand';
}
export const SYNTHESIS_RECIPES: readonly SynthesisRecipe[] = [
  { id: 'laoqian', material: 'u13', result: 'laoqian', source: 'board' },
  { id: 'szf', material: 'u12p', result: 'u12', source: 'board' },
  { id: 'sage', material: 'u21', result: 'sage', source: 'board' },
  { id: 'formless', material: 'u23', result: 'formless', source: 'board' },
  { id: 'slayer', material: 'u8', result: 'slayer', source: 'board' },
  { id: 'citadel', material: 'u22', result: 'citadel', source: 'board' },
  { id: 'firelord', material: 'u28', result: 'firelord', source: 'hand' },
  { id: 'archmage', material: 'u3', result: 'archmage', source: 'board' },
];
export function synthesisMaterials(s: GamePosition, recipe: SynthesisRecipe): string[] {
  if (recipe.result === 'laoqian' && hasAura(s, s.active, 'laoqian')) return [];
  return recipe.source === 'board'
    ? s.units
        .filter((u) => u.kind === recipe.material && allegiance(s, u) === s.active)
        .map((u) => u.id)
    : s.hands[s.active]
        .filter(
          (c) =>
            c.kind === recipe.material &&
            (c.expiresAt === undefined || c.expiresAt > s.turns[s.active]),
        )
        .map((c) => c.id);
}
export function availableSyntheses(s: GamePosition) {
  return SYNTHESIS_RECIPES.map((recipe) => ({ recipe, ids: synthesisMaterials(s, recipe) })).filter(
    (v) => v.ids.length >= 3,
  );
}
export function synthesisPlacement(
  s: GamePosition,
  recipe: SynthesisRecipe,
  ids: string[],
  to: Point,
) {
  if (
    ids.length !== 3 ||
    new Set(ids).size !== 3 ||
    !ids.every((id) => synthesisMaterials(s, recipe).includes(id))
  )
    return false;
  if (definition(recipe.result).aura) return true;
  const view =
    recipe.source === 'board' ? { ...s, units: s.units.filter((u) => !ids.includes(u.id)) } : s;
  const ghost = template(recipe.result, s.active, s.turns[s.active], to);
  return canPlace(view, ghost, to, true);
}
export function synthesisDestinations(s: GamePosition, recipe: SynthesisRecipe, ids: string[]) {
  if (definition(recipe.result).aura) return [];
  return ALL_CELLS.filter((p) => synthesisPlacement(s, recipe, ids, p));
}
export function synthesize(s: GamePosition, c: Command) {
  ensure(s.phase === 'synthesis' && !s.pending.length, '合成仅限己方回合开始的合成窗口。');
  const recipe = SYNTHESIS_RECIPES.find((r) => r.id === c.recipeId);
  ensure(recipe, '请选择有效的合成配方。');
  const ids = c.materialIds ?? [];
  const to = definition(recipe.result).aura ? { x: 0, y: 0 } : point(c.x, c.y);
  ensure(
    synthesisPlacement(s, recipe, ids, to),
    '需要3个不同的合法材料，以及移除材料后己方召唤区域内的合法落点。',
  );
  // Removal is not death: no grave/death record, head, lifesteal, deathrattle or spawn trigger.
  if (recipe.source === 'board') {
    s.units = s.units.filter((u) => !ids.includes(u.id));
    s.siphons = s.siphons.filter(
      (l) => ![l.sourceId, l.fromId, l.toId].some((id) => ids.includes(id)),
    );
    s.iceMarks = s.iceMarks.filter((m) => !ids.includes(m.sourceId));
  } else s.hands[s.active] = s.hands[s.active].filter((v) => !ids.includes(v.id));
  if (recipe.result === 'laoqian') {
    grantLaoqian(s);
    if (!availableSyntheses(s).length) s.phase = 'summon';
    return;
  }
  const result = addUnit(s, recipe.result, s.active, to);
  emit(
    s,
    {
      type: 'skill',
      action: 'buff',
      to: result,
      unitId: result.id,
      owner: s.active,
      text: '合成 · ' + definition(recipe.result).name,
    },
    `3个${definition(recipe.material).name}合成为${definition(recipe.result).name}`,
  );
  if (!availableSyntheses(s).length) s.phase = 'summon';
}
