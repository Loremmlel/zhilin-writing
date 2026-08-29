import assert from "node:assert/strict";
import test from "node:test";

import { parseAnnotationMarkdown, visiblePostText } from "../lib/annotations/markdown.ts";
import { DOCX_IMPORT_LIMITS } from "../lib/docx-import/limits.ts";
import { renderCanonicalImportMarkdown } from "../lib/docx-import/markdown.ts";
import { parseDocx } from "../lib/docx-import/parse.ts";
import {
  DocxImportError,
  type ImportBlock,
  type ImportWarningCode,
  type ListBlock,
} from "../lib/docx-import/types.ts";
import {
  documentRelationshipsXml,
  makeDocxFixture,
  MINIMAL_CONTENT_TYPES,
  wordDocumentXml,
} from "./helpers/docx-fixture.ts";

test("uses semantic styles and accepted revision text without visual guessing", async () => {
  const parsed = await parseDocx(await semanticBodyFixture());

  assert.equal(parsed.suggestedTitle, "一级标题");
  assert.match(parsed.canonicalMarkdown, /^# 一级标题/m);
  assert.match(parsed.canonicalMarkdown, /^#### 五级标题/m);
  assert.match(parsed.canonicalMarkdown, /^> 明确引用/m);
  assert.match(parsed.canonicalMarkdown, /\*\*粗体\*\* \*斜体\* ~~删除线~~ `代码字符样式`/);
  assert.match(parsed.canonicalMarkdown, /\*\*继承粗体\*\*/);
  assert.match(parsed.canonicalMarkdown, /\\\*只是字面星号\\\*/);
  assert.match(parsed.canonicalMarkdown, /\[安全链接\]\(https:\/\/example\.com\/path\?q=1\)/);
  assert.match(parsed.canonicalMarkdown, /不安全链接/);
  assert.doesNotMatch(parsed.canonicalMarkdown, /javascript:/i);
  assert.match(parsed.canonicalMarkdown, /保留的插入.*保留的移动/);
  assert.doesNotMatch(parsed.canonicalMarkdown, /已删除修订|已移走文本/);
  assert.match(parsed.canonicalMarkdown, /缓存作者/);
  assert.doesNotMatch(parsed.canonicalMarkdown, /AUTHOR|目录缓存|TOC 1-3/);
  assert.match(parsed.canonicalMarkdown, /e\u0301 保持分解/);

  const annotatedSegment = parsed.blocks
    .flatMap((block) => "segments" in block ? block.segments : [])
    .find((segment) => segment.text === "批注范围");
  assert.deepEqual(annotatedSegment?.commentIds, ["7"]);

  assert.deepEqual(warningCodes(parsed.warnings), [
    "HEADING_LEVEL_CLAMPED",
    "VISUAL_FORMATTING_DROPPED",
    "HYPERLINK_UNSAFE_DROPPED",
    "TRACK_CHANGES_FLATTENED",
    "TOC_SKIPPED",
  ]);
  assert.deepEqual(parsed.assets, []);
  assert.deepEqual(parsed.threads, []);
  assert.deepEqual(parsed.skippedThreads, []);
});

test("resolves bullet numeric alphabetic and roman list levels with a three-level clamp", async () => {
  const cases = [
    { format: "bullet", level: 0, ordered: false, depth: 0 },
    { format: "decimal", level: 1, ordered: true, depth: 1 },
    { format: "lowerLetter", level: 2, ordered: true, depth: 2 },
    { format: "upperRoman", level: 3, ordered: true, depth: 2 },
  ] as const;

  for (const fixture of cases) {
    const parsed = await parseDocx(await listFixture(fixture.format, fixture.level));
    const list = parsed.blocks.find((block): block is ListBlock => block.type === "list");
    assert.ok(list, fixture.format);
    assert.equal(list.ordered, fixture.ordered, fixture.format);
    assert.equal(list.depth, fixture.depth, fixture.format);
    assert.equal(list.items[0]?.segments[0]?.text, `${fixture.format}-${fixture.level}`);
    assert.equal(
      parsed.warnings.find((warning) => warning.code === "LIST_DEPTH_CLAMPED")?.count ?? 0,
      fixture.level === 3 ? 1 : 0,
      fixture.format,
    );
  }
});

test("resolves list numbering inherited through a cycle-safe paragraph style chain", async () => {
  const parsed = await parseDocx(await styleListAndCycleFixture());
  const list = parsed.blocks.find((block): block is ListBlock => block.type === "list");
  assert.ok(list);
  assert.equal(list.ordered, false);
  assert.equal(list.items[0]?.segments[0]?.text, "样式列表");
  assert.match(parsed.canonicalMarkdown, /循环样式仍是正文/);
});

test("groups adjacent list items only when their numbering semantics match", async () => {
  const parsed = await parseDocx(await adjacentListFixture());
  const lists = parsed.blocks.filter((block): block is ListBlock => block.type === "list");

  assert.equal(lists.length, 2);
  assert.deepEqual(
    lists.map((list) => list.items.map((item) => item.segments.map((segment) => segment.text).join(""))),
    [["第一项", "第二项"], ["新的列表"]],
  );
  assert.match(parsed.canonicalMarkdown, /^- 第一项\n- 第二项\n\n- 新的列表$/);
});

test("canonical Markdown escapes literal syntax without normalizing Unicode", () => {
  const text = "*字面* [括号] \\ e\u0301\n# 非标题\n- 非列表\n> 非引用";
  const markdown = renderCanonicalImportMarkdown([
    paragraph("block_1", text),
  ], [], []);
  assert.equal(
    markdown,
    "\\*字面\\* \\[括号\\] \\\\ e\u0301\n\\# 非标题\n\\- 非列表\n\\> 非引用",
  );
  assert.equal(
    visiblePostText(parseAnnotationMarkdown(markdown)),
    text.replace(/\s+/g, " "),
  );
});

test("canonical Markdown enforces the UTF-8 byte limit", () => {
  assert.throws(
    () => renderCanonicalImportMarkdown([
      paragraph("block_large", "a".repeat(DOCX_IMPORT_LIMITS.markdownUtf8Bytes + 1)),
    ], [], []),
    (error: unknown) => error instanceof DocxImportError && error.code === "MARKDOWN_SIZE_LIMIT",
  );
});

function warningCodes(warnings: Array<{ code: ImportWarningCode }>): ImportWarningCode[] {
  return warnings.map((warning) => warning.code);
}

function paragraph(id: string, text: string): ImportBlock {
  return {
    type: "paragraph",
    id,
    segments: [{ text, marks: [], commentIds: [] }],
  };
}

async function semanticBodyFixture(): Promise<File> {
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="DerivedHeading"><w:basedOn w:val="Heading1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="Heading 5"/><w:pPr><w:outlineLvl w:val="4"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>
  <w:style w:type="paragraph" w:styleId="QuoteChild"><w:basedOn w:val="Quote"/></w:style>
  <w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/></w:style>
  <w:style w:type="character" w:styleId="CodeChild"><w:basedOn w:val="CodeChar"/></w:style>
  <w:style w:type="character" w:styleId="BoldVisual"><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr></w:style>
</w:styles>`;
  const numbering = numberingXml("bullet", 0, "42", "8");
  const relationships = documentRelationshipsXml(`
    <Relationship Id="rIdSafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/path?q=1" TargetMode="External"/>
    <Relationship Id="rIdUnsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`);
  const body = `
    <w:p><w:pPr><w:pStyle w:val="DerivedHeading"/></w:pPr><w:r><w:t>一级标题</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading5"/></w:pPr><w:r><w:t>五级标题</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="QuoteChild"/></w:pPr><w:r><w:t>明确引用</w:t></w:r></w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:strike/></w:rPr><w:t>删除线</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:rStyle w:val="CodeChild"/></w:rPr><w:t>代码字符样式</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:rStyle w:val="BoldVisual"/></w:rPr><w:t>继承粗体</w:t></w:r>
      <w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve"> *只是字面星号*</w:t></w:r>
    </w:p>
    <w:p><w:hyperlink r:id="rIdSafe"><w:r><w:t>安全链接</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:hyperlink r:id="rIdUnsafe"><w:r><w:t>不安全链接</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:ins><w:r><w:t>保留的插入</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:del><w:r><w:delText>已删除修订</w:delText></w:r></w:del><w:moveTo><w:r><w:t>保留的移动</w:t></w:r></w:moveTo><w:moveFrom><w:r><w:delText>已移走文本</w:delText></w:r></w:moveFrom></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> AUTHOR </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>缓存作者</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:p><w:fldSimple w:instr="TOC \\o &quot;1-3&quot;"><w:r><w:t>目录缓存</w:t></w:r></w:fldSimple></w:p>
    <w:p><w:r><w:t>e\u0301 保持分解</w:t></w:r></w:p>
    <w:p><w:commentRangeStart w:id="7"/><w:r><w:t>批注范围</w:t></w:r><w:commentRangeEnd w:id="7"/></w:p>
    <w:p><w:pPr><w:pStyle w:val="DerivedHeading"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="42"/></w:numPr></w:pPr><w:r><w:t>显式列表优先</w:t></w:r></w:p>`;

  return makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": wordDocumentXml(body),
    "word/styles.xml": styles,
    "word/numbering.xml": numbering,
    "word/_rels/document.xml.rels": relationships,
  });
}

async function listFixture(format: string, level: number): Promise<File> {
  return makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": wordDocumentXml(`
      <w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="9"/></w:numPr></w:pPr><w:r><w:t>${format}-${level}</w:t></w:r></w:p>`),
    "word/numbering.xml": numberingXml(format, level, "9", "19"),
  });
}

async function styleListAndCycleFixture(): Promise<File> {
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="ListBase"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListChild"><w:basedOn w:val="ListBase"/></w:style>
  <w:style w:type="paragraph" w:styleId="CycleA"><w:basedOn w:val="CycleB"/></w:style>
  <w:style w:type="paragraph" w:styleId="CycleB"><w:basedOn w:val="CycleA"/></w:style>
</w:styles>`;
  return makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": wordDocumentXml(`
      <w:p><w:pPr><w:pStyle w:val="ListChild"/></w:pPr><w:r><w:t>样式列表</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="CycleA"/></w:pPr><w:r><w:t>循环样式仍是正文</w:t></w:r></w:p>`),
    "word/styles.xml": styles,
    "word/numbering.xml": numberingXml("bullet", 0, "5", "15"),
  });
}

async function adjacentListFixture(): Promise<File> {
  return makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": wordDocumentXml(`
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>第一项</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>第二项</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>新的列表</w:t></w:r></w:p>`),
    "word/numbering.xml": `<?xml version="1.0" encoding="UTF-8"?>
      <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="11"/></w:num>
        <w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num>
      </w:numbering>`,
  });
}

function numberingXml(format: string, level: number, numId: string, abstractNumId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="${abstractNumId}"><w:lvl w:ilvl="${level}"><w:numFmt w:val="${format}"/></w:lvl></w:abstractNum>
  <w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractNumId}"/></w:num>
</w:numbering>`;
}
