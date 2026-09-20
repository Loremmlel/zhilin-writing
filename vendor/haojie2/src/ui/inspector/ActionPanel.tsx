import type { Dispatch, SetStateAction } from 'react';
import type { ActionSpec, GamePosition } from '../../engine';
import { actionError, definition, queryCommandError, allPieces, getStats } from '../../engine';
import type { Intent } from '../game/selection';
import { Icon } from '../shared/visuals';

export function ActionPanel({
  state: s,
  actions,
  intent,
  activeIntent,
  setIntent,
  chooseAction,
  deaths,
}: {
  state: GamePosition;
  actions: ActionSpec[];
  intent: Intent;
  activeIntent: Intent;
  setIntent: Dispatch<SetStateAction<Intent>>;
  chooseAction: (action: ActionSpec) => void;
  deaths: GamePosition['deaths'];
}) {
  const reaction = s.pending[0];
  const drawing =
    activeIntent.kind === 'select' && activeIntent.action.steps[activeIntent.index]?.kind === 'path'
      ? activeIntent
      : null;
  const moving =
    activeIntent.kind === 'select' && activeIntent.draft.type === 'move' ? activeIntent : null;
  const mover = moving ? allPieces(s).find((u) => u.id === moving.draft.unitId) : undefined;
  const pathError = drawing ? queryCommandError(s, drawing.draft) : null;
  const archer = drawing ? allPieces(s).find((u) => u.id === drawing.draft.unitId) : undefined;
  return (
    <>
      {!reaction && actions.length > 0 && (
        <div className="unit-actions">
          <h4>选择操作 · 剩余攻击不能换模式</h4>
          <div className="v2-actions">
            {actions.map((a) => {
              const error = actionError(s, a);
              return (
                <button
                  key={a.id}
                  disabled={!!error}
                  title={error ?? a.label}
                  aria-pressed={intent.kind === 'select' && intent.action.id === a.id}
                  onClick={() => chooseAction(a)}
                  className={a.free ? 'free-action' : ''}
                >
                  <Icon name={a.icon} size={14} />
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {moving && mover && mover.size > 1 && (
        <div className="v2-actions move-directions" aria-label="大体型移动方向">
          {[
            ['↑ 向上一格', 0, -1],
            ['↓ 向下一格', 0, 1],
            ['← 向左一格', -1, 0],
            ['→ 向右一格', 1, 0],
          ].map(([label, dx, dy]) => {
            const command = { ...moving.draft, x: mover.x + Number(dx), y: mover.y + Number(dy) };
            const error = queryCommandError(s, command);
            return (
              <button
                key={label}
                disabled={!!error}
                title={error ?? String(label)}
                onClick={() => chooseAction({ ...moving.action, command, steps: [] })}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {drawing && (
        <div className="path-controls">
          <p role="status">
            已选路径 {Math.max(0, (drawing.draft.path?.length ?? 1) - 1)} /{' '}
            {archer ? getStats(s, archer).range : 0} 格
          </p>
          <div className="v2-actions">
            <button
              disabled={!drawing.draft.path?.length}
              onClick={() =>
                setIntent({
                  ...drawing,
                  draft: { ...drawing.draft, path: drawing.draft.path?.slice(0, -1) },
                })
              }
            >
              撤回一格
            </button>
            <button
              disabled={!!pathError}
              title={pathError ?? '确认攻击'}
              onClick={() => chooseAction({ ...drawing.action, command: drawing.draft, steps: [] })}
            >
              确认攻击
            </button>
          </div>
          <p className="sequence-hint">
            {pathError
              ? '先从自身边缘出发，逐格选出命中敌方的路径。'
              : '按确认沿所选路径攻击；每名敌人只受一次攻击及灼烧。'}
          </p>
        </div>
      )}
      {activeIntent.kind === 'select' &&
        activeIntent.action.steps[activeIntent.index]?.kind === 'death' && (
          <div className="revival-picker">
            <h4>可复活的近期阵亡友方</h4>
            {deaths.length ? (
              deaths.map((r) => (
                <button
                  key={r.id}
                  onClick={() =>
                    setIntent({
                      ...activeIntent,
                      draft: { ...activeIntent.draft, deathId: r.id },
                      index: activeIntent.index + 1,
                    })
                  }
                >
                  {definition(r.kind).name}
                  <small>第{Math.ceil(r.ply / 2)}轮阵亡</small>
                </button>
              ))
            ) : (
              <p>最近两个己方回合窗口内没有可复活目标。</p>
            )}
          </div>
        )}
    </>
  );
}
