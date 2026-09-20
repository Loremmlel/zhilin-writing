import { useState } from 'react';
import { definition, summonRerolls, type Command, type GamePosition } from '../../engine';
import { RerollControls } from './RerollControls';
import { Icon } from '../shared/visuals';

function SummonOffer({
  state: s,
  run,
  readOnly,
}: {
  state: GamePosition;
  run: (c: Command) => void;
  readOnly: boolean;
}) {
  const [indices, setIndices] = useState<number[]>([]);
  return (
    <div className="summon-offer">
      <p>老千K · 从{s.summonOffer!.groups.length}组结果中选两个。整批克隆计为一组。</p>
      {s.summonOffer!.groups.map((group, index) => (
        <label key={index}>
          <input
            type="checkbox"
            checked={indices.includes(index)}
            disabled={readOnly || (indices.length >= 2 && !indices.includes(index))}
            onChange={() =>
              setIndices((old) =>
                old.includes(index) ? old.filter((i) => i !== index) : [...old, index],
              )
            }
          />
          <span>
            <b>
              {definition(group[0].kind).name}
              {group.length > 1 ? ` × ${group.length}` : ''}
            </b>
            <small>{definition(group[0].kind).description}</small>
          </span>
        </label>
      ))}
      <button
        className="primary"
        disabled={readOnly || indices.length !== 2}
        onClick={() => run({ type: 'choose-summons', offerIndices: indices })}
      >
        保留两个召唤结果
      </button>
    </div>
  );
}
export function SummonControls({
  state: s,
  run,
  readOnly = false,
}: {
  state: GamePosition;
  run: (c: Command) => void;
  readOnly?: boolean;
}) {
  const reaction = s.pending[0],
    shrine = s.mode === 'shrine';
  if (['synthesis', 'shrine-draft', 'shrine-setup'].includes(s.phase)) return null;
  if ((s.phase !== 'summon' && s.summonSlots <= 0 && !summonRerolls(s).length) || s.winner)
    return null;
  if (s.summonOffer)
    return <SummonOffer key={`${s.ply}:${s.serial}`} state={s} run={run} readOnly={readOnly} />;
  return (
    <div className="summon-controls">
      <p>
        {s.phase === 'play' ? '本回合额外' : '剩余'} <strong>{s.summonSlots}</strong> 次召唤 · 持有{' '}
        <strong>{s.heads[s.active]}</strong> 人头
      </p>
      {!shrine && (
        <button
          className="secondary"
          disabled={readOnly || s.summonSlots <= 0 || !!reaction}
          onClick={() => run({ type: 'summon' })}
        >
          <Icon name="plus" />
          普通召唤
        </button>
      )}
      <button
        className="ultimate-summon"
        disabled={
          readOnly || s.summonSlots <= 0 || (!shrine && s.heads[s.active] < 2) || !!reaction
        }
        onClick={() => run({ type: 'summon', ultimate: true })}
      >
        <Icon name="spark" />
        {shrine ? '免费终极召唤' : '终极召唤'} {!shrine && <span>−2 人头</span>}
      </button>
      {shrine && s.phase === 'summon' && (
        <div className="extra-summons">
          <button
            className="secondary"
            disabled={readOnly || !!reaction || s.heads[s.active] < 3}
            onClick={() => run({ type: 'extra-summon', ultimate: true })}
          >
            额外终极 · −3人头
          </button>
          <button
            className="secondary"
            disabled={readOnly || !!reaction || s.heads[s.active] < 2}
            onClick={() => run({ type: 'extra-summon', ultimate: false })}
          >
            额外普通 · −2人头
          </button>
        </div>
      )}
      <RerollControls state={s} run={run} readOnly={readOnly || !!reaction} />
      {s.phase === 'summon' && (
        <button
          className="primary"
          disabled={readOnly || s.summonSlots !== 0 || !!reaction}
          onClick={() => run({ type: 'begin' })}
        >
          完成召唤，开始行动
          <Icon name="arrow" />
        </button>
      )}
      <small>
        {shrine
          ? '常驻与额外免费次数来自终极池；人头额外召唤仅限回合开始。'
          : '费用在揭示结果之前支付，可在开始行动前使用改判。'}
      </small>
    </div>
  );
}
