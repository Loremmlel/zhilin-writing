import { useState } from 'react';
import {
  aura,
  definition,
  faction,
  hasAura,
  type ActionSpec,
  type Command,
  type GamePosition,
  type Kind,
  type Player,
} from '../../engine';
import type { MatchSettings } from '../../match/settings';
import { DefinitionStats } from '../shared/DefinitionStats';

/** Only the draft's public candidates and committed flags are rendered before reveal. */
export function ShrinePanel({
  state: s,
  match,
  run,
  chooseAction,
  readOnly,
  viewer: seat,
}: {
  state: GamePosition;
  match: MatchSettings;
  run: (c: Command) => void;
  chooseAction: (a: ActionSpec) => void;
  readOnly: boolean;
  viewer?: Player;
}) {
  const [parity, setParity] = useState<'odd' | 'even'>('odd');
  const [selected, setSelected] = useState<Kind | null>(null);
  const draft = s.shrineDraft;
  const viewer: Player = seat ?? (match.mode === 'ai' ? match.human : s.active);
  const opponent: Player = viewer === 1 ? 2 : 1;
  if (s.phase === 'shrine-draft' && draft)
    return (
      <div className="shrine-draft">
        <p className="shrine-status">第0回合 · {faction(viewer)}选神龛。双方锁定后同时揭示。</p>
        <p className="fine-print">
          {seat !== undefined
            ? '对手的最终选择会在双方锁定后同时揭示。'
            : match.mode === 'ai'
              ? 'AI只能看到双方候选，不会读取你已锁定的选择。'
              : '同屏双人无法防止旁观选择过程；请轮流操作。'}
        </p>
        <div className="shrine-offers" aria-label="本方神龛候选">
          {draft.offers[viewer].map((kind) => {
            const d = definition(kind);
            return (
              <button
                className="shrine-choice"
                key={kind}
                aria-pressed={selected === kind}
                disabled={
                  readOnly || draft.committed[viewer] || (seat === undefined && s.active !== viewer)
                }
                onClick={() => setSelected(kind)}
              >
                <span className="shrine-choice-heading">
                  <b>{d.name}</b>
                  <small>{d.role}</small>
                </span>
                <DefinitionStats d={d} />
                <span>{d.description}</span>
              </button>
            );
          })}
        </div>
        {selected === 's9' && (
          <label className="rules-choice">
            玉碎生效序号
            <select value={parity} onChange={(e) => setParity(e.target.value as 'odd' | 'even')}>
              <option value="odd">奇数序号</option>
              <option value="even">偶数序号</option>
            </select>
          </label>
        )}
        <button
          className="primary"
          disabled={
            readOnly ||
            !selected ||
            !draft.offers[viewer].includes(selected) ||
            draft.committed[viewer] ||
            (seat === undefined && s.active !== viewer)
          }
          onClick={() => {
            run({ type: 'choose-shrine', player: viewer, shrineKind: selected!, parity });
            setSelected(null);
          }}
        >
          {draft.committed[viewer] ? '已锁定，等待对手' : '锁定神龛'}
        </button>
        <details className="shrine-opponent" open>
          <summary>
            对手候选 · {draft.committed[opponent] ? '已锁定，选择保密' : '尚未锁定'}
          </summary>
          {draft.offers[opponent].map((kind) => (
            <details key={kind}>
              <summary>{definition(kind).name}</summary>
              <p>{definition(kind).description}</p>
            </details>
          ))}
        </details>
      </div>
    );
  return (
    <>
      {s.phase === 'shrine-setup' && (
        <div className="shrine-setup">
          <p>
            双方已揭示：
            {([1, 2] as Player[])
              .map(
                (p) =>
                  `${faction(p)} · ${draft?.choices[p] ? definition(draft.choices[p]!.kind).name : '—'}`,
              )
              .join(' / ')}
          </p>
          <p>现在由{faction(s.active)}入场。选择下方神龛部署、装备或启用；也可以储存，日后再用。</p>
          <button
            className="primary"
            disabled={readOnly}
            onClick={() => run({ type: 'finish-shrine-setup' })}
          >
            {s.hands[s.active].length ? '储存神龛，完成入场' : '完成神龛入场'}
          </button>
        </div>
      )}
      {([1, 2] as Player[]).some((p) => s.auras?.[p].length) && (
        <div className="shrine-auras" aria-label="永久光环">
          {([1, 2] as Player[]).map((p) => (
            <div key={p}>
              {!!s.auras?.[p].length && <h3>{faction(p)} · 永久光环</h3>}
              {s.auras?.[p].map((a) => (
                <details key={a.kind}>
                  <summary>
                    {definition(a.kind).name}
                    {a.parity ? (a.parity === 'odd' ? ' · 奇数' : ' · 偶数') : ''}
                    {a.usedPly === s.ply ? ' · 本回合已用' : ''}
                  </summary>
                  <p>{definition(a.kind).description}</p>
                </details>
              ))}
            </div>
          ))}
          {hasAura(s, s.active, 's10') && (
            <button
              className="secondary"
              disabled={
                readOnly ||
                s.phase !== 'play' ||
                aura(s, s.active, 's10')?.usedPly === s.ply ||
                !!s.pending.length
              }
              onClick={() =>
                chooseAction({
                  id: 'clock',
                  label: '时钟 · 回到上一己方回合',
                  icon: 'clock',
                  command: { type: 'clock' },
                  steps: [
                    {
                      kind: 'target',
                      label: '选择非神龛棋子：恢复到上一个己方回合开始的状态',
                      relation: 'any',
                      unitOnly: true,
                    },
                  ],
                })
              }
            >
              时钟 · 选择回溯目标
            </button>
          )}
        </div>
      )}
    </>
  );
}
