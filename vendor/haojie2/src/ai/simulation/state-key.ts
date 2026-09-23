import { positionKey as rawPositionKey, fingerprint as rawFingerprint } from '../observation';
import type { GameState } from '../../engine/types';
/** 每次搜索独立持有；只接收已结算且此后不再修改的内部快照，不改变公共指纹语义。 */
export function createStateKeys() {
  const keys = new WeakMap<GameState, string>(),
    fingerprints = new WeakMap<GameState, string>();
  return {
    positionKey(s: GameState): string {
      let result = keys.get(s);
      if (result === undefined) {
        result = rawPositionKey(s);
        keys.set(s, result);
      }
      return result;
    },
    fingerprint(s: GameState): string {
      let result = fingerprints.get(s);
      if (result === undefined) {
        result = rawFingerprint(s);
        fingerprints.set(s, result);
      }
      return result;
    },
  };
}
