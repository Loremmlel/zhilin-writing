import { useState } from 'react';
import {
  commandSummonPool,
  definition,
  selectableSummons,
  type Command,
  type GamePosition,
  type Kind,
} from '../../engine';
import { Modal } from '../shared/Modal';
import { DefinitionCard } from '../library/DefinitionCard';

/** 仅拦截人类抽取命令；引擎原子验证来源池、费用和次数。 */
export function SummonChoiceDialog({
  state,
  command,
  onClose,
  onConfirm,
}: {
  state: GamePosition;
  command: Command;
  onClose: () => void;
  onConfirm: (c: Command) => void;
}) {
  const pool = commandSummonPool(state, command);
  const [choice, setChoice] = useState('');
  const kinds = selectableSummons(pool === 'ultimate');
  const kind = kinds.find((k) => String(k) === choice);
  return (
    <Modal
      title="牢千K · 自选召唤"
      subtitle="每个己方回合一次。保留随机不会消耗能力；自选不会免除本次召唤的人头费用。"
      onClose={onClose}
    >
      <label className="rules-choice">
        {pool === 'ultimate' ? '终极召唤池' : '普通召唤池'}
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">保留随机召唤</option>
          {kinds.map((k) => (
            <option key={k} value={String(k)}>
              {definition(k).name}
            </option>
          ))}
        </select>
      </label>
      {kind !== undefined && (
        <div className="shrine-preview">
          <DefinitionCard d={definition(kind)} />
        </div>
      )}
      <button
        className="primary"
        onClick={() =>
          onConfirm({ ...command, ...(kind !== undefined ? { chosenKind: kind as Kind } : {}) })
        }
      >
        {kind === undefined ? '随机召唤 · 保留能力' : '确定自选 · 消耗本回合能力'}
      </button>
    </Modal>
  );
}
