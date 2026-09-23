import type { Definition } from '../../engine';
import { DefinitionStats } from '../shared/DefinitionStats';
import { Icon, Rune } from '../shared/visuals';
import { RuleText } from './UnitReference';

/** 图鉴列表和名称弹窗共用同一张卡片，所有属性与能力均来自 catalog。 */
export function DefinitionCard({ d }: { d: Definition }) {
  return (
    <article
      className={`codex-card ${d.spell !== undefined ? 'is-spell' : ''} ${d.tier === 'ultimate' ? 'ultimate-codex' : ''} ${d.weapon !== undefined ? 'is-weapon' : ''}`}
    >
      <div className="codex-card-heading">
        <Rune kind={d.id} large />
        <div>
          <span className="piece-index">
            {d.tier === 'normal'
              ? '普通'
              : d.tier === 'ultimate'
                ? '终极'
                : d.tier === 'shrine'
                  ? '神龛'
                  : '变体 / 合成'}
          </span>
          <h3>{d.name}</h3>
          <span className="role-chip">
            {d.role}
            {d.mage ? ' · 法师' : ''}
            {d.size ? ' · 2×2' : ''}
          </span>
        </div>
      </div>
      <DefinitionStats d={d} />
      <p>
        <RuleText references={d.keywordReferences}>{d.description}</RuleText>
      </p>
      {d.skill && (
        <div className="skill-label">
          <Icon name="spark" size={14} />
          <RuleText>{d.skill}</RuleText>
        </div>
      )}
    </article>
  );
}
