import { useEffect, useState, type ReactNode } from 'react';
import { definition, keywordDefinition, type GamePosition } from '../../engine';
import { Modal } from '../shared/Modal';
import { DefinitionCard } from './DefinitionCard';
import { UnitReferenceContext, type ReferenceRequest } from './UnitReference';
import { KeywordCard } from './KeywordCard';

/** 每个游戏实例独立持有介绍弹窗；在规则/图鉴上方打开，关闭后回到原入口。 */
export function UnitReferenceProvider({
  children,
  onOpenChange,
  state,
  disabled = false,
}: {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  state?: GamePosition;
  disabled?: boolean;
}) {
  const [history, setHistory] = useState<ReferenceRequest[]>([]);
  const reference = history.at(-1);
  useEffect(() => {
    if (disabled) setHistory([]);
  }, [disabled]);
  return (
    <UnitReferenceContext.Provider
      value={(next) => {
        onOpenChange?.(true);
        setHistory((old) =>
          JSON.stringify(old.at(-1)) === JSON.stringify(next) ? old : [...old, next],
        );
      }}
    >
      {children}
      {reference && !disabled && (
        <Modal
          title={
            reference.type === 'unit'
              ? definition(reference.kind).name
              : `${keywordDefinition(reference.id).name} · 状态与特性`
          }
          onClose={() => {
            setHistory([]);
            onOpenChange?.(false);
          }}
        >
          {history.length > 1 && (
            <button className="text-button" onClick={() => setHistory((old) => old.slice(0, -1))}>
              返回上一介绍
            </button>
          )}
          {reference.type === 'unit' ? (
            <DefinitionCard d={definition(reference.kind)} />
          ) : (
            <KeywordCard id={reference.id} state={state} context={reference.context} />
          )}
        </Modal>
      )}
    </UnitReferenceContext.Provider>
  );
}
