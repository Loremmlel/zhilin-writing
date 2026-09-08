import { fontSize } from "../markdown/formatting.ts";
import { themeColors, resolveWordColor, type WordColor } from "./theme-color.ts";
import type { DocxPackageReader } from "./package.ts";
import type { InlineMark, ImportWarningCode } from "./types.ts";
import {
  parseOrderedXml,
  type OrderedXmlNode,
  xmlAttr,
  xmlChild,
  xmlChildren,
  xmlName,
} from "./xml.ts";

export interface NumberingReference {
  numId?: string;
  level?: number;
}

export interface RunProperties {
  fontSizeHalfPoints?: number | null;
  complexSize?: number | null;
  wordColor?: WordColor;
  color?: string;
  formatWarnings?: ImportWarningCode[];
  marks: Partial<Record<InlineMark, boolean>>;
  visualFormatting: boolean;
}

export interface ParagraphProperties {
  alignment?: string;
  styleId?: string;
  outlineLevel?: number;
  numbering?: NumberingReference;
  run: RunProperties;
}

export interface ParagraphSemantics {
  textAlign?: "center";
  alignmentDropped?: boolean;
  headingLevel?: number;
  quote: boolean;
  numbering?: NumberingReference;
}

export interface NumberingLevel {
  formattingDropped?: boolean;
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
  tableStyleFormattingDropped(styleId: string | undefined): boolean;
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
  hasTargetFormatting: boolean;
  id: string;
  type: string;
  name?: string;
  default?: boolean;
  basedOn?: string;
  paragraph: ParagraphProperties;
  run: RunProperties;
}

interface ResolvedStyle {
  hasTargetFormatting: boolean;
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
  const styleNodes = pkg.has("word/styles.xml")
    ? parseOrderedXml(await pkg.readText("word/styles.xml"), "word/styles.xml")
    : [];
  const styles = parseStyles(styleNodes);
  const styleRoot = xmlChild(styleNodes, "styles");
  const defaults = xmlChild(styleRoot ?? {}, "docDefaults");
  const defaultRun = parseRunProperties(
    xmlChild(xmlChild(defaults ?? {}, "rPrDefault") ?? {}, "rPr"),
  );
  const defaultParagraph = parseParagraphProperties(
    xmlChild(xmlChild(defaults ?? {}, "pPrDefault") ?? {}, "pPr"),
  );
  const defaultStyles = new Map(
    [...styles.values()].filter((style) => style.default).map((style) => [style.type, style.id]),
  );
  const defaultStyle = (type: string) => defaultStyles.get(type);
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
  const themeRelation = [...relationships.values()].find(
    (relation) => relation.type.endsWith("/theme") && !relation.external,
  );
  const themePath = themeRelation
    ? new URL(themeRelation.target, "https://docx.invalid/word/document.xml").pathname.slice(1)
    : undefined;
  const theme =
    themePath && pkg.has(themePath)
      ? themeColors(parseOrderedXml(await pkg.readText(themePath), themePath))
      : new Map<string, string>();
  const resolvedStyles = new Map<string, ResolvedStyle>();

  const resolveStyle = (
    styleId: string | undefined,
    visiting = new Set<string>(),
  ): ResolvedStyle | undefined => {
    if (!styleId) return undefined;
    const cached = resolvedStyles.get(styleId);
    if (cached) return cached;
    const style = styles.get(styleId);
    if (!style || visiting.has(styleId) || visiting.size >= 64) return undefined;
    const nextVisiting = new Set(visiting).add(styleId);
    const base = resolveStyle(style.basedOn, nextVisiting);
    const resolved: ResolvedStyle = {
      hasTargetFormatting: !!base?.hasTargetFormatting || style.hasTargetFormatting,
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
    tableStyleFormattingDropped: (styleId) =>
      !!resolveStyle(styleId ?? defaultStyle("table"))?.hasTargetFormatting,
    paragraph(styleId, direct) {
      const style = resolveStyle(styleId ?? defaultStyle("paragraph"));
      const effective = mergeParagraphProperties(
        mergeParagraphProperties(defaultParagraph, style?.paragraph),
        direct,
      );
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
        ...(effective.alignment === "center" ? { textAlign: "center" as const } : {}),
        alignmentDropped:
          !!effective.alignment && !["left", "start", "center"].includes(effective.alignment),
        quote: (style?.labels ?? []).some((label) => label === "quote" || label === "intensequote"),
        numbering: effective.numbering,
      };
    },
    run(paragraphStyleId, characterStyleId, direct) {
      const paragraphStyle = resolveStyle(paragraphStyleId ?? defaultStyle("paragraph"));
      const characterStyle = resolveStyle(characterStyleId ?? defaultStyle("character"));
      const effective = mergeRunProperties(
        mergeRunProperties(
          mergeRunProperties(defaultRun, paragraphStyle?.run),
          characterStyle?.run,
        ),
        direct,
      );
      const formatWarnings: ImportWarningCode[] = [];
      if (
        effective.fontSizeHalfPoints === null ||
        (effective.complexSize !== undefined &&
          effective.complexSize !== effective.fontSizeHalfPoints)
      )
        formatWarnings.push("FONT_SIZE_DROPPED");
      const resolvedColor = effective.wordColor
        ? resolveWordColor(effective.wordColor, theme)
        : undefined;
      if (resolvedColor?.fallback || (resolvedColor?.color && lowContrast(resolvedColor.color)))
        formatWarnings.push("TEXT_COLOR_FALLBACK");
      return {
        ...effective,
        color: resolvedColor?.color,
        formatWarnings,
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
    alignment: xmlAttr(xmlChild(node, "jc") ?? {}, "val"),
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
  const visualNames = ["u", "highlight", "rFonts"];
  const size = (name: string) => {
    const child = xmlChild(node, name);
    if (!child) return undefined;
    const value = xmlAttr(child, "val");
    return value && /^\d+$/.test(value) && fontSize(Number(value) / 2) !== undefined
      ? Number(value)
      : null;
  };
  const color = xmlChild(node, "color");
  return {
    fontSizeHalfPoints: size("sz"),
    complexSize: size("szCs"),
    wordColor: color
      ? {
          value: xmlAttr(color, "val"),
          theme: xmlAttr(color, "themeColor"),
          tint: xmlAttr(color, "themeTint"),
          shade: xmlAttr(color, "themeShade"),
        }
      : undefined,
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
      hasTargetFormatting: hasTargetFormatting(node),
      id,
      type: xmlAttr(node, "type") ?? "paragraph",
      name: xmlAttr(xmlChild(node, "name") ?? {}, "val"),
      default: ["1", "true", "on"].includes(xmlAttr(node, "default") ?? ""),
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
      levels.set(level, {
        format,
        ordered: format !== "bullet",
        level,
        formattingDropped: hasTargetFormatting(xmlChild(levelNode, "rPr") ?? {}),
      });
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
    alignment: own?.alignment ?? base?.alignment,
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
    fontSizeHalfPoints:
      own?.fontSizeHalfPoints !== undefined ? own.fontSizeHalfPoints : base?.fontSizeHalfPoints,
    complexSize: own?.complexSize !== undefined ? own.complexSize : base?.complexSize,
    wordColor: own?.wordColor ?? base?.wordColor,
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

function lowContrast(color: string): boolean {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const text = luminance(color),
    paper = luminance("#fbfaf7");
  return (Math.max(text, paper) + 0.05) / (Math.min(text, paper) + 0.05) < 4.5;
}

function hasTargetFormatting(node: OrderedXmlNode): boolean {
  return (
    ["sz", "szCs", "color", "jc"].includes((xmlName(node) ?? "").split(":").at(-1)!) ||
    xmlChildren(node).some(hasTargetFormatting)
  );
}
