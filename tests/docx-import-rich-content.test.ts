import assert from "node:assert/strict";
import test from "node:test";

import { DOCX_IMPORT_LIMITS } from "../lib/docx-import/limits.ts";
import { parseDocx } from "../lib/docx-import/parse.ts";
import { DocxImportError } from "../lib/docx-import/types.ts";
import {
  documentRelationshipsXml,
  makeDocxFixture,
  MINIMAL_CONTENT_TYPES,
  wordDocumentXml,
} from "./helpers/docx-fixture.ts";

const RICH_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="emf" ContentType="image/x-emf"/>
  <Default Extension="wmf" ContentType="image/x-wmf"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/media/card%20art.webp" ContentType="image/webp"/>
</Types>`;

const parseOptions = {
  createAnnotationId: (sourceCommentId: string) =>
    `ann_00000000-0000-4000-8000-${sourceCommentId.padStart(12, "0")}`,
  createReplyId: (sourceCommentId: string) =>
    `00000000-0000-4000-8000-${sourceCommentId.padStart(12, "0")}`,
};

test("renders rectangular tables and flattens merged tables without raw HTML", async () => {
  const explicitHeader = tableXml([
    rowXml([cellXml("标题 A"), cellXml("标题 | B")], true),
    rowXml([formattedCellXml(), cellXml("正文 B")]),
  ]);
  const syntheticHeader = tableXml([rowXml([cellXml("无标题 A"), cellXml("无标题 B")])]);
  const merged = tableXml([
    rowXml([cellXml("合并 A", undefined, '<w:gridSpan w:val="2"/>'), cellXml("合并 B")]),
    rowXml([cellXml("下一行"), cellXml("末格")]),
  ]);
  const gridOffsets = `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>
    ${rowXml([cellXml("网格 A"), cellXml("网格 B"), cellXml("网格 C")], true)}
    <w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr>${cellXml("居中")}</w:tr>
  </w:tbl>`;
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(
        `${explicitHeader}${syntheticHeader}${merged}${gridOffsets}`,
      ),
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        `<Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a|b" TargetMode="External"/>`,
      ),
    }),
    undefined,
    parseOptions,
  );

  assert.match(parsed.canonicalMarkdown, /\| 标题 A \| 标题 \\| B \|/);
  assert.match(
    parsed.canonicalMarkdown,
    /\| \*\*正文 A\*\* \/ \[第二段\]\(https:\/\/example\.com\/a\\\|b\) \| 正文 B \|/,
  );
  assert.match(
    parsed.canonicalMarkdown,
    /\|\s*\|\s*\|\n\| --- \| --- \|\n\| 无标题 A \| 无标题 B \|/,
  );
  assert.match(parsed.canonicalMarkdown, /合并 A \\| 合并 B\n\n下一行 \\| 末格/);
  assert.match(parsed.canonicalMarkdown, /\|  \| 居中 \|  \|/);
  assert.doesNotMatch(parsed.canonicalMarkdown, /<table|<td/i);
  assert.deepEqual(warningCount(parsed, "TABLE_HEADER_SYNTHESIZED"), 1);
  assert.deepEqual(warningCount(parsed, "TABLE_CELL_FLATTENED"), 1);
  assert.deepEqual(warningCount(parsed, "TABLE_MERGED_CELLS_FLATTENED"), 1);
});

test("flattens every supported Word merged-cell marker", async () => {
  for (const marker of [
    '<w:vMerge w:val="restart"/>',
    '<w:rowSpan w:val="2"/>',
    '<w:colSpan w:val="2"/>',
  ]) {
    const parsed = await parseDocx(
      await makeDocxFixture({
        "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
        "word/document.xml": wordDocumentXml(
          tableXml([rowXml([cellXml("左", undefined, marker), cellXml("右")])]),
        ),
      }),
      undefined,
      parseOptions,
    );
    assert.deepEqual(
      parsed.blocks.map((block) => block.type),
      ["paragraph"],
    );
    assert.equal(warningCount(parsed, "TABLE_MERGED_CELLS_FLATTENED"), 1);
  }
});

test("imports supported embedded images with deterministic alt text and floating degradation", async () => {
  const relationships = [
    imageRelationship("rPng", "media/picture.png"),
    imageRelationship("rJpeg", "media/photo.jpg"),
    imageRelationship("rGif", "media/anim.gif"),
    imageRelationship("rWebp", "media/card%20art.webp"),
    imageRelationship("rSvg", "media/vector.svg"),
    imageRelationship("rEmf", "media/vector.emf"),
    imageRelationship("rWmf", "media/vector.wmf"),
    imageRelationship("rBad", "media/bad.png"),
    imageRelationship("rUnsafe", "../media/escape.png"),
  ].join("");
  const body = [
    drawingXml("rPng", false, { descr: "描述优先", title: "标题备用" }),
    drawingXml("rJpeg", false, { title: "照片标题" }),
    drawingXml("rGif", true),
    drawingXml("rWebp", false),
    drawingXml("rSvg", false),
    drawingXml("rEmf", false),
    drawingXml("rWmf", false),
    drawingXml("rBad", false),
    drawingXml("rMissing", false),
    drawingXml("rUnsafe", false),
  ]
    .map((drawing) => `<w:p><w:r>${drawing}</w:r></w:p>`)
    .join("");
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(body),
      "word/_rels/document.xml.rels": documentRelationshipsXml(relationships),
      "word/media/picture.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      "word/media/photo.jpg": bytes(0xff, 0xd8, 0xff, 0xe0),
      "word/media/anim.gif": new TextEncoder().encode("GIF89a"),
      "word/media/card art.webp": new TextEncoder().encode("RIFF0000WEBP"),
      "word/media/vector.svg": new TextEncoder().encode("<svg/>"),
      "word/media/vector.emf": bytes(0x01, 0x00),
      "word/media/vector.wmf": bytes(0xd7, 0xcd),
      "word/media/bad.png": bytes(0xff, 0xd8, 0xff),
      "media/escape.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    }),
    undefined,
    parseOptions,
  );

  assert.deepEqual(
    parsed.assets.map((asset) => [asset.mimeType, asset.alt, asset.floating]),
    [
      ["image/png", "描述优先", false],
      ["image/jpeg", "照片标题", false],
      ["image/gif", "anim.gif", true],
      ["image/webp", "card art.webp", false],
    ],
  );
  assert.match(parsed.canonicalMarkdown, /!\[描述优先\]\(docx-asset:asset_000001\)/);
  assert.match(parsed.canonicalMarkdown, /!\[anim\\.gif\]\(docx-asset:asset_000003\)/);
  assert.equal(warningCount(parsed, "FLOATING_IMAGE_FLATTENED"), 1);
  assert.equal(warningCount(parsed, "IMAGE_FORMAT_UNSUPPORTED"), 6);
});

test("rejects image count and per-image byte limits before extraction", async () => {
  const repeated = Array.from(
    { length: DOCX_IMPORT_LIMITS.images + 1 },
    () => `<w:p><w:r>${drawingXml("rImage", false)}</w:r></w:p>`,
  ).join("");
  const relationships = documentRelationshipsXml(imageRelationship("rImage", "media/image.png"));
  const tooMany = await makeDocxFixture({
    "[Content_Types].xml": RICH_CONTENT_TYPES,
    "word/document.xml": wordDocumentXml(repeated),
    "word/_rels/document.xml.rels": relationships,
    "word/media/image.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  });
  await assert.rejects(
    () => parseDocx(tooMany),
    (error: unknown) => error instanceof DocxImportError && error.code === "IMAGE_COUNT_LIMIT",
  );

  const oversized = await makeDocxFixture(
    {
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(`<w:p><w:r>${drawingXml("rImage", false)}</w:r></w:p>`),
      "word/_rels/document.xml.rels": relationships,
      "word/media/image.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    },
    {
      patchSizes: [
        {
          name: "word/media/image.png",
          compressedSize: DOCX_IMPORT_LIMITS.imageBytes + 1,
          uncompressedSize: DOCX_IMPORT_LIMITS.imageBytes + 1,
        },
      ],
    },
  );
  await assert.rejects(
    () => parseDocx(oversized),
    (error: unknown) => error instanceof DocxImportError && error.code === "IMAGE_SIZE_LIMIT",
  );
});

test("reads and validates one media part only once when Word reuses it", async () => {
  const drawing = `<w:p><w:r>${drawingXml("rImage", false)}</w:r></w:p>`;
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(`${drawing}${drawing}`),
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        imageRelationship("rImage", "media/reused.png"),
      ),
      "word/media/reused.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    }),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.assets.length, 2);
  assert.equal(parsed.assets[0]?.bytes, parsed.assets[1]?.bytes);
});

test("keeps an image between the paragraph text that surrounds its anchor", async () => {
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(`<w:p>
      <w:r><w:t>图片前</w:t></w:r><w:r>${drawingXml("rImage", true)}</w:r>
      <w:commentRangeStart w:id="92"/><w:r><w:t>图片后</w:t></w:r><w:commentRangeEnd w:id="92"/>
    </w:p>`),
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        imageRelationship("rImage", "media/ordered.png"),
      ),
      "word/media/ordered.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      "word/comments.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
        <w:comment w:id="92" w:author="批注者"><w:p w14:paraId="AAA00092"><w:r><w:t>图片后的批注</w:t></w:r></w:p></w:comment>
      </w:comments>`,
    }),
    undefined,
    parseOptions,
  );

  assert.deepEqual(
    parsed.blocks.map((block) => block.type),
    ["paragraph", "image", "paragraph"],
  );
  assert.equal(parsed.threads[0]?.blockId, parsed.blocks[2]?.id);
  assert.match(
    parsed.canonicalMarkdown,
    /^图片前\n\n!\[ordered\\.png\]\([^\n]+\)\n\n:annotation\[图片后\]/,
  );
});

test("keeps a list item whole when it contains an embedded image", async () => {
  const numbering = `<?xml version="1.0" encoding="UTF-8"?>
    <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    </w:numbering>`;
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml":
        wordDocumentXml(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>列表前</w:t></w:r><w:r>${drawingXml("rImage", false)}</w:r><w:r><w:t>列表后</w:t></w:r>
    </w:p>`),
      "word/numbering.xml": numbering,
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        imageRelationship("rImage", "media/list.png"),
      ),
      "word/media/list.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    }),
    undefined,
    parseOptions,
  );

  assert.deepEqual(
    parsed.blocks.map((block) => block.type),
    ["list", "image"],
  );
  assert.equal(parsed.blocks[0]?.type === "list" ? parsed.blocks[0].items.length : 0, 1);
  assert.match(parsed.canonicalMarkdown, /^1\. 列表前列表后\n\n!\[list\\.png\]/);
});

test("does not split paragraph text around an image rejected by signature validation", async () => {
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(`<w:p><w:r><w:t>拒绝前</w:t></w:r>
      <w:r>${drawingXml("rImage", false)}</w:r><w:r><w:t>拒绝后</w:t></w:r></w:p>`),
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        imageRelationship("rImage", "media/not-really.png"),
      ),
      "word/media/not-really.png": bytes(0xff, 0xd8, 0xff),
    }),
    undefined,
    parseOptions,
  );

  assert.deepEqual(
    parsed.blocks.map((block) => block.type),
    ["paragraph"],
  );
  assert.equal(parsed.canonicalMarkdown, "拒绝前拒绝后");
});

test("keeps an empty range before a pure-image anchor classified as empty", async () => {
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": RICH_CONTENT_TYPES,
      "word/document.xml":
        wordDocumentXml(`<w:p><w:commentRangeStart w:id="93"/><w:commentRangeEnd w:id="93"/>
      <w:r>${drawingXml("rImage", false)}</w:r></w:p>`),
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        imageRelationship("rImage", "media/empty.png"),
      ),
      "word/media/empty.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      "word/comments.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
        <w:comment w:id="93" w:author="批注者"><w:p w14:paraId="AAA00093"><w:r><w:t>空范围</w:t></w:r></w:p></w:comment>
      </w:comments>`,
    }),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.skippedThreads[0]?.warning.code, "ANNOTATION_EMPTY_RANGE");
});

test("requires package MIME, filename extension, and bytes to agree", async () => {
  const mismatchedTypes = RICH_CONTENT_TYPES.replace(
    'Extension="png" ContentType="image/png"',
    'Extension="png" ContentType="image/jpeg"',
  );
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": mismatchedTypes,
      "word/document.xml": wordDocumentXml(`<w:p><w:r>${drawingXml("rImage", false)}</w:r></w:p>`),
      "word/_rels/document.xml.rels": documentRelationshipsXml(
        imageRelationship("rImage", "media/mismatch.png"),
      ),
      "word/media/mismatch.png": bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    }),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.assets.length, 0);
  assert.equal(warningCount(parsed, "IMAGE_FORMAT_UNSUPPORTED"), 1);
});

test("preserves readable text boxes and shapes while degrading equations deterministically", async () => {
  const body = `<w:p><w:r><w:drawing>
    <wps:txbx><w:txbxContent>
      <w:p><w:r><w:t>文本框第一段</w:t></w:r></w:p>
      <w:p><w:r><w:t>文本框第二段</w:t></w:r></w:p>
    </w:txbxContent></wps:txbx>
  </w:drawing></w:r></w:p>
  <w:p><m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></w:p>
  <w:p><w:r><w:drawing><a:t>形状文字</a:t></w:drawing></w:r></w:p>
  <w:p><w:r><w:drawing><a:graphic/></w:drawing></w:r></w:p>`;
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(body),
    }),
    undefined,
    parseOptions,
  );

  assert.match(parsed.canonicalMarkdown, /文本框第一段 \/ 文本框第二段/);
  assert.match(parsed.canonicalMarkdown, /\[公式\]/);
  assert.match(parsed.canonicalMarkdown, /形状文字/);
  assert.equal(warningCount(parsed, "TEXTBOX_FLATTENED"), 1);
  assert.equal(warningCount(parsed, "EQUATION_SKIPPED"), 1);
  assert.equal(warningCount(parsed, "SHAPE_CONTENT_SKIPPED"), 1);
});

test("numbers footnotes and endnotes in one appendix and rejects note comments as non-text", async () => {
  const body = `<w:p><w:r><w:t>正文</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r>
    <w:r><w:t>继续</w:t></w:r><w:r><w:endnoteReference w:id="5"/></w:r></w:p>`;
  const footnotes = notesXml(
    "footnotes",
    `
    <w:footnote w:id="2"><w:p><w:commentRangeStart w:id="90"/><w:r><w:t>脚注正文</w:t></w:r><w:commentRangeEnd w:id="90"/></w:p></w:footnote>`,
  );
  const endnotes = notesXml(
    "endnotes",
    `
    <w:endnote w:id="5"><w:p><w:r><w:t>尾注正文</w:t></w:r></w:p></w:endnote>`,
  );
  const comments = `<?xml version="1.0" encoding="UTF-8"?>
    <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
      <w:comment w:id="90" w:author="批注者"><w:p w14:paraId="AAA00090"><w:r><w:t>脚注批注</w:t></w:r></w:p></w:comment>
      <w:comment w:id="91" w:author="批注者"><w:p w14:paraId="AAA00091"><w:r><w:t>未引用脚注批注</w:t></w:r></w:p></w:comment>
    </w:comments>`;
  const parsed = await parseDocx(
    await makeDocxFixture({
      "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
      "word/document.xml": wordDocumentXml(body),
      "word/footnotes.xml": footnotes.replace(
        "</w:footnotes>",
        '<w:footnote w:id="3"><w:p><w:commentRangeStart w:id="91"/><w:r><w:t>未引用脚注</w:t></w:r><w:commentRangeEnd w:id="91"/></w:p></w:footnote></w:footnotes>',
      ),
      "word/endnotes.xml": endnotes,
      "word/comments.xml": comments,
    }),
    undefined,
    parseOptions,
  );

  assert.match(parsed.canonicalMarkdown, /^正文\[1\]继续\[2\]/);
  assert.match(
    parsed.canonicalMarkdown,
    /---\n\n脚注（从 Word 导入）\n\n\[1\] 脚注正文\n\n\[2\] 尾注正文$/,
  );
  assert.equal(warningCount(parsed, "NOTES_FLATTENED_TO_APPENDIX"), 1);
  assert.equal(parsed.threads.length, 0);
  assert.deepEqual(
    parsed.skippedThreads.map((thread) => [thread.sourceCommentId, thread.warning.code]),
    [
      ["90", "ANNOTATION_NON_TEXT_RANGE"],
      ["91", "ANNOTATION_NON_TEXT_RANGE"],
    ],
  );
});

function tableXml(rows: string[]): string {
  return `<w:tbl>${rows.join("")}</w:tbl>`;
}

function rowXml(cells: string[], header = false): string {
  return `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.join("")}</w:tr>`;
}

function cellXml(first: string, second?: string, cellProperties = ""): string {
  return `<w:tc>${cellProperties ? `<w:tcPr>${cellProperties}</w:tcPr>` : ""}
    <w:p><w:r><w:t>${first}</w:t></w:r></w:p>
    ${second ? `<w:p><w:r><w:t>${second}</w:t></w:r></w:p>` : ""}
  </w:tc>`;
}

function formattedCellXml(): string {
  return `<w:tc>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>正文 A</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="rLink"><w:r><w:t>第二段</w:t></w:r></w:hyperlink></w:p>
  </w:tc>`;
}

function imageRelationship(id: string, target: string): string {
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`;
}

function drawingXml(
  relationshipId: string,
  floating: boolean,
  alt: { descr?: string; title?: string } = {},
): string {
  const attributes = [
    alt.descr ? `descr="${alt.descr}"` : "",
    alt.title ? `title="${alt.title}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<w:drawing><wp:${floating ? "anchor" : "inline"}>
    <wp:docPr ${attributes}/><a:graphic><pic:pic><pic:blipFill><a:blip r:embed="${relationshipId}"/></pic:blipFill></pic:pic></a:graphic>
  </wp:${floating ? "anchor" : "inline"}></w:drawing>`;
}

function notesXml(root: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <w:${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:${root}>`;
}

function warningCount(parsed: Awaited<ReturnType<typeof parseDocx>>, code: string): number {
  return parsed.warnings.find((warning) => warning.code === code)?.count ?? 0;
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}
