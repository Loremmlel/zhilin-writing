import { useState } from 'react';
import { availableSyntheses, definition, synthesisDestinations } from '../../engine';
import type { ActionSpec, Command, GamePosition } from '../../engine';
/** Transient selection only; material removal + deployment are one engine command. */
export function SynthesisControls({
  state: s,
  run,
  chooseAction,
  readOnly,
}: {
  state: GamePosition;
  run: (c: Command) => void;
  chooseAction: (a: ActionSpec) => void;
  readOnly: boolean;
}) {
  const options = availableSyntheses(s);
  const [recipeId, setRecipeId] = useState(options[0]?.recipe.id ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const option = options.find((v) => v.recipe.id === recipeId);
  const disabled = readOnly || !!s.pending.length;
  const locations =
    option && selected.length === 3 ? synthesisDestinations(s, option.recipe, selected) : [];
  return (
    <div className="synthesis-controls">
      <p>回合开始 · 选择3个材料，再选择召唤落点。合成不消耗召唤次数。</p>
      <div className="synthesis-recipes" aria-label="可用合成配方">
        {options.map(({ recipe, ids }) => (
          <button
            key={recipe.id}
            disabled={disabled}
            aria-pressed={recipeId === recipe.id}
            onClick={() => {
              setRecipeId(recipe.id);
              setSelected([]);
            }}
          >
            {definition(recipe.result).name}
            <small>
              {definition(recipe.material).name} · {ids.length}/3
            </small>
          </button>
        ))}
      </div>
      {option && (
        <>
          <p className="synthesis-description">{definition(option.recipe.result).description}</p>
          <fieldset disabled={disabled}>
            <legend>选择材料 · {selected.length}/3</legend>
            {option.ids.map((id) => {
              const unit = s.units.find((u) => u.id === id);
              const card = s.hands[s.active].find((c) => c.id === id);
              const label = unit
                ? `(${unit.x},${unit.y}) · 生命 ${unit.hp}/${unit.maxHp}${unit.equipment.length ? ' · 装备也会移除' : ''}`
                : `未装备手牌 · 余 ${(card?.expiresAt ?? s.turns[s.active]) - s.turns[s.active]} 回合`;
              return (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(id)}
                    disabled={!selected.includes(id) && selected.length >= 3}
                    onChange={() =>
                      setSelected((old) =>
                        old.includes(id) ? old.filter((v) => v !== id) : [...old, id],
                      )
                    }
                  />
                  <span>
                    {definition(option.recipe.material).name}
                    <small>{label}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="synthesis-note">
            材料移除不触发亡语、不产人头；装备和效果不继承。落点确认前不会花费材料。
          </p>
          {selected.length === 3 && !locations.length && !definition(option.recipe.result).aura && (
            <p role="status">移除所选材料后仍没有合法召唤格，请换一组材料或跳过合成。</p>
          )}
          <button
            className="primary"
            disabled={
              disabled ||
              selected.length !== 3 ||
              (!locations.length && !definition(option.recipe.result).aura)
            }
            onClick={() =>
              chooseAction({
                id: 'synthesis-' + option.recipe.id,
                label: '合成 · ' + definition(option.recipe.result).name,
                icon: 'spark',
                command: {
                  type: 'synthesize',
                  recipeId: option.recipe.id,
                  materialIds: [...selected],
                },
                steps: definition(option.recipe.result).aura
                  ? []
                  : [{ kind: 'point', label: '选择合成落点：点击高亮格，移除所选3个材料并召唤' }],
              })
            }
          >
            {definition(option.recipe.result).aura ? '启用光环' : '选择落点'} · 合成
            {definition(option.recipe.result).name}
          </button>
        </>
      )}
      {!options.length && <p>当前没有满足条件的材料。</p>}
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => run({ type: 'skip-synthesis' })}
      >
        不再合成，进入召唤
      </button>
    </div>
  );
}
