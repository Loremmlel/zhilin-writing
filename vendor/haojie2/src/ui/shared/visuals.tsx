import type { CSSProperties } from 'react';
import type { Kind, Player } from '../../engine';
import { definition } from '../../engine';
const paths: Record<string, string> = {
  sword: 'M14 3h7v7L9 22l-7-7L14 3Zm0 0 7 7M3 13l8 8M3 21l3-3',
  shield: 'M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7l-9-4Zm0 5v9m-4-5h8',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  target: 'M21 12a9 9 0 1 1-9-9m0 4a5 5 0 1 0 5 5M12 12l9-9m-5 0h5v5',
  move: 'M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4',
  spark: 'm12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z',
  book: 'M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1Zm0 0v15',
  undo: 'M3 10h11a7 7 0 0 1 0 14M3 10l6-6M3 10l6 6',
  redo: 'M21 10H10a7 7 0 0 0 0 14m11-14-6-6m6 6-6 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  x: 'M5 5l14 14M5 19 19 5',
  volume: 'M11 4 6 8H2v8h4l5 4V4Zm5 3c3 3 3 7 0 10m3-13c5 5 5 11 0 16',
  mute: 'M11 4 6 8H2v8h4l5 4V4Zm5 5 6 6m-6 0 6-6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  plus: 'M12 4v16M4 12h16',
  help: 'M9 8a3 3 0 1 1 4.5 2.6c-1.5.8-1.5 1.4-1.5 3.4M12 17v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  crown: 'M3 7l5 4 4-7 4 7 5-4-2 13H5L3 7Zm2 10h14',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  check: 'm4 12 5 5L20 6',
};
export function Icon({
  name,
  size = 18,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}
export function Rune({
  kind,
  owner = 1,
  large = false,
}: {
  kind: Kind;
  owner?: Player;
  large?: boolean;
}) {
  const d = definition(kind);
  return (
    <span
      className={`rune p${owner} ${d.spell !== undefined ? 'spell-rune' : ''} ${large ? 'large' : ''}`}
      aria-hidden="true"
    >
      <span className="rune-orbit" />
      <b>{d.glyph}</b>
      <span className="rune-spark">✦</span>
    </span>
  );
}
export const playerStyle = (p: Player): CSSProperties =>
  ({
    '--side': p === 1 ? 'var(--teal)' : 'var(--ember)',
    '--side-soft': p === 1 ? 'var(--teal-soft)' : 'var(--ember-soft)',
  }) as CSSProperties;
export const numberLabel = (n: number) => (n === 0.5 ? '½' : n === 1 / 3 ? '⅓' : String(n));
