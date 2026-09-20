import type { Definition } from '../../engine';
import { Icon, numberLabel } from './visuals';
export function DefinitionStats({ d }: { d: Definition }) {
  if (d.aura)
    return (
      <div className="spell-duration">
        <Icon name="spark" />
        永久光环 · 启用后整局生效
      </div>
    );
  if (d.spell !== undefined || d.weapon !== undefined) {
    const limit = d.spell ?? d.weapon!;
    return (
      <div className="spell-duration">
        <Icon name={d.weapon !== undefined ? 'sword' : 'clock'} />
        {d.weapon !== undefined ? '武器 · ' : '法术 · '}
        <strong>{limit < 0 ? '未注明' : limit}</strong>
        {limit < 0 ? '暂不自动过期' : '回合储存'}
      </div>
    );
  }
  const values = [
    [
      'sword',
      '攻击',
      d.id === '3p'
        ? '40−5n'
        : d.id === 'u21' || d.id === 'sage'
          ? '±25'
          : d.signedAttack
            ? `±${Math.abs(d.attack)}`
            : numberLabel(d.attack),
    ],
    ['heart', '生命', d.health],
    ['target', '射程', d.id === '3p' ? 'n' : d.id === 'formless' || d.id === 's7' ? '∞' : d.range],
    ['clock', '攻次', numberLabel(d.actions)],
    ['move', '移动', numberLabel(d.move)],
  ];
  return (
    <div className="definition-stats">
      {values.map(([icon, label, value]) => (
        <div key={label}>
          <span>
            <Icon name={String(icon)} size={13} />
            {label}
          </span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}
