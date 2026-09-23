import { Icon } from '../shared/visuals';
import type { GameModal } from './interaction/types';

export function GameHeader({
  sound,
  onToggleSound,
  onOpen,
  allowNew = true,
}: {
  allowNew?: boolean;
  sound: boolean;
  onToggleSound: () => void;
  onOpen: (modal: GameModal) => void;
}) {
  return (
    <header className="site-header">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="sword" size={23} />
        </span>
        <div>
          <h1>
            浩劫<span>3.0</span>
          </h1>
          <p>HAOJIE · THE RECKONING</p>
        </div>
      </div>
      <nav aria-label="游戏工具">
        <button aria-label="棋子图鉴" onClick={() => onOpen('codex')}>
          <Icon name="book" />
          <span>棋子图鉴</span>
        </button>
        <button aria-label="规则" onClick={() => onOpen('rules')}>
          <Icon name="help" />
          <span>规则</span>
        </button>
        <button
          className="icon-button sound-toggle"
          aria-label={sound ? '关闭音效' : '开启音效'}
          aria-pressed={sound}
          onClick={() => onToggleSound()}
        >
          <Icon name={sound ? 'volume' : 'mute'} />
        </button>
        {allowNew && (
          <>
            <span className="nav-divider" />
            <button className="new-game-button" onClick={() => onOpen('new')}>
              <Icon name="plus" />
              新对局
            </button>
          </>
        )}
      </nav>
    </header>
  );
}
