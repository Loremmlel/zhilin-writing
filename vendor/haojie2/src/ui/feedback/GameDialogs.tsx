import { UnitText } from '../library/UnitReference';
import type { MatchSettings } from '../../match/settings';
import { MatchOptions } from '../opponent/MatchOptions';
import { useState } from 'react';
import type { GamePosition } from '../../engine';
import type { GameModal } from '../game/interaction/types';
import { Codex } from '../library/Codex';
import { Rules } from '../library/Rules';
import { Modal } from '../shared/Modal';
import { Icon } from '../shared/visuals';

export function GameDialogs({
  modal,
  state: s,
  onClose,
  startGame,
  match,
}: {
  modal: GameModal;
  state: GamePosition;
  onClose: () => void;
  match: MatchSettings;
  startGame?: (seedText: string, demo: boolean, match: MatchSettings) => void;
}) {
  const [seedText, setSeedText] = useState('');
  const [settings, setSettings] = useState(match);
  return (
    <>
      {modal === 'codex' && <Codex onClose={() => onClose()} />}
      {modal === 'rules' && <Rules onClose={() => onClose()} />}
      {modal === 'log' && (
        <Modal
          title="战场纪事"
          subtitle={startGame ? '最近180条事件；悔棋时一并恢复。' : '最近180条公开事件。'}
          onClose={() => onClose()}
        >
          <ol className="full-log">
            {s.log.map((line, i) => (
              <li key={i}>
                <UnitText>{line}</UnitText>
              </li>
            ))}
          </ol>
        </Modal>
      )}
      {modal === 'new' && startGame && (
        <Modal
          title="浩劫，再起"
          subtitle="当前局面会被替换。重要对局请先导出存档。"
          onClose={() => onClose()}
        >
          <div className="new-match-art">
            <Icon name="sword" size={44} />
            <span>26普通召唤 · 28终极召唤 · 117格战场</span>
          </div>
          <MatchOptions value={settings} onChange={setSettings} />
          <label className="seed-field">
            对局种子<span>留空随机</span>
            <input
              type="number"
              step="1"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder="例如 20260907"
            />
          </label>
          <button
            className="primary full-width"
            onClick={() => startGame(seedText, false, settings)}
          >
            开始正式对局
            <Icon name="arrow" />
          </button>
          <button
            className="secondary full-width"
            onClick={() => startGame(seedText, true, settings)}
          >
            载入演示棋局
          </button>
          <p className="fine-print">
            正式对局空棋盘、300血、0人头。演示局包含终极随从、装备、叠放和可兑换人头。
          </p>
        </Modal>
      )}
    </>
  );
}
