import {
  CATALOG,
  KEYWORD_IDS,
  keywordDefinition,
  type KeywordId,
  type RuleReference,
} from '../../engine';

const unitNames = new Map<string, RuleReference>(
  CATALOG.map((d) => [d.name, { type: 'unit', kind: d.id }]),
);
const ruleNames = new Map(unitNames);
for (const id of KEYWORD_IDS) {
  const d = keywordDefinition(id);
  for (const name of [d.name, ...(d.aliases ?? [])])
    if (!ruleNames.has(name)) ruleNames.set(name, { type: 'keyword', id });
}
export interface ReferencePart {
  text: string;
  reference?: RuleReference;
}

function namePattern(names: ReadonlyMap<string, RuleReference>) {
  return new RegExp(
    `(${[...names.keys()]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})`,
    'g',
  );
}
const unitPattern = namePattern(unitNames),
  rulePattern = namePattern(ruleNames);

/** 长名称先匹配且不拆分单位名；同名状态由调用处的明确引用覆盖，旧战报默认只识别单位。 */
export function referenceParts(
  text: string,
  keywords = false,
  overrides: Readonly<Record<string, KeywordId>> = {},
): ReferencePart[] {
  let names = keywords ? ruleNames : unitNames;
  let pattern = keywords ? rulePattern : unitPattern;
  if (Object.keys(overrides).length) {
    names = new Map(names);
    for (const [name, id] of Object.entries(overrides)) names.set(name, { type: 'keyword', id });
    pattern = namePattern(names);
  }
  return text
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, reference: names.get(part) }));
}
