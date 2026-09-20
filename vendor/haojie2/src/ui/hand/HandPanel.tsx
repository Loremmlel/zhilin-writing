import { ShrinePanel } from '../shrine/ShrinePanel';
import type { MatchSettings } from '../../match/settings';
import type { ActionSpec, Command, GamePosition, Player } from '../../engine';
import { faction } from '../../engine';
import { Icon } from '../shared/visuals';
import { HandCard } from './HandCard';
import { SynthesisControls } from './SynthesisControls';
import { SummonControls } from './SummonControls';

export function HandPanel({
  state: s,
  match,
  cardId,
  chooseCard,
  chooseAction,
  run,
  readOnly = false,
  viewer,
}: {
  state: GamePosition;
  match: MatchSettings;
  cardId: string | null;
  chooseCard: (id: string) => void;
  chooseAction: (a: ActionSpec) => void;
  run: (command: Command) => void;
  readOnly?: boolean;
  viewer?: Player;
}) {
  const hand = s.hands[s.active],
    reaction = s.pending[0];
  return (
    <section className={`panel hand-panel ${s.phase === 'summon' ? 'summoning' : ''}`}>
      <div className="panel-heading">
        <h2>
          {s.phase === 'shrine-draft'
            ? '第0回合 · 神龛暗选'
            : s.phase === 'shrine-setup'
              ? '第0回合 · 入场'
              : s.phase === 'synthesis'
                ? '回合开始 · 合成'
                : s.phase === 'summon'
                  ? '召唤仪式'
                  : '本回合手牌'}
          {s.phase !== 'synthesis' && <b>{hand.length}</b>}
        </h2>
        <Icon name="spark" size={17} />
      </div>
      {s.phase === 'synthesis' && (
        <SynthesisControls
          key={`${s.ply}:${s.serial}`}
          state={s}
          run={run}
          chooseAction={chooseAction}
          readOnly={readOnly}
        />
      )}
      <ShrinePanel
        viewer={viewer}
        state={s}
        match={match}
        run={run}
        chooseAction={chooseAction}
        readOnly={readOnly}
      />
      <SummonControls state={s} run={run} readOnly={readOnly} />
      {s.phase !== 'shrine-draft' && (
        <p className="hand-intro">
          <span className={`tiny-side p${s.active}`} />
          {faction(s.active)}
          <span>
            {s.mode === 'shrine'
              ? '神龛可储存 · 随机随从须部署'
              : '随从必须部署 · 法术与武器可储存'}
          </span>
        </p>
      )}
      <div className="hand-cards">
        {hand.map((c) => (
          <HandCard
            key={c.id}
            card={c}
            owner={s.active}
            turn={s.turns[s.active]}
            selected={c.id === cardId}
            disabled={readOnly || !!reaction || !!s.winner || s.phase === 'synthesis'}
            onChoose={chooseCard}
          />
        ))}
        {hand.length === 0 && s.phase === 'play' && (
          <div className="empty-hand">
            <Icon name="check" size={28} />
            <p>手牌已全部处理</p>
          </div>
        )}
      </div>
    </section>
  );
}
