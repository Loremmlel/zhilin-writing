import type { Session } from '../../engine';
import { createSession, parseSession, serializeSession } from '../../engine';

/** 保留历史存储键，由解析器识别快照或增量格式，不因升级丢失旧局。 */
export const DEFAULT_STORAGE_KEY = 'haojie.session.v2';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type SaveStatus = 'saved' | 'snapshot' | 'disabled' | 'blocked' | 'unavailable';
export const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: '对局已保存在此浏览器',
  snapshot: '已保存局面 · 历史请导出',
  disabled: '由宿主管理存档',
  blocked: '旧存档无法读取 · 自动保存已暂停',
  unavailable: '无法本机保存 · 请导出存档',
};
export function readStoredSession(storage: StoragePort, key: string, fallback: () => Session) {
  try {
    const raw = storage.getItem(key);
    if (raw) {
      try {
        const session = parseSession(raw);
        return {
          session,
          notice:
            session.record?.origin === 'opening'
              ? '已恢复浩劫对局及开局以来的完整记录。'
              : '已恢复浩劫对局；记录从已知局面开始，不含此前过程。',
          writable: true,
        };
      } catch {
        return {
          session: fallback(),
          notice:
            '旧存档无法读取，已暂停自动保存以免覆盖。可导入有效存档，或明确新建一局后恢复保存。',
          writable: false,
        };
      }
    }
    const old = storage.getItem('haojie2.session.v1');
    return {
      session: fallback(),
      writable: true,
      notice: old ? '检测到1.x存档，旧存档保留不动，当前创建浩劫2.0新局。' : '',
    };
  } catch {
    return {
      session: fallback(),
      writable: false,
      notice: '浏览器无法读取本机存档，请使用导入和导出保存对局。',
    };
  }
}
export function writeStoredSession(
  storage: StoragePort,
  key: string,
  session: Session,
): SaveStatus {
  try {
    storage.setItem(key, serializeSession(session));
    return 'saved';
  } catch {
    try {
      storage.setItem(key, serializeSession(createSession(session.present, session.match)));
      return 'snapshot';
    } catch {
      return 'unavailable';
    }
  }
}
