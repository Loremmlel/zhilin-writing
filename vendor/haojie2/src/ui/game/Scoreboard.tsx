import type { GamePosition, Player } from '../../engine';
import { faction } from '../../engine';
import { Icon, playerStyle } from '../shared/visuals';

export function Scoreboard({ state: s, human }: { state: GamePosition; human?: Player }) {
  const reaction = s.pending[0],
    controller = reaction?.owner ?? s.active;
  return (
    <section className="scoreboard" aria-label="双方基地、人头与回合状态">
      {([1, 2] as Player[]).map((p) => (
        <div
          key={p}
          className={`player-score p${p} ${controller === p ? 'current-player' : ''}`}
          style={playerStyle(p)}
        >
          <div className="player-seal">
            <Icon name="crown" size={28} />
          </div>
          <div className="player-score-main">
            <div className="player-name">
              <h2>{faction(p)}</h2>
              <span>PLAYER 0{p}</span>
              {controller === p && (
                <b>{reaction ? '结算中' : human && human !== p ? 'AI回合' : '你的回合'}</b>
              )}
            </div>
            <div className="base-readout">
              <strong>{s.bases[p]}</strong>
              <span>/ 300</span>
              <small className="heads-readout" aria-label={`${faction(p)}人头${s.heads[p]}`}>
                <Icon name="sword" size={12} />
                <b>{s.heads[p]}</b> 人头
              </small>
            </div>
            <div className="base-health">
              <i style={{ width: `${(s.bases[p] / 300) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
      <div className="round-medallion">
        <span>ROUND</span>
        <strong>{String(Math.ceil(s.ply / 2)).padStart(2, '0')}</strong>
        <i>
          {s.winner
            ? '终局'
            : reaction
              ? '效果结算'
              : s.phase === 'shrine-draft'
                ? '秘密选神龛'
                : s.phase === 'shrine-setup'
                  ? '神龛入场'
                  : s.phase === 'synthesis'
                    ? '选择合成'
                    : s.phase === 'summon'
                      ? '召唤阶段'
                      : '行动阶段'}
        </i>
      </div>
    </section>
  );
}
