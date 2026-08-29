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
  commentRanges: WalkedCommentRange[];
}

export type CommentLocation = "body" | "list" | "table" | "image" | "nonText";

export interface WalkedCommentMarker {
  kind: "start" | "end";
  location: CommentLocation;
  blockId?: string;
  offset?: number;
}

export interface WalkedCommentSpan {
  location: "body" | "list";
  blockId: string;
  start: number;
  end: number;
}

export interface WalkedCommentRange {
  sourceCommentId: string;
  firstDocumentOrder: number;
  markers: WalkedCommentMarker[];
  spans: WalkedCommentSpan[];
  touchedLocations: CommentLocation[];
}

type RevisionMode = "accepted" | "discarded";

interface FieldState {
  instruction: string;
  collectingResult: boolean;
}

interface InlineState {
  field: FieldState | null;
  offset: number;
  commentMarkers: Array<{
    sourceCommentId: string;
    kind: "start" | "end";
    offset: number;
    location?: "image" | "nonText";
  }>;
  specialTouches: Array<{ sourceCommentId: string; location: "image" | "nonText" }>;
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
  if (!body) return { blocks: [], warnings: [], commentRanges: [] };
  const warnings = new WarningCollector();
  const blocks: ImportBlock[] = [];
  const activeCommentIds = new Set<string>();
  const commentRanges = new CommentRangeCollector();
  let adjacentList: { key: string; block: ListBlock } | undefined;
  let blockSequence = 0;

  for (const node of xmlChildren(body)) {
    const nodeName = localName(xmlName(node));
    if (nodeName === "tbl") {
      adjacentList = undefined;
      walkUnsupported(node, "table", activeCommentIds, commentRanges);
      continue;
    }
    if (nodeName !== "p") continue;
    if (paragraphContainsToc(node)) {
      warnings.add("TOC_SKIPPED");
      adjacentList = undefined;
      walkUnsupported(node, "nonText", activeCommentIds, commentRanges);
      continue;
    }
    const paragraphProperties = parseParagraphProperties(xmlChild(node, "pPr"));
    const semantics = lookups.paragraph(paragraphProperties.styleId, paragraphProperties);
    const segments: InlineSegment[] = [];
    const state: InlineState = {
      field: null,
      offset: 0,
      commentMarkers: [],
      specialTouches: [],
    };
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
        commentRanges.recordBlock(item.id, "list", segments, state.commentMarkers, state.specialTouches);
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
      commentRanges.recordBlock(item.id, "list", segments, state.commentMarkers, state.specialTouches);
    } else if (semantics.headingLevel !== undefined) {
      adjacentList = undefined;
      const level = Math.min(Math.max(semantics.headingLevel, 1), 4) as 1 | 2 | 3 | 4;
      if (semantics.headingLevel > 4) warnings.add("HEADING_LEVEL_CLAMPED");
      blocks.push({ type: "heading", id: blockId, level, segments });
      commentRanges.recordBlock(blockId, "body", segments, state.commentMarkers, state.specialTouches);
    } else if (semantics.quote) {
      adjacentList = undefined;
      blocks.push({ type: "quote", id: blockId, segments });
      commentRanges.recordBlock(blockId, "body", segments, state.commentMarkers, state.specialTouches);
    } else {
      adjacentList = undefined;
      blocks.push({ type: "paragraph", id: blockId, segments });
      commentRanges.recordBlock(blockId, "body", segments, state.commentMarkers, state.specialTouches);
    }
  }

  return { blocks, warnings: warnings.values(), commentRanges: commentRanges.values() };
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
    if (id) {
      state.commentMarkers.push({ sourceCommentId: id, kind: "start", offset: state.offset });
      activeCommentIds.add(id);
    }
    return;
  }
  if (name === "commentRangeEnd") {
    const id = xmlAttr(node, "id");
    if (id) {
      state.commentMarkers.push({ sourceCommentId: id, kind: "end", offset: state.offset });
      activeCommentIds.delete(id);
    }
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
      appendSegment(segments, xmlText(node), context, activeCommentIds, state);
    }
    return;
  }
  if (name === "tab" || name === "br") {
    if (context.revision === "accepted" && (!state.field || state.field.collectingResult)) {
      appendSegment(segments, name === "tab" ? "\t" : "\n", context, activeCommentIds, state);
    }
    return;
  }
  if (name === "drawing" || name === "pict") {
    for (const sourceCommentId of activeCommentIds) {
      state.specialTouches.push({ sourceCommentId, location: "image" });
    }
    for (const child of xmlChildren(node)) {
      walkInlineUnsupported(child, "image", state, activeCommentIds);
    }
    return;
  }
  if (name === "delText" || name === "commentReference") return;
  walkChildren(node, context, state, segments, activeCommentIds, lookups, warnings);
}

function walkInlineUnsupported(
  node: OrderedXmlNode,
  location: "image" | "nonText",
  state: InlineState,
  activeCommentIds: Set<string>,
): void {
  const name = localName(xmlName(node));
  if (name === "commentRangeStart" || name === "commentRangeEnd") {
    const sourceCommentId = xmlAttr(node, "id");
    if (!sourceCommentId) return;
    const kind = name === "commentRangeStart" ? "start" : "end";
    state.commentMarkers.push({ sourceCommentId, kind, offset: state.offset, location });
    state.specialTouches.push({ sourceCommentId, location });
    if (kind === "start") activeCommentIds.add(sourceCommentId);
    else activeCommentIds.delete(sourceCommentId);
    return;
  }
  if (name === "t") {
    for (const sourceCommentId of activeCommentIds) {
      state.specialTouches.push({ sourceCommentId, location });
    }
    return;
  }
  for (const child of xmlChildren(node)) {
    walkInlineUnsupported(child, location, state, activeCommentIds);
  }
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
  state: InlineState,
): void {
  if (!text) return;
  segments.push({
    text,
    marks: [...context.marks],
    ...(context.link ? { link: context.link } : {}),
    commentIds: [...activeCommentIds],
  });
  state.offset += text.length;
}

function walkUnsupported(
  node: OrderedXmlNode,
  location: "table" | "nonText",
  activeCommentIds: Set<string>,
  ranges: CommentRangeCollector,
): void {
  const name = localName(xmlName(node));
  if (name === "commentRangeStart") {
    const id = xmlAttr(node, "id");
    if (id) {
      ranges.recordMarker(id, "start", location);
      activeCommentIds.add(id);
    }
    return;
  }
  if (name === "commentRangeEnd") {
    const id = xmlAttr(node, "id");
    if (id) {
      ranges.recordMarker(id, "end", location);
      activeCommentIds.delete(id);
    }
    return;
  }
  if (name === "t") {
    for (const id of activeCommentIds) ranges.touch(id, location);
    return;
  }
  for (const child of xmlChildren(node)) {
    walkUnsupported(child, location, activeCommentIds, ranges);
  }
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

interface MutableCommentRange {
  sourceCommentId: string;
  firstDocumentOrder: number;
  markers: WalkedCommentMarker[];
  spans: WalkedCommentSpan[];
  touchedLocations: Set<CommentLocation>;
}

class CommentRangeCollector {
  readonly #ranges = new Map<string, MutableCommentRange>();
  #sequence = 0;

  recordBlock(
    blockId: string,
    location: "body" | "list",
    segments: InlineSegment[],
    markers: InlineState["commentMarkers"],
    specialTouches: InlineState["specialTouches"],
  ): void {
    for (const marker of markers) {
      const markerLocation = marker.location ?? location;
      this.recordMarker(
        marker.sourceCommentId,
        marker.kind,
        markerLocation,
        marker.location ? undefined : blockId,
        marker.location ? undefined : marker.offset,
      );
    }

    const spans = new Map<string, { start: number; end: number }>();
    let cursor = 0;
    for (const segment of segments) {
      const end = cursor + segment.text.length;
      for (const id of segment.commentIds) {
        const span = spans.get(id);
        if (span) span.end = end;
        else spans.set(id, { start: cursor, end });
      }
      cursor = end;
    }
    for (const [id, span] of spans) {
      const range = this.#get(id);
      range.touchedLocations.add(location);
      range.spans.push({ location, blockId, ...span });
    }
    for (const touch of specialTouches) this.touch(touch.sourceCommentId, touch.location);
  }

  recordMarker(
    sourceCommentId: string,
    kind: "start" | "end",
    location: CommentLocation,
    blockId?: string,
    offset?: number,
  ): void {
    const range = this.#get(sourceCommentId);
    range.touchedLocations.add(location);
    range.markers.push({ kind, location, blockId, offset });
  }

  touch(sourceCommentId: string, location: CommentLocation): void {
    this.#get(sourceCommentId).touchedLocations.add(location);
  }

  values(): WalkedCommentRange[] {
    return [...this.#ranges.values()]
      .sort((left, right) => left.firstDocumentOrder - right.firstDocumentOrder)
      .map((range) => ({
        sourceCommentId: range.sourceCommentId,
        firstDocumentOrder: range.firstDocumentOrder,
        markers: range.markers.map((marker) => ({ ...marker })),
        spans: range.spans.map((span) => ({ ...span })),
        touchedLocations: [...range.touchedLocations],
      }));
  }

  #get(sourceCommentId: string): MutableCommentRange {
    const existing = this.#ranges.get(sourceCommentId);
    if (existing) return existing;
    const created: MutableCommentRange = {
      sourceCommentId,
      firstDocumentOrder: this.#sequence++,
      markers: [],
      spans: [],
      touchedLocations: new Set(),
    };
    this.#ranges.set(sourceCommentId, created);
    return created;
  }
}
