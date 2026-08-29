import {
  characterStyleId,
  type DocxLookups,
  parseParagraphProperties,
  parseRunProperties,
} from "./lookups.ts";
import type {
  ImportBlock,
  ImportWarning,
  ImportWarningCode,
  InlineMark,
  InlineSegment,
  ListBlock,
} from "./types.ts";
import {
  type OrderedXmlNode,
  type OrderedXmlNodes,
  xmlAttr,
  xmlChild,
  xmlChildren,
  xmlName,
  xmlText,
} from "./xml.ts";

export interface WalkedDocument {
  blocks: ImportBlock[];
  warnings: ImportWarning[];
}

type RevisionMode = "accepted" | "discarded";

interface FieldState {
  instruction: string;
  collectingResult: boolean;
}

interface InlineState {
  field: FieldState | null;
}

interface InlineContext {
  revision: RevisionMode;
  link?: string;
  marks: InlineMark[];
  paragraphStyleId?: string;
}

const MARK_ORDER: InlineMark[] = ["strong", "em", "strike", "code"];

export function walkMainDocument(documentNodes: OrderedXmlNodes, lookups: DocxLookups): WalkedDocument {
  const document = xmlChild(documentNodes, "document");
  const body = document ? xmlChild(document, "body") : undefined;
  if (!body) return { blocks: [], warnings: [] };
  const warnings = new WarningCollector();
  const blocks: ImportBlock[] = [];
  const activeCommentIds = new Set<string>();
  let adjacentList: { key: string; block: ListBlock } | undefined;
  let blockSequence = 0;

  for (const node of xmlChildren(body)) {
    if (localName(xmlName(node)) !== "p") continue;
    if (paragraphContainsToc(node)) {
      warnings.add("TOC_SKIPPED");
      continue;
    }
    const paragraphProperties = parseParagraphProperties(xmlChild(node, "pPr"));
    const semantics = lookups.paragraph(paragraphProperties.styleId, paragraphProperties);
    const segments: InlineSegment[] = [];
    const state: InlineState = { field: null };
    const context: InlineContext = {
      revision: "accepted",
      marks: [],
      paragraphStyleId: paragraphProperties.styleId,
    };
    for (const child of xmlChildren(node)) {
      if (localName(xmlName(child)) === "pPr") continue;
      walkInline(child, context, state, segments, activeCommentIds, lookups, warnings);
    }

    const blockId = `block_${String(++blockSequence).padStart(6, "0")}`;
    const numbering = lookups.numbering(semantics.numbering);
    if (numbering) {
      const depth = Math.min(numbering.level, 2) as 0 | 1 | 2;
      if (numbering.level > 2) warnings.add("LIST_DEPTH_CLAMPED");
      const item = { id: `${blockId}_item_1`, segments, children: [] };
      const key = [
        semantics.numbering?.numId,
        numbering.format,
        numbering.level,
      ].join("\u0000");
      if (adjacentList?.key === key) {
        adjacentList.block.items.push(item);
        continue;
      }
      const block: ListBlock = {
        type: "list",
        id: blockId,
        ordered: numbering.ordered,
        depth,
        items: [item],
      };
      blocks.push(block);
      adjacentList = { key, block };
    } else if (semantics.headingLevel !== undefined) {
      adjacentList = undefined;
      const level = Math.min(Math.max(semantics.headingLevel, 1), 4) as 1 | 2 | 3 | 4;
      if (semantics.headingLevel > 4) warnings.add("HEADING_LEVEL_CLAMPED");
      blocks.push({ type: "heading", id: blockId, level, segments });
    } else if (semantics.quote) {
      adjacentList = undefined;
      blocks.push({ type: "quote", id: blockId, segments });
    } else {
      adjacentList = undefined;
      blocks.push({ type: "paragraph", id: blockId, segments });
    }
  }

  return { blocks, warnings: warnings.values() };
}

function walkInline(
  node: OrderedXmlNode,
  context: InlineContext,
  state: InlineState,
  segments: InlineSegment[],
  activeCommentIds: Set<string>,
  lookups: DocxLookups,
  warnings: WarningCollector,
): void {
  const name = localName(xmlName(node));
  if (!name) return;

  if (name === "commentRangeStart") {
    const id = xmlAttr(node, "id");
    if (id) activeCommentIds.add(id);
    return;
  }
  if (name === "commentRangeEnd") {
    const id = xmlAttr(node, "id");
    if (id) activeCommentIds.delete(id);
    return;
  }
  if (name === "ins" || name === "moveTo") {
    warnings.add("TRACK_CHANGES_FLATTENED");
    walkChildren(node, { ...context, revision: "accepted" }, state, segments, activeCommentIds, lookups, warnings);
    return;
  }
  if (name === "del" || name === "moveFrom") {
    warnings.add("TRACK_CHANGES_FLATTENED");
    return;
  }
  if (name === "hyperlink") {
    const relationship = lookups.relationship(xmlAttr(node, "id"));
    const link = relationship?.external ? sanitizeExternalLink(relationship.target) : undefined;
    if (relationship && !link) warnings.add("HYPERLINK_UNSAFE_DROPPED");
    walkChildren(node, { ...context, link }, state, segments, activeCommentIds, lookups, warnings);
    return;
  }
  if (name === "fldSimple") {
    walkChildren(node, context, state, segments, activeCommentIds, lookups, warnings);
    return;
  }
  if (name === "r") {
    const runPropertiesNode = xmlChild(node, "rPr");
    const effective = lookups.run(
      context.paragraphStyleId,
      characterStyleId(runPropertiesNode),
      parseRunProperties(runPropertiesNode),
    );
    if (effective.visualFormatting) warnings.add("VISUAL_FORMATTING_DROPPED");
    const marks = MARK_ORDER.filter((mark) => mark === "code" ? effective.codeStyle : effective.marks[mark]);
    for (const child of xmlChildren(node)) {
      if (localName(xmlName(child)) === "rPr") continue;
      walkInline(child, { ...context, marks }, state, segments, activeCommentIds, lookups, warnings);
    }
    return;
  }
  if (name === "fldChar") {
    const type = xmlAttr(node, "fldCharType")?.toLocaleLowerCase("en-US");
    if (type === "begin") state.field = { instruction: "", collectingResult: false };
    if (type === "separate" && state.field) state.field.collectingResult = true;
    if (type === "end") state.field = null;
    return;
  }
  if (name === "instrText") {
    if (state.field) state.field.instruction += xmlText(node);
    return;
  }
  if (name === "t") {
    if (context.revision === "accepted" && (!state.field || state.field.collectingResult)) {
      appendSegment(segments, xmlText(node), context, activeCommentIds);
    }
    return;
  }
  if (name === "tab" || name === "br") {
    if (context.revision === "accepted" && (!state.field || state.field.collectingResult)) {
      appendSegment(segments, name === "tab" ? "\t" : "\n", context, activeCommentIds);
    }
    return;
  }
  if (name === "delText" || name === "commentReference") return;
  walkChildren(node, context, state, segments, activeCommentIds, lookups, warnings);
}

function walkChildren(
  node: OrderedXmlNode,
  context: InlineContext,
  state: InlineState,
  segments: InlineSegment[],
  activeCommentIds: Set<string>,
  lookups: DocxLookups,
  warnings: WarningCollector,
): void {
  for (const child of xmlChildren(node)) {
    walkInline(child, context, state, segments, activeCommentIds, lookups, warnings);
  }
}

function appendSegment(
  segments: InlineSegment[],
  text: string,
  context: InlineContext,
  activeCommentIds: Set<string>,
): void {
  if (!text) return;
  segments.push({
    text,
    marks: [...context.marks],
    ...(context.link ? { link: context.link } : {}),
    commentIds: [...activeCommentIds],
  });
}

function paragraphContainsToc(node: OrderedXmlNode): boolean {
  const instructions: string[] = [];
  visit(node, (current) => {
    const name = localName(xmlName(current));
    if (name === "fldSimple") instructions.push(xmlAttr(current, "instr") ?? "");
    if (name === "instrText") instructions.push(xmlText(current));
  });
  return instructions.some((instruction) => /(?:^|\s)TOC(?:\s|$)/i.test(instruction.trim()));
}

function visit(node: OrderedXmlNode, callback: (node: OrderedXmlNode) => void): void {
  callback(node);
  for (const child of xmlChildren(node)) visit(child, callback);
}

function sanitizeExternalLink(target: string): string | undefined {
  try {
    const url = new URL(target);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? target : undefined;
  } catch {
    return undefined;
  }
}

function localName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const separator = name.lastIndexOf(":");
  return separator === -1 ? name : name.slice(separator + 1);
}

class WarningCollector {
  readonly #warnings: ImportWarning[] = [];

  add(code: ImportWarningCode): void {
    const existing = this.#warnings.find((warning) => warning.code === code && !warning.sourceRef);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else {
      this.#warnings.push({ code, severity: "warning", count: 1 });
    }
  }

  values(): ImportWarning[] {
    return this.#warnings.map((warning) => ({ ...warning }));
  }
}
