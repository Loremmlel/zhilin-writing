import { useId } from 'react';
import type { MatchSettings } from '../../match/settings';
export function MatchOptions({
  value,
  onChange,
}: {
  value: MatchSettings;
  onChange: (m: MatchSettings) => void;
}) {
  const name = useId();
  return (
    <fieldset className="match-options">
      <legend>对战模式</legend>
      <label className="rules-choice">
        规则模式
        <select
          value={value.rules ?? 'classic'}
          onChange={(e) => onChange({ ...value, rules: e.target.value as 'classic' | 'shrine' })}
        >
          <option value="classic">经典模式 · 普通召唤</option>
          <option value="shrine">神龛模式 · 第0回合选神龛</option>
        </select>
      </label>
      <div className="mode-choices">
        {(['local', 'ai'] as const).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name={name}
              value={mode}
              checked={value.mode === mode}
              onChange={() => onChange({ ...value, mode })}
            />
            {mode === 'local' ? '同屏双人' : '人机对战'}
          </label>
        ))}
      </div>
      {value.mode === 'ai' && (
        <div className="ai-settings">
          <label>
            AI难度
            <select
              value={value.difficulty}
              onChange={(e) =>
                onChange({ ...value, difficulty: e.target.value as MatchSettings['difficulty'] })
              }
            >
              <option value="easy">简单 · 眼前收益</option>
              <option value="medium">中等 · 回合配合</option>
              <option value="hard">困难 · 考虑反击</option>
            </select>
          </label>
          <label>
            你的阵营
            <select
              value={value.human}
              onChange={(e) => onChange({ ...value, human: Number(e.target.value) as 1 | 2 })}
            >
              <option value={1}>苍穹方 · 先手</option>
              <option value={2}>赤焰方 · 后手</option>
            </select>
          </label>
          <p>三档使用相同规则与公开信息，不额外加属性，不读取未来抽牌。计算在本机完成。</p>
        </div>
      )}
    </fieldset>
  );
}
