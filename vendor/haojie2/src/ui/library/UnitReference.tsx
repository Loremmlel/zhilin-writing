import { createContext, useContext, type ReactNode } from 'react';
import { keywordDefinition, type Kind, type KeywordId, type RuleReference } from '../../engine';
import { referenceParts } from './references';

export interface StatusContext {
  unitId: string;
  statusKey: string;
}
export type ReferenceRequest = RuleReference & { context?: StatusContext };
export const UnitReferenceContext = createContext<(reference: ReferenceRequest) => void>(() => {});

/** 打开只读图鉴，不修改局面、地址或宿主导航，也不触发外层的选牌操作。 */
export function UnitLink({ kind, children }: { kind: Kind; children: ReactNode }) {
  return <ReferenceLink reference={{ type: 'unit', kind }}>{children}</ReferenceLink>;
}

export function KeywordLink({
  id,
  children,
  context,
}: {
  id: KeywordId;
  children?: ReactNode;
  context?: StatusContext;
}) {
  return (
    <ReferenceLink reference={{ type: 'keyword', id, context }}>
      {children ?? keywordDefinition(id).name}
    </ReferenceLink>
  );
}

function ReferenceLink({
  reference,
  children,
}: {
  reference: ReferenceRequest;
  children: ReactNode;
}) {
  const open = useContext(UnitReferenceContext);
  return (
    <a
      className="unit-link"
      href={reference.type === 'unit' ? `#unit-${reference.kind}` : `#keyword-${reference.id}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(reference);
      }}
    >
      {children}
    </a>
  );
}

/** 将说明、状态和旧战报中的正式名称转成图鉴链接；不解析 HTML 或执行文案。 */
export function UnitText({
  children,
  keywords = false,
  references,
  excludeKeyword,
}: {
  children: string;
  keywords?: boolean;
  references?: Readonly<Record<string, KeywordId>>;
  excludeKeyword?: KeywordId;
}) {
  return (
    <>
      {referenceParts(children, keywords, references).map(({ text, reference }, index) => {
        return !reference || (reference.type === 'keyword' && reference.id === excludeKeyword) ? (
          text
        ) : (
          <ReferenceLink key={index} reference={reference}>
            {text}
          </ReferenceLink>
        );
      })}
    </>
  );
}

/** 只在规则、图鉴说明和折叠状态内启用关键词，避免扩大到选牌按钮和常显详情。 */
export function RuleText(props: Omit<Parameters<typeof UnitText>[0], 'keywords'>) {
  return <UnitText {...props} keywords />;
}
