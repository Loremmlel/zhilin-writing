import type { RefObject } from 'react';
import { useRef } from 'react';
import type { Session } from '../../engine';
import { parseSession, serializeSession } from '../../engine';
import { Icon } from '../shared/visuals';

export function SaveTools({
  live,
  onImport,
  onError,
}: {
  live: RefObject<Session>;
  onImport: (session: Session) => void;
  onError: (message: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  function exportSave() {
    try {
      const current = live.current;
      const blob = new Blob([serializeSession(current)], { type: 'application/json' });
      if (blob.size > 24_000_000) throw new Error('存档超过24MB。');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `haojie-3.0-turn-${current.present.ply}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onError(error instanceof Error ? error.message : '导出失败。');
    }
  }
  async function importSave(input: HTMLInputElement) {
    const f = input.files?.[0];
    try {
      if (!f) return;
      if (f.size > 24_000_000) throw new Error('存档超过24MB。');
      onImport(parseSession(await f.text()));
    } catch (e) {
      onError(e instanceof Error ? e.message : '载入失败。');
    } finally {
      input.value = '';
    }
  }
  return (
    <div className="save-tools">
      <button onClick={exportSave}>
        <Icon name="download" size={14} />
        导出存档
      </button>
      <button onClick={() => file.current?.click()}>
        <Icon name="upload" size={14} />
        载入存档
      </button>
      <input
        hidden
        type="file"
        accept=".json,application/json"
        ref={file}
        onChange={(e) => void importSave(e.currentTarget)}
      />
    </div>
  );
}
