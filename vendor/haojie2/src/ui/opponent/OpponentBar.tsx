import type { MatchSettings } from '../../match/settings';
import { difficultyLabel } from '../../ai/difficulty';
import { faction } from '../../engine';
import { Icon } from '../shared/visuals';
export function OpponentBar({
  match,
  busy,
  thinking,
  paused,
  backend,
  onToggle,
  onNew,
  ended,
}: {
  ended?: boolean;
  match: MatchSettings;
  busy: boolean;
  thinking: boolean;
  paused: boolean;
  backend: string;
  onToggle: () => void;
  onNew: () => void;
}) {
  return (
    <section className={`opponent-bar ${busy ? 'computer-turn' : ''}`} aria-label="对战模式">
      <Icon name="spark" />
      <div>
        <strong>
          {match.mode === 'ai'
            ? `${difficultyLabel(match.difficulty)} AI · 你是${faction(match.human)}`
            : '同屏双人'}
        </strong>
        <p role="status">
          {ended
            ? '对局已结束，可以悔棋或再来一局。'
            : match.mode === 'local'
              ? '可切换为本地AI对战，无需联网。'
              : paused
                ? 'AI已暂停；可查看棋盘、悔棋或继续。'
                : busy
                  ? thinking
                    ? 'AI正在思考…'
                    : 'AI准备行动…'
                  : '轮到你决策。'}
          {match.mode === 'ai' && backend === 'cooperative' ? ' · 分片计算模式' : ''}
        </p>
      </div>
      {match.mode === 'ai' && (
        <button className="secondary" onClick={onToggle}>
          {paused ? '继续AI' : '暂停AI'}
        </button>
      )}
      <button className="text-button" onClick={onNew}>
        对战设置
      </button>
    </section>
  );
}
