import { SummonChoiceDialog } from './shrine/SummonChoiceDialog';
import { OpponentBar } from './opponent/OpponentBar';
import { Battlefield } from './board/Battlefield';
import { BattleLog } from './feedback/BattleLog';
import { Feedback } from './feedback/Feedback';
import { GameDialogs } from './feedback/GameDialogs';
import { GameHeader } from './game/GameHeader';
import { Scoreboard } from './game/Scoreboard';
import { VictoryBanner } from './game/VictoryBanner';
import { HandPanel } from './hand/HandPanel';
import { Inspector } from './inspector/Inspector';
import { SaveTools } from './session/SaveTools';
import { playerStyle } from './shared/visuals';
import { faction, type Player } from '../engine';
import type { MatchSettings } from '../match/settings';
import type { GameModal } from './game/types';
import type { GameInteraction } from './game/useGameInteraction';
import type { GamePresentation } from './session/useGamePresentation';
import type { useGameController } from './game/useGameController';
import type { useOnlineController } from './online/useOnlineController';
import './styles/index.css';

type SurfaceModel = GameInteraction &
  GamePresentation & {
    match: MatchSettings;
    controller: Player;
    modal: GameModal;
    setModal: (modal: GameModal) => void;
    saveStatus: string;
  };
/** No rule mutations or authority here. Only the local adapter supplies local-only controls. */
export function GameSurface({
  game,
  local,
  online,
}: {
  game: SurfaceModel;
  local?: ReturnType<typeof useGameController>;
  online?: ReturnType<typeof useOnlineController>['online'];
}) {
  const { state } = game;
  const busy = local ? local.computer.busy : !!online?.blocked;
  return (
    <div ref={game.scope} className="hj-game v2-game" style={playerStyle(game.controller)}>
      <GameHeader
        sound={game.sound}
        onToggleSound={() => game.setSound((v) => !v)}
        onOpen={game.setModal}
        allowNew={!!local}
      />
      <main className="game-container">
        <div className="game-layout">
          <div className="match-overview">
            <div className="match-heading">
              <p className="eyebrow">
                <span />
                {online
                  ? 'ONLINE TWO-PLAYER DUEL'
                  : game.match.mode === 'ai'
                    ? 'LOCAL AI DUEL'
                    : 'LOCAL TWO-PLAYER DUEL'}
              </p>
              <p>
                {state.mode === 'shrine' ? '神龛模式 · 神龛 × 16' : '经典模式 · 普通 × 26'} <i />{' '}
                终极 × 28
              </p>
            </div>
            <Scoreboard
              state={state}
              human={online?.viewer ?? (game.match.mode === 'ai' ? game.match.human : undefined)}
            />
          </div>
          <div className="play-layout">
            <Inspector
              state={state}
              selectedId={game.selectedId}
              cardId={game.cardId}
              intent={game.intent}
              activeIntent={game.activeIntent}
              actions={game.actions}
              setSelectedId={game.setSelectedId}
              setIntent={game.setIntent}
              chooseAction={game.chooseAction}
              onRules={() => game.setModal('rules')}
            />
            <Battlefield
              state={state}
              intent={game.intent}
              activeIntent={game.activeIntent}
              selectedId={game.selectedId}
              onCell={game.onCell}
              effects={game.effects}
              canUndo={!!local?.session.past.length}
              canRedo={!!local?.session.future.length}
              rewind={local?.rewind ?? (() => {})}
              showHistory={!!local}
              run={game.run}
              onCancel={game.cancel}
              onTargetLayer={(layer) =>
                game.setIntent((i) => (i.kind === 'select' ? { ...i, targetLayer: layer } : i))
              }
              endError={game.endError}
              readOnly={
                busy ||
                (!!online && !!state.pending.length && state.pending[0].owner !== online.viewer)
              }
            />
            <aside className="hand-rail">
              {local && (
                <OpponentBar
                  ended={!!state.winner}
                  match={game.match}
                  busy={local.computer.busy}
                  thinking={local.computer.thinking}
                  paused={local.computer.paused || !!local.session.future.length}
                  backend={local.computer.backend}
                  onToggle={() =>
                    local.computer.paused || local.session.future.length
                      ? local.resumeComputer()
                      : local.computer.pause()
                  }
                  onNew={() => game.setModal('new')}
                />
              )}
              {online && (
                <p className="online-status" role="status" aria-live="polite">
                  {faction(online.viewer)} ·{' '}
                  {online.connection === 'disconnected'
                    ? '连接中断'
                    : online.connection === 'connecting'
                      ? '正在连接'
                      : online.submitting
                        ? '等待服务器确认'
                        : online.blocked
                          ? '操作已暂停'
                          : '已连接'}
                </p>
              )}
              <VictoryBanner
                state={state}
                onNewGame={local ? () => game.setModal('new') : undefined}
              />
              <div className="hand-scroll" tabIndex={0} aria-label="手牌与战报">
                <HandPanel
                  match={game.match}
                  state={state}
                  cardId={game.cardId}
                  chooseCard={game.chooseCard}
                  chooseAction={game.chooseAction}
                  run={game.run}
                  viewer={online?.viewer}
                  readOnly={
                    busy ||
                    (!!online && state.phase !== 'shrine-draft' && state.active !== online.viewer)
                  }
                />
                <BattleLog
                  state={state}
                  saveStatus={game.saveStatus}
                  onOpen={() => game.setModal('log')}
                />
              </div>
              {local && (
                <SaveTools
                  live={local.live}
                  onImport={local.importSession}
                  onError={game.setNotice}
                />
              )}
            </aside>
          </div>
          <footer className="game-footer">
            <span>
              <i className="live-dot" />
              {online
                ? '浩劫3.0 · 经典 / 神龛 · 双人联机'
                : '浩劫3.0 · 经典 / 神龛 · 离线单HTML · 双人 / 本地AI'}
            </span>
            <button onClick={() => game.setModal('rules')}>规则与实施说明</button>
            <span>{local ? `SEED ${local.session.present.seed}` : '服务器裁定'}</span>
          </footer>
        </div>
      </main>
      <Feedback events={game.events} notice={game.notice} onDismiss={() => game.setNotice('')} />
      {game.choiceCommand && (
        <SummonChoiceDialog
          state={state}
          command={game.choiceCommand}
          onClose={game.cancelChoice}
          onConfirm={game.confirmChoice}
        />
      )}
      <GameDialogs
        key={game.modal ?? 'closed'}
        modal={game.modal}
        state={state}
        match={game.match}
        onClose={() => game.setModal(null)}
        startGame={local?.newGame}
      />
    </div>
  );
}
