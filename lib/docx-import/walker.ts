import {
  characterStyleId,
  type DocxLookups,
  parseParagraphProperties,
  parseRunProperties,
} from "./lookups.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { DocxImportError } from "./types.ts";
import type {
  ImportBlock,
  ImportAsset,
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
  assetReferences: WalkedAssetReference[];
  warnings: ImportWarning[];
  commentRanges: WalkedCommentRange[];
}

export interface WalkedAssetReference extends Omit<ImportAsset, "bytes"> {
  packagePath: string;
  blockLocalOffset: number;
}

export interface DocxNoteParts {
  footnotes?: OrderedXmlNodes;
  endnotes?: OrderedXmlNodes;
}

export interface WalkOptions {
  acceptedAssetIds?: ReadonlySet<string>;
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
  assetReferences: WalkedAssetReference[];
  assetSequence: AssetSequence;
  noteSequence: NoteSequence;
  acceptedAssetIds?: ReadonlySet<string>;
}

interface InlineContext {
  revision: RevisionMode;
  link?: string;
  marks: InlineMark[];
  paragraphStyleId?: string;
}

const MARK_ORDER: InlineMark[] = ["strong", "em", "strike", "code"];

export function walkMainDocument(
  documentNodes: OrderedXmlNodes,
  lookups: DocxLookups,
  noteParts: DocxNoteParts = {},
  options: WalkOptions = {},
): WalkedDocument {
  const document = xmlChild(documentNodes, "document");
  const body = document ? xmlChild(document, "body") : undefined;
  if (!body) return { blocks: [], assetReferences: [], warnings: [], commentRanges: [] };
  const imageCount = descendants(body, "blip").length;
  if (imageCount > DOCX_IMPORT_LIMITS.images) {
    throw new DocxImportError(
      "IMAGE_COUNT_LIMIT",
      `DOCX contains more than ${DOCX_IMPORT_LIMITS.images} images`,
      { count: imageCount },
    );
  }
  const warnings = new WarningCollector();
  const blocks: ImportBlock[] = [];
  const activeCommentIds = new Set<string>();
  const commentRanges = new CommentRangeCollector();
  const assetReferences: WalkedAssetReference[] = [];
  const assetSequence = new AssetSequence();
  const noteSequence = new NoteSequence();
  let adjacentList: { key: string; block: ListBlock } | undefined;
  let blockSequence = 0;

  for (const node of xmlChildren(body)) {
    const nodeName = localName(xmlName(node));
    if (nodeName === "tbl") {
      adjacentList = undefined;
      walkUnsupported(node, "table", activeCommentIds, commentRanges);
      const tableBlocks = walkTable(
        node,
        lookups,
        warnings,
        noteSequence,
        () => `block_${String(++blockSequence).padStart(6, "0")}`,
      );
      blocks.push(...tableBlocks);
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
      assetReferences: [],
      assetSequence,
      noteSequence,
      acceptedAssetIds: options.acceptedAssetIds,
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

    const numbering = lookups.numbering(semantics.numbering);
    if (numbering && numbering.level > 2) warnings.add("LIST_DEPTH_CLAMPED");
    const content = numbering && state.assetReferences.length > 0
      ? listParagraphContent(segments, state.assetReferences)
      : splitParagraphContent(segments, state.assetReferences);
    let textChunkIndex = 0;
    for (const item of content) {
      if (item.type === "asset") {
        adjacentList = undefined;
        assetReferences.push(item.asset);
        blocks.push({
          type: "image",
          id: `block_${String(++blockSequence).padStart(6, "0")}`,
          assetId: item.asset.id,
          alt: item.asset.alt,
        });
        continue;
      }
      const blockId = `block_${String(++blockSequence).padStart(6, "0")}`;
      const markers = markersForChunk(state.commentMarkers, item.start, item.end);
      if (numbering) {
        const depth = Math.min(numbering.level, 2) as 0 | 1 | 2;
        const listItem = { id: `${blockId}_item_1`, segments: item.segments, children: [] };
        const key = [semantics.numbering?.numId, numbering.format, numbering.level].join("\u0000");
        if (adjacentList?.key === key) adjacentList.block.items.push(listItem);
        else {
          const block: ListBlock = {
            type: "list",
            id: blockId,
            ordered: numbering.ordered,
            depth,
            items: [listItem],
          };
          blocks.push(block);
          adjacentList = { key, block };
        }
        commentRanges.recordBlock(listItem.id, "list", item.segments, markers, state.specialTouches);
      } else if (semantics.headingLevel !== undefined && textChunkIndex === 0) {
        adjacentList = undefined;
        const level = Math.min(Math.max(semantics.headingLevel, 1), 4) as 1 | 2 | 3 | 4;
        if (semantics.headingLevel > 4) warnings.add("HEADING_LEVEL_CLAMPED");
        blocks.push({ type: "heading", id: blockId, level, segments: item.segments });
        commentRanges.recordBlock(blockId, "body", item.segments, markers, state.specialTouches);
      } else if (semantics.quote) {
        adjacentList = undefined;
        blocks.push({ type: "quote", id: blockId, segments: item.segments });
        commentRanges.recordBlock(blockId, "body", item.segments, markers, state.specialTouches);
      } else {
        adjacentList = undefined;
        blocks.push({ type: "paragraph", id: blockId, segments: item.segments });
        commentRanges.recordBlock(blockId, "body", item.segments, markers, state.specialTouches);
      }
      textChunkIndex += 1;
    }
    if (textChunkIndex === 0) {
      for (const marker of state.commentMarkers) {
        commentRanges.recordMarker(
          marker.sourceCommentId,
          marker.kind,
          marker.location ?? "image",
        );
      }
      for (const touch of state.specialTouches) commentRanges.touch(touch.sourceCommentId, touch.location);
    }
  }

  recordAllNoteCommentLocations(noteParts, commentRanges);
  appendNotesAppendix(
    blocks,
    noteParts,
    noteSequence,
    lookups,
    warnings,
    () => `block_${String(++blockSequence).padStart(6, "0")}`,
  );

  return { blocks, assetReferences, warnings: warnings.values(), commentRanges: commentRanges.values() };
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
    const link = relationship?.type.endsWith("/hyperlink") && relationship.external
      ? sanitizeExternalLink(relationship.target)
      : undefined;
    if (relationship?.type.endsWith("/hyperlink") && !link) warnings.add("HYPERLINK_UNSAFE_DROPPED");
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
  if (name === "footnoteReference" || name === "endnoteReference") {
    const sourceId = xmlAttr(node, "id");
    if (!sourceId) return;
    for (const sourceCommentId of activeCommentIds) {
      state.specialTouches.push({ sourceCommentId, location: "nonText" });
    }
    const number = state.noteSequence.reference(
      name === "footnoteReference" ? "footnote" : "endnote",
      sourceId,
    );
    appendSyntheticSegment(segments, `[${number}]`, "noteReference", state);
    return;
  }
  if (name === "oMath" || name === "oMathPara") {
    for (const sourceCommentId of activeCommentIds) {
      state.specialTouches.push({ sourceCommentId, location: "nonText" });
    }
    appendSyntheticSegment(segments, "[公式]", "equation", state);
    warnings.add("EQUATION_SKIPPED");
    return;
  }
  if (name === "tab" || name === "br") {
    if (context.revision === "accepted" && (!state.field || state.field.collectingResult)) {
      appendSegment(segments, name === "tab" ? "\t" : "\n", context, activeCommentIds, state);
    }
    return;
  }
  if (name === "drawing" || name === "pict") {
    walkDrawing(node, context, state, segments, activeCommentIds, lookups, warnings);
    return;
  }
  if (name === "delText" || name === "commentReference") return;
  walkChildren(node, context, state, segments, activeCommentIds, lookups, warnings);
}

function walkDrawing(
  node: OrderedXmlNode,
  context: InlineContext,
  state: InlineState,
  segments: InlineSegment[],
  activeCommentIds: Set<string>,
  lookups: DocxLookups,
  warnings: WarningCollector,
): void {
  const blips = descendants(node, "blip");
  const location = blips.length > 0 ? "image" : "nonText";
  for (const sourceCommentId of activeCommentIds) {
    state.specialTouches.push({ sourceCommentId, location });
  }
  for (const child of xmlChildren(node)) walkInlineUnsupported(child, location, state, activeCommentIds);

  const floating = descendants(node, "anchor").length > 0;
  const documentProperties = descendants(node, "docPr")[0];
  for (const blip of blips) {
    const sourceRelationshipId = xmlAttr(blip, "embed");
    const sequence = state.assetSequence.next();
    const relationship = lookups.relationship(sourceRelationshipId);
    const packagePath = relationship && !relationship.external && relationship.type.endsWith("/image")
      ? resolveEmbeddedMediaPath(relationship.target)
      : undefined;
    const filename = packagePath?.split("/").at(-1);
    const extensionMimeType = filename ? imageMimeFromFilename(filename) : undefined;
    const declaredMimeType = packagePath ? lookups.contentType(packagePath) : undefined;
    const mimeType = extensionMimeType === declaredMimeType ? extensionMimeType : undefined;
    if (!sourceRelationshipId || !relationship || !packagePath || !filename || !mimeType) {
      warnings.add("IMAGE_FORMAT_UNSUPPORTED");
      continue;
    }
    const id = `asset_${String(sequence).padStart(6, "0")}`;
    if (state.acceptedAssetIds && !state.acceptedAssetIds.has(id)) continue;
    const alt = xmlAttr(documentProperties ?? {}, "descr")
      || xmlAttr(documentProperties ?? {}, "title")
      || filename
      || "image";
    state.assetReferences.push({
      id,
      filename,
      mimeType,
      alt,
      sourceRelationshipId,
      floating,
      packagePath,
      blockLocalOffset: state.offset,
    });
    if (floating) warnings.add("FLOATING_IMAGE_FLATTENED");
  }

  const textBoxes = descendants(node, "txbxContent");
  for (const textBox of textBoxes) {
    const paragraphText = xmlChildren(textBox, "p")
      .map((paragraph) => xmlText(paragraph).trim())
      .filter(Boolean);
    if (paragraphText.length === 0) continue;
    appendSegmentWithIds(segments, paragraphText.join(" / "), context, new Set(), state);
    warnings.add("TEXTBOX_FLATTENED");
  }

  const equations = descendants(node, "oMath");
  for (let remaining = equations.length; remaining > 0; remaining -= 1) {
    appendSyntheticSegment(segments, "[公式]", "equation", state);
    warnings.add("EQUATION_SKIPPED");
  }

  const shapeText = collectShapeText(node, new Set(textBoxes));
  if (shapeText) appendSegmentWithIds(segments, shapeText, context, new Set(), state);
  if (blips.length === 0 && textBoxes.length === 0 && equations.length === 0 && !shapeText) {
    warnings.add("SHAPE_CONTENT_SKIPPED");
  }
}

function descendants(node: OrderedXmlNode, name: string): OrderedXmlNode[] {
  const result: OrderedXmlNode[] = [];
  visit(node, (current) => {
    if (localName(xmlName(current)) === name) result.push(current);
  });
  return result;
}

function collectShapeText(node: OrderedXmlNode, excludedRoots: Set<OrderedXmlNode>): string {
  const values: string[] = [];
  const collect = (current: OrderedXmlNode) => {
    if (excludedRoots.has(current)) return;
    const name = xmlName(current);
    if (name?.endsWith(":t") && !name.endsWith("w:t") && !name.endsWith("m:t")) {
      const value = xmlText(current).trim();
      if (value) values.push(value);
      return;
    }
    for (const child of xmlChildren(current)) collect(child);
  };
  collect(node);
  return values.join(" ");
}

function resolveEmbeddedMediaPath(target: string): string | undefined {
  try {
    const path = decodeURIComponent(
      new URL(target, "https://docx.invalid/word/document.xml").pathname.slice(1),
    );
    return path.startsWith("word/media/") && !path.includes("..") ? path : undefined;
  } catch {
    return undefined;
  }
}

function imageMimeFromFilename(filename: string): ImportAsset["mimeType"] | undefined {
  const extension = filename.split(".").at(-1)?.toLocaleLowerCase("en-US");
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return undefined;
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
  appendSegmentWithIds(segments, text, context, activeCommentIds, state);
}

function appendSegmentWithIds(
  segments: InlineSegment[],
  text: string,
  context: InlineContext,
  commentIds: Set<string>,
  state: InlineState,
): void {
  if (!text) return;
  segments.push({
    text,
    marks: [...context.marks],
    ...(context.link ? { link: context.link } : {}),
    commentIds: [...commentIds],
  });
  state.offset += text.length;
}

function appendSyntheticSegment(
  segments: InlineSegment[],
  text: string,
  synthetic: NonNullable<InlineSegment["synthetic"]>,
  state: InlineState,
): void {
  segments.push({ text, marks: [], commentIds: [], synthetic });
  state.offset += text.length;
}

type ParagraphContentItem =
  | { type: "text"; start: number; end: number; segments: InlineSegment[] }
  | { type: "asset"; asset: WalkedAssetReference };

function splitParagraphContent(
  segments: InlineSegment[],
  assets: WalkedAssetReference[],
): ParagraphContentItem[] {
  if (assets.length === 0) {
    const length = segments.reduce((total, segment) => total + segment.text.length, 0);
    return [{ type: "text", start: 0, end: length, segments }];
  }
  const result: ParagraphContentItem[] = [];
  const totalLength = segments.reduce((total, segment) => total + segment.text.length, 0);
  if (totalLength === 0) {
    return [
      { type: "text", start: 0, end: 0, segments: [] },
      ...assets.map((asset): ParagraphContentItem => ({ type: "asset", asset })),
    ];
  }
  let cursor = 0;
  for (const asset of assets) {
    const offset = Math.min(Math.max(asset.blockLocalOffset, cursor), totalLength);
    if (offset > cursor) {
      result.push({ type: "text", start: cursor, end: offset, segments: sliceSegments(segments, cursor, offset) });
    }
    result.push({ type: "asset", asset });
    cursor = offset;
  }
  if (cursor < totalLength) {
    result.push({ type: "text", start: cursor, end: totalLength, segments: sliceSegments(segments, cursor, totalLength) });
  }
  return result;
}

function listParagraphContent(
  segments: InlineSegment[],
  assets: WalkedAssetReference[],
): ParagraphContentItem[] {
  const end = segments.reduce((total, segment) => total + segment.text.length, 0);
  return [
    { type: "text", start: 0, end, segments },
    ...assets.map((asset): ParagraphContentItem => ({ type: "asset", asset })),
  ];
}

function sliceSegments(segments: InlineSegment[], start: number, end: number): InlineSegment[] {
  const sliced: InlineSegment[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.text.length;
    cursor = segmentEnd;
    if (segmentEnd <= start || segmentStart >= end) continue;
    sliced.push({
      ...segment,
      text: segment.text.slice(
        Math.max(0, start - segmentStart),
        Math.min(segment.text.length, end - segmentStart),
      ),
      commentIds: [...segment.commentIds],
      marks: [...segment.marks],
    });
  }
  return sliced;
}

function markersForChunk(
  markers: InlineState["commentMarkers"],
  start: number,
  end: number,
): InlineState["commentMarkers"] {
  return markers.flatMap((marker) => {
    if (!marker.location && start === end && marker.offset === start) {
      return [{ ...marker, offset: 0 }];
    }
    if (marker.location || (
      marker.kind === "start"
        ? marker.offset < start || marker.offset >= end
        : marker.offset <= start || marker.offset > end
    )) return [];
    return [{ ...marker, offset: marker.offset - start }];
  });
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

function walkTable(
  node: OrderedXmlNode,
  lookups: DocxLookups,
  warnings: WarningCollector,
  noteSequence: NoteSequence,
  nextBlockId: () => string,
): ImportBlock[] {
  const gridWidth = xmlChildren(xmlChild(node, "tblGrid") ?? {}, "gridCol").length;
  const rowNodes = xmlChildren(node, "tr");
  const rows = rowNodes.map((row) => {
    const properties = xmlChild(row, "trPr");
    const leading = nonnegativeAttribute(xmlChild(properties ?? {}, "gridBefore"), "val");
    const trailing = nonnegativeAttribute(xmlChild(properties ?? {}, "gridAfter"), "val");
    const sourceCells = xmlChildren(row, "tc")
      .map((cell) => tableCell(cell, lookups, warnings, noteSequence));
    return {
      explicitHeader: xmlChild(properties ?? {}, "tblHeader") !== undefined,
      sourceCells,
      cells: [
        ...Array.from({ length: leading }, emptyTableCell),
        ...sourceCells,
        ...Array.from({ length: trailing }, emptyTableCell),
      ],
    };
  });
  if (rows.length === 0) return [];

  let merged = false;
  visit(node, (current) => {
    if (["gridSpan", "vMerge", "rowSpan", "colSpan"].includes(localName(xmlName(current)) ?? "")) {
      merged = true;
    }
  });
  if (merged) {
    warnings.add("TABLE_MERGED_CELLS_FLATTENED");
    return rows.map((row) => ({
      type: "paragraph",
      id: nextBlockId(),
      segments: joinSegmentGroups(row.sourceCells.map((cell) => cell.segments), " | "),
    }));
  }

  const width = Math.max(1, gridWidth, ...rows.map((row) => row.cells.length));
  const normalizedRows = rows.map((row) => ({
    ...row,
    cells: [...row.cells, ...Array.from({ length: width - row.cells.length }, emptyTableCell)],
  }));
  const first = normalizedRows[0];
  const hasHeader = first.explicitHeader;
  if (!hasHeader) warnings.add("TABLE_HEADER_SYNTHESIZED");
  return [{
    type: "table",
    id: nextBlockId(),
    header: hasHeader ? { cells: first.cells } : {
      cells: Array.from({ length: width }, emptyTableCell),
    },
    rows: (hasHeader ? normalizedRows.slice(1) : normalizedRows).map((row) => ({ cells: row.cells })),
  }];
}

function tableCell(
  node: OrderedXmlNode,
  lookups: DocxLookups,
  warnings: WarningCollector,
  noteSequence: NoteSequence,
): { segments: InlineSegment[] } {
  const paragraphs = xmlChildren(node, "p");
  if (paragraphs.length > 1) warnings.add("TABLE_CELL_FLATTENED");
  return {
    segments: joinSegmentGroups(
      paragraphs.map((paragraph) => paragraphSegments(paragraph, lookups, warnings, noteSequence)),
      " / ",
    ),
  };
}

function paragraphSegments(
  paragraph: OrderedXmlNode,
  lookups: DocxLookups,
  warnings: WarningCollector,
  noteSequence: NoteSequence,
): InlineSegment[] {
  const paragraphProperties = parseParagraphProperties(xmlChild(paragraph, "pPr"));
  const segments: InlineSegment[] = [];
  const state: InlineState = {
    field: null,
    offset: 0,
    commentMarkers: [],
    specialTouches: [],
    assetReferences: [],
    assetSequence: new AssetSequence(),
    noteSequence,
    acceptedAssetIds: undefined,
  };
  const context: InlineContext = {
    revision: "accepted",
    marks: [],
    paragraphStyleId: paragraphProperties.styleId,
  };
  const ignoredComments = new Set<string>();
  for (const child of xmlChildren(paragraph)) {
    if (localName(xmlName(child)) === "pPr") continue;
    walkInline(child, context, state, segments, ignoredComments, lookups, warnings);
  }
  return segments.map((segment) => ({ ...segment, commentIds: [] }));
}

function joinSegmentGroups(groups: InlineSegment[][], separator: string): InlineSegment[] {
  const joined: InlineSegment[] = [];
  for (const [index, group] of groups.entries()) {
    if (index > 0) joined.push({ text: separator, marks: [], commentIds: [] });
    joined.push(...group);
  }
  return joined;
}

function emptyTableCell(): { segments: InlineSegment[] } {
  return { segments: [] };
}

function nonnegativeAttribute(node: OrderedXmlNode | undefined, name: string): number {
  const value = Number(node ? xmlAttr(node, name) : undefined);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function appendNotesAppendix(
  blocks: ImportBlock[],
  parts: DocxNoteParts,
  sequence: NoteSequence,
  lookups: DocxLookups,
  warnings: WarningCollector,
  nextBlockId: () => string,
): void {
  const references = sequence.values();
  if (references.length === 0) return;
  const notes = references.map((reference) => {
    const nodes = reference.kind === "footnote" ? parts.footnotes : parts.endnotes;
    const root = nodes ? xmlChild(nodes, reference.kind === "footnote" ? "footnotes" : "endnotes") : undefined;
    const note = root
      ? xmlChildren(root, reference.kind).find((candidate) => xmlAttr(candidate, "id") === reference.sourceId)
      : undefined;
    const segments = note
      ? joinSegmentGroups(
        xmlChildren(note, "p").map((paragraph) => paragraphSegments(paragraph, lookups, warnings, sequence)),
        " / ",
      )
      : [];
    return { number: reference.number, segments };
  });
  blocks.push({ type: "notesAppendix", id: nextBlockId(), title: "脚注（从 Word 导入）", notes });
  warnings.add("NOTES_FLATTENED_TO_APPENDIX");
}

function recordAllNoteCommentLocations(
  parts: DocxNoteParts,
  ranges: CommentRangeCollector,
): void {
  for (const [nodes, rootName, entryName] of [
    [parts.footnotes, "footnotes", "footnote"],
    [parts.endnotes, "endnotes", "endnote"],
  ] as const) {
    const root = nodes ? xmlChild(nodes, rootName) : undefined;
    for (const note of root ? xmlChildren(root, entryName) : []) {
      walkUnsupported(note, "nonText", new Set(), ranges);
    }
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
      this.#warnings.push({ code, severity: INFO_WARNING_CODES.has(code) ? "info" : "warning", count: 1 });
    }
  }

  values(): ImportWarning[] {
    return this.#warnings.map((warning) => ({ ...warning }));
  }
}

const INFO_WARNING_CODES = new Set<ImportWarningCode>([
  "TABLE_HEADER_SYNTHESIZED",
  "FLOATING_IMAGE_FLATTENED",
  "NOTES_FLATTENED_TO_APPENDIX",
  "TRACK_CHANGES_FLATTENED",
]);

class AssetSequence {
  #value = 0;

  next(): number {
    this.#value += 1;
    if (this.#value > DOCX_IMPORT_LIMITS.images) {
      throw new DocxImportError(
        "IMAGE_COUNT_LIMIT",
        `DOCX contains more than ${DOCX_IMPORT_LIMITS.images} images`,
        { count: this.#value },
      );
    }
    return this.#value;
  }
}

interface NoteReference {
  kind: "footnote" | "endnote";
  sourceId: string;
  number: number;
}

class NoteSequence {
  readonly #references = new Map<string, NoteReference>();

  reference(kind: NoteReference["kind"], sourceId: string): number {
    const key = `${kind}:${sourceId}`;
    const existing = this.#references.get(key);
    if (existing) return existing.number;
    const reference = { kind, sourceId, number: this.#references.size + 1 };
    this.#references.set(key, reference);
    return reference.number;
  }

  values(): NoteReference[] {
    return [...this.#references.values()];
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
