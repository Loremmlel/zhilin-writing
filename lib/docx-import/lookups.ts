import type { DocxPackageReader } from "./package.ts";
import type { InlineMark } from "./types.ts";
import { parseOrderedXml, type OrderedXmlNode, xmlAttr, xmlChild, xmlChildren } from "./xml.ts";

export interface NumberingReference {
  numId?: string;
  level?: number;
}

export interface RunProperties {
  marks: Partial<Record<InlineMark, boolean>>;
  visualFormatting: boolean;
}

export interface ParagraphProperties {
  styleId?: string;
  outlineLevel?: number;
  numbering?: NumberingReference;
  run: RunProperties;
}

export interface ParagraphSemantics {
  headingLevel?: number;
  quote: boolean;
  numbering?: NumberingReference;
}

export interface NumberingLevel {
  format: string;
  ordered: boolean;
  level: number;
}

export interface DocumentRelationship {
  id: string;
  target: string;
  type: string;
  external: boolean;
}

export interface DocxLookups {
  paragraph(styleId: string | undefined, direct: ParagraphProperties): ParagraphSemantics;
  run(
    paragraphStyleId: string | undefined,
    characterStyleId: string | undefined,
    direct: RunProperties,
  ): RunProperties & { codeStyle: boolean };
  numbering(reference: NumberingReference | undefined): NumberingLevel | undefined;
  relationship(id: string | undefined): DocumentRelationship | undefined;
  contentType(path: string): string | undefined;
}

interface StyleDefinition {
  id: string;
  type: string;
  name?: string;
  basedOn?: string;
  paragraph: ParagraphProperties;
  run: RunProperties;
}

interface ResolvedStyle {
  labels: string[];
  paragraph: ParagraphProperties;
  run: RunProperties;
}

interface AbstractNumbering {
  levels: Map<number, NumberingLevel>;
}

const CODE_STYLE_NAMES = new Set(["code", "codechar", "sourcecode"]);

export async function loadDocxLookups(pkg: DocxPackageReader): Promise<DocxLookups> {
  const contentTypes = parseContentTypes(
    parseOrderedXml(await pkg.readText("[Content_Types].xml"), "[Content_Types].xml"),
  );
  const styles = pkg.has("word/styles.xml")
    ? parseStyles(parseOrderedXml(await pkg.readText("word/styles.xml"), "word/styles.xml"))
    : new Map<string, StyleDefinition>();
  const { abstractNumbering, numberingInstances } = pkg.has("word/numbering.xml")
    ? parseNumbering(
        parseOrderedXml(await pkg.readText("word/numbering.xml"), "word/numbering.xml"),
      )
    : {
        abstractNumbering: new Map<string, AbstractNumbering>(),
        numberingInstances: new Map<string, string>(),
      };
  const relationships = pkg.has("word/_rels/document.xml.rels")
    ? parseRelationships(
        parseOrderedXml(
          await pkg.readText("word/_rels/document.xml.rels"),
          "word/_rels/document.xml.rels",
        ),
      )
    : new Map<string, DocumentRelationship>();
  const resolvedStyles = new Map<string, ResolvedStyle>();

  const resolveStyle = (
    styleId: string | undefined,
    visiting = new Set<string>(),
  ): ResolvedStyle | undefined => {
    if (!styleId) return undefined;
    const cached = resolvedStyles.get(styleId);
    if (cached) return cached;
    const style = styles.get(styleId);
    if (!style || visiting.has(styleId)) return undefined;
    const nextVisiting = new Set(visiting).add(styleId);
    const base = resolveStyle(style.basedOn, nextVisiting);
    const resolved: ResolvedStyle = {
      labels: [
        ...(base?.labels ?? []),
        normalizeStyleName(style.id),
        ...(style.name ? [normalizeStyleName(style.name)] : []),
      ],
      paragraph: mergeParagraphProperties(base?.paragraph, style.paragraph),
      run: mergeRunProperties(base?.run, style.run),
    };
    resolvedStyles.set(styleId, resolved);
    return resolved;
  };

  return {
    paragraph(styleId, direct) {
      const style = resolveStyle(styleId);
      const effective = mergeParagraphProperties(style?.paragraph, direct);
      const explicitHeading = [...(style?.labels ?? [])]
        .reverse()
        .map((label) => /^heading([1-9])$/.exec(label))
        .find((match) => match !== null);
      const headingLevel = explicitHeading
        ? Number(explicitHeading[1])
        : effective.outlineLevel !== undefined
          ? effective.outlineLevel + 1
          : undefined;
      return {
        headingLevel,
        quote: (style?.labels ?? []).some((label) => label === "quote" || label === "intensequote"),
        numbering: effective.numbering,
      };
    },
    run(paragraphStyleId, characterStyleId, direct) {
      const paragraphStyle = resolveStyle(paragraphStyleId);
      const characterStyle = resolveStyle(characterStyleId);
      return {
        ...mergeRunProperties(mergeRunProperties(paragraphStyle?.run, characterStyle?.run), direct),
        codeStyle: (characterStyle?.labels ?? []).some((label) => CODE_STYLE_NAMES.has(label)),
      };
    },
    numbering(reference) {
      if (!reference?.numId || reference.level === undefined) return undefined;
      const abstractId = numberingInstances.get(reference.numId);
      if (!abstractId) return undefined;
      return abstractNumbering.get(abstractId)?.levels.get(reference.level);
    },
    relationship(id) {
      return id ? relationships.get(id) : undefined;
    },
    contentType(path) {
      return (
        contentTypes.overrides.get(path) ??
        contentTypes.defaults.get(path.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "")
      );
    },
  };
}

function parseContentTypes(nodes: OrderedXmlNode[]): {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
} {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const root = xmlChild(nodes, "Types");
  if (!root) return { defaults, overrides };
  for (const node of xmlChildren(root, "Default")) {
    const extension = xmlAttr(node, "Extension")?.toLocaleLowerCase("en-US");
    const contentType = xmlAttr(node, "ContentType")?.toLocaleLowerCase("en-US");
    if (extension && contentType) defaults.set(extension, contentType);
  }
  for (const node of xmlChildren(root, "Override")) {
    const partName = normalizePartName(xmlAttr(node, "PartName"));
    const contentType = xmlAttr(node, "ContentType")?.toLocaleLowerCase("en-US");
    if (partName && contentType) overrides.set(partName, contentType);
  }
  return { defaults, overrides };
}

function normalizePartName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).replace(/^\//, "");
  } catch {
    return undefined;
  }
}

export function parseParagraphProperties(node: OrderedXmlNode | undefined): ParagraphProperties {
  if (!node) return { run: emptyRunProperties() };
  const numberingNode = xmlChild(node, "numPr");
  return {
    styleId: xmlAttr(xmlChild(node, "pStyle") ?? {}, "val"),
    outlineLevel: integerAttribute(xmlChild(node, "outlineLvl"), "val"),
    numbering: numberingNode
      ? {
          numId: xmlAttr(xmlChild(numberingNode, "numId") ?? {}, "val"),
          level: integerAttribute(xmlChild(numberingNode, "ilvl"), "val"),
        }
      : undefined,
    run: parseRunProperties(xmlChild(node, "rPr")),
  };
}

export function parseRunProperties(node: OrderedXmlNode | undefined): RunProperties {
  if (!node) return emptyRunProperties();
  const visualNames = ["u", "color", "highlight", "sz", "szCs", "rFonts"];
  return {
    marks: {
      strong: onOffValue(xmlChild(node, "b")),
      em: onOffValue(xmlChild(node, "i")),
      strike: onOffValue(xmlChild(node, "strike")),
    },
    visualFormatting: visualNames.some((name) => {
      const child = xmlChild(node, name);
      return child !== undefined && onOffValue(child) !== false;
    }),
  };
}

export function characterStyleId(
  runPropertiesNode: OrderedXmlNode | undefined,
): string | undefined {
  return runPropertiesNode
    ? xmlAttr(xmlChild(runPropertiesNode, "rStyle") ?? {}, "val")
    : undefined;
}

function parseStyles(nodes: OrderedXmlNode[]): Map<string, StyleDefinition> {
  const result = new Map<string, StyleDefinition>();
  const root = xmlChild(nodes, "styles");
  if (!root) return result;
  for (const node of xmlChildren(root, "style")) {
    const id = xmlAttr(node, "styleId");
    if (!id) continue;
    result.set(id, {
      id,
      type: xmlAttr(node, "type") ?? "paragraph",
      name: xmlAttr(xmlChild(node, "name") ?? {}, "val"),
      basedOn: xmlAttr(xmlChild(node, "basedOn") ?? {}, "val"),
      paragraph: parseParagraphProperties(xmlChild(node, "pPr")),
      run: parseRunProperties(xmlChild(node, "rPr")),
    });
  }
  return result;
}

function parseNumbering(nodes: OrderedXmlNode[]): {
  abstractNumbering: Map<string, AbstractNumbering>;
  numberingInstances: Map<string, string>;
} {
  const abstractNumbering = new Map<string, AbstractNumbering>();
  const numberingInstances = new Map<string, string>();
  const root = xmlChild(nodes, "numbering");
  if (!root) return { abstractNumbering, numberingInstances };
  for (const node of xmlChildren(root, "abstractNum")) {
    const id = xmlAttr(node, "abstractNumId");
    if (!id) continue;
    const levels = new Map<number, NumberingLevel>();
    for (const levelNode of xmlChildren(node, "lvl")) {
      const level = integerAttribute(levelNode, "ilvl");
      const format = xmlAttr(xmlChild(levelNode, "numFmt") ?? {}, "val");
      if (level === undefined || !format) continue;
      levels.set(level, { format, ordered: format !== "bullet", level });
    }
    abstractNumbering.set(id, { levels });
  }
  for (const node of xmlChildren(root, "num")) {
    const id = xmlAttr(node, "numId");
    const abstractId = xmlAttr(xmlChild(node, "abstractNumId") ?? {}, "val");
    if (id && abstractId) numberingInstances.set(id, abstractId);
  }
  return { abstractNumbering, numberingInstances };
}

function parseRelationships(nodes: OrderedXmlNode[]): Map<string, DocumentRelationship> {
  const result = new Map<string, DocumentRelationship>();
  const root = xmlChild(nodes, "Relationships");
  if (!root) return result;
  for (const node of xmlChildren(root, "Relationship")) {
    const id = xmlAttr(node, "Id");
    const target = xmlAttr(node, "Target");
    const type = xmlAttr(node, "Type");
    if (!id || !target || !type) continue;
    result.set(id, {
      id,
      target,
      type,
      external: xmlAttr(node, "TargetMode")?.toLocaleLowerCase("en-US") === "external",
    });
  }
  return result;
}

function mergeParagraphProperties(
  base: ParagraphProperties | undefined,
  own: ParagraphProperties | undefined,
): ParagraphProperties {
  return {
    styleId: own?.styleId ?? base?.styleId,
    outlineLevel: own?.outlineLevel ?? base?.outlineLevel,
    numbering: own?.numbering
      ? {
          numId: own.numbering.numId ?? base?.numbering?.numId,
          level: own.numbering.level ?? base?.numbering?.level,
        }
      : base?.numbering,
    run: mergeRunProperties(base?.run, own?.run),
  };
}

function mergeRunProperties(
  base: RunProperties | undefined,
  own: RunProperties | undefined,
): RunProperties {
  return {
    marks: { ...(base?.marks ?? {}), ...(definedMarkValues(own?.marks) ?? {}) },
    visualFormatting: Boolean(base?.visualFormatting || own?.visualFormatting),
  };
}

function definedMarkValues(
  marks: Partial<Record<InlineMark, boolean>> | undefined,
): Partial<Record<InlineMark, boolean>> | undefined {
  if (!marks) return undefined;
  return Object.fromEntries(Object.entries(marks).filter(([, value]) => value !== undefined));
}

function emptyRunProperties(): RunProperties {
  return { marks: {}, visualFormatting: false };
}

function onOffValue(node: OrderedXmlNode | undefined): boolean | undefined {
  if (!node) return undefined;
  const value = xmlAttr(node, "val")?.toLocaleLowerCase("en-US");
  return value === "0" || value === "false" || value === "off" || value === "no" || value === "none"
    ? false
    : true;
}

function integerAttribute(node: OrderedXmlNode | undefined, name: string): number | undefined {
  if (!node) return undefined;
  const value = Number(xmlAttr(node, name));
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeStyleName(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[\s_-]+/g, "");
}
