import type { EffectBatch } from './vfx/plan';
import type { Command, GamePosition, Point } from '../../engine';
import { definition, faction, isStored, canSkipReaction, queryCommandError } from '../../engine';
import type { Intent } from '../game/selection';
import { instruction } from '../game/selection';
import { Icon } from '../shared/visuals';
import { Board } from './Board';

export function Battlefield({
  state: s,
  intent,
  activeIntent,
  selectedId,
  onCell,
  effects,
  canUndo,
  canRedo,
  rewind,
  run,
  onCancel,
  onTargetLayer,
  endError,
  readOnly = false,
  showHistory = true,
}: {
  state: GamePosition;
  intent: Intent;
  activeIntent: Intent;
  selectedId: string | null;
  onCell: (point: Point) => void;
  effects: EffectBatch[];
  canUndo: boolean;
  canRedo: boolean;
  rewind: (forward?: boolean) => void;
  run: (command: Command) => void;
  onCancel: () => void;
  onTargetLayer: (layer: 'unit' | 'landmark') => void;
  endError: string | null;
  readOnly?: boolean;
  showHistory?: boolean;
}) {
  const reaction = s.pending[0],
    maySkip = canSkipReaction(s),
    pullError =
      reaction?.kind === 'hit-pull' ? queryCommandError(s, { type: 'react', mode: 'pull' }) : null,
    minions = s.hands[s.active].filter((c) => !isStored(definition(c.kind))).length;
  return (
    <section className="battle-column">
      <div className={`instruction-bar ${reaction ? 'reaction-bar' : ''}`} role="status">
        <span className="instruction-icon">
          <Icon name={reaction ? 'spark' : 'target'} />
        </span>
        <p>
          {reaction ? `${faction(reaction.owner)} · ` : ''}
          {instruction(s, activeIntent)}
        </p>
        {intent.kind !== 'none' && !reaction && (
          <button className="icon-button" aria-label="取消当前操作" onClick={() => onCancel()}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {activeIntent.kind === 'select' &&
        activeIntent.action.steps[activeIntent.index]?.kind === 'target' &&
        !!s.landmarks?.length &&
        !reaction && (
          <div className="target-layer" role="group" aria-label="选择目标层">
            {(['unit', 'landmark'] as const).map((layer) => (
              <button
                key={layer}
                disabled={readOnly}
                aria-pressed={(activeIntent.targetLayer ?? 'unit') === layer}
                onClick={() => onTargetLayer(layer)}
              >
                {layer === 'unit' ? '目标：随从 / 基地' : '目标：地标'}
              </button>
            ))}
          </div>
        )}
      <div className="board-viewport">
        <Board
          state={s}
          intent={activeIntent}
          selectedId={selectedId}
          onCell={onCell}
          effects={effects}
        />
      </div>
      <div className="command-bar">
        {showHistory && (
          <div className="history-actions">
            <button aria-label="悔棋" disabled={!canUndo} onClick={() => rewind()}>
              <Icon name="undo" />
              悔棋
            </button>
            <button aria-label="重做" disabled={!canRedo} onClick={() => rewind(true)}>
              <Icon name="redo" />
            </button>
          </div>
        )}
        {reaction?.kind === 'hit-pull' && (
          <button
            className="primary"
            disabled={readOnly || !!pullError}
            onClick={() => run({ type: 'react', mode: 'pull' })}
          >
            牵引命中目标
          </button>
        )}
        {reaction ? (
          <button
            className="secondary finish-button"
            disabled={readOnly || !maySkip}
            onClick={() => run({ type: 'react' })}
          >
            {reaction.kind === 'bounce'
              ? '必须弹出空地'
              : !maySkip
                ? '请选择召唤落点'
                : '放弃此效果'}
            <Icon name="arrow" />
          </button>
        ) : (
          <button
            className="primary finish-button"
            disabled={!!endError}
            title={endError ?? '结束回合'}
            onClick={() => run({ type: 'end' })}
          >
            结束回合
            <Icon name="arrow" />
          </button>
        )}
      </div>
      <p className="turn-hint">
        {reaction
          ? pullError
            ? `${pullError}可放弃此效果。`
            : '效果由所属玩家处理，之后回到原有流程。'
          : s.phase === 'synthesis'
            ? showHistory
              ? '合成与部署一次确认；可取消选点或悔棋。'
              : '合成与部署一次确认；可取消选点。'
            : s.phase === 'summon'
              ? '在手牌区完成召唤选择，再开始行动。'
              : minions
                ? `还有 ${minions} 枚随从待部署。`
                : '可以继续操作，或交给对手。'}
      </p>
    </section>
  );
}
