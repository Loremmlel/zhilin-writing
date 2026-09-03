import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAnnotationIds,
  hasAnnotationDirective,
  parseAnnotationMarkdown,
  visiblePostText,
} from "../lib/annotations/markdown.ts";
import { buildWordThreads, parseWordComments } from "../lib/docx-import/annotations.ts";
import { DOCX_IMPORT_LIMITS } from "../lib/docx-import/limits.ts";
import { parseDocx } from "../lib/docx-import/parse.ts";
import { DocxImportError } from "../lib/docx-import/types.ts";
import { parseOrderedXml } from "../lib/docx-import/xml.ts";
import { makeDocxFixture, MINIMAL_CONTENT_TYPES, wordDocumentXml } from "./helpers/docx-fixture.ts";

const parseOptions = {
  createAnnotationId: (sourceCommentId: string) =>
    `ann_00000000-0000-4000-8000-${sourceCommentId.padStart(12, "0")}`,
  createReplyId: (sourceCommentId: string) =>
    `00000000-0000-4000-9000-${sourceCommentId.padStart(12, "0")}`,
};

test("keeps adjacent UTF-16 ranges and greedily skips an intersecting candidate", async () => {
  const body = `<w:p>
    <w:commentRangeStart w:id="1"/><w:r><w:rPr><w:b/></w:rPr><w:t>中</w:t></w:r><w:r><w:t>😀</w:t></w:r><w:commentRangeEnd w:id="1"/>
    <w:commentRangeStart w:id="2"/><w:r><w:t>e\u0301</w:t></w:r><w:commentRangeEnd w:id="2"/>
    <w:commentRangeStart w:id="3"/><w:r><w:t>אב</w:t></w:r><w:commentRangeEnd w:id="3"/>
  </w:p>`;
  const parsed = await parseDocx(
    await commentFixture(
      body,
      [
        comment("1", "00000001", "甲", "J", "第一条"),
        comment("2", "00000002", "乙", "Y", "第二条"),
        comment("3", "00000003", "丙", "B", "第三条"),
      ].join(""),
      undefined,
      {
        documentTransform: (document) =>
          document
            .replace(
              '<w:commentRangeStart w:id="3"/>',
              '<w:commentRangeStart w:id="3"/><w:commentRangeStart w:id="4"/>',
            )
            .replace(
              '<w:commentRangeEnd w:id="3"/>',
              '<w:commentRangeEnd w:id="4"/><w:commentRangeEnd w:id="3"/>',
            ),
        extraComments: comment("4", "00000004", "丁", "D", "交叠条"),
      },
    ),
    undefined,
    parseOptions,
  );

  assert.deepEqual(
    parsed.threads.map((thread) => [
      thread.sourceCommentId,
      thread.blockLocalStart,
      thread.blockLocalEnd,
    ]),
    [
      ["1", 0, 3],
      ["2", 3, 5],
      ["3", 5, 7],
    ],
  );
  assert.deepEqual(
    parsed.skippedThreads.map((thread) => ({
      source: thread.sourceCommentId,
      code: thread.warning.code,
      conflict: thread.warning.payload?.conflictsWithSourceCommentId,
    })),
    [{ source: "4", code: "ANNOTATION_OVERLAP_SKIPPED", conflict: "3" }],
  );
  assert.match(
    parsed.canonicalMarkdown,
    /^:annotation\[\*\*中\*\*😀\]\{#ann_00000000-0000-4000-8000-000000000001\}:annotation\[é\]\{#ann_00000000-0000-4000-8000-000000000002\}:annotation\[אב\]\{#ann_00000000-0000-4000-8000-000000000003\}$/,
  );
  assert.deepEqual(collectAnnotationIds(parseAnnotationMarkdown(parsed.canonicalMarkdown)), [
    "ann_00000000-0000-4000-8000-000000000001",
    "ann_00000000-0000-4000-8000-000000000002",
    "ann_00000000-0000-4000-8000-000000000003",
  ]);
});

test("forms UTF-16 ranges from decoded predefined and numeric XML entities", async () => {
  const cases = [
    { id: "81", encoded: "A &amp; ", decoded: "A & ", start: 4 },
    { id: "82", encoded: "&lt;x&gt;", decoded: "<x>", start: 3 },
    { id: "83", encoded: "&#65;", decoded: "A", start: 1 },
    { id: "84", encoded: "&#x1F600;", decoded: "😀", start: 2 },
  ];

  for (const item of cases) {
    const parsed = await parseDocx(
      await commentFixture(
        `<w:p><w:r><w:t>${item.encoded}</w:t></w:r><w:commentRangeStart w:id="${item.id}"/><w:r><w:t>B</w:t></w:r><w:commentRangeEnd w:id="${item.id}"/></w:p>`,
        comment(item.id, `AAA000${item.id}`, "作者", "A", "实体后批注"),
      ),
      undefined,
      parseOptions,
    );
    const block = parsed.blocks[0]!;

    assert.equal(
      "segments" in block ? block.segments.map((segment) => segment.text).join("") : "",
      `${item.decoded}B`,
    );
    assert.deepEqual(
      [parsed.threads[0]?.blockLocalStart, parsed.threads[0]?.blockLocalEnd],
      [item.start, item.start + 1],
    );
  }
});

test("decodes XML entities in comment marker and attribution attributes", async () => {
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="&#49;"/><w:r><w:t>正文</w:t></w:r><w:commentRangeEnd w:id="&#49;"/></w:p>`,
      comment("1", "AAA00001", "A &amp; B", "AB", "属性实体"),
    ),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.skippedThreads.length, 0);
  assert.equal(parsed.threads[0]?.sourceCommentId, "1");
  assert.equal(parsed.threads[0]?.sourceAuthorName, "A & B");
});

test("accepts the longest nested range first and skips the inner thread", async () => {
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p>
    <w:commentRangeStart w:id="10"/><w:commentRangeStart w:id="11"/>
    <w:r><w:t>AB</w:t></w:r><w:commentRangeEnd w:id="11"/>
    <w:r><w:t>CD</w:t></w:r><w:commentRangeEnd w:id="10"/>
  </w:p>`,
      [
        comment("10", "00000010", "外", "O", "外层"),
        comment("11", "00000011", "内", "I", "内层"),
      ].join(""),
    ),
    undefined,
    parseOptions,
  );

  assert.deepEqual(
    parsed.threads.map((thread) => [
      thread.sourceCommentId,
      thread.blockLocalStart,
      thread.blockLocalEnd,
    ]),
    [["10", 0, 4]],
  );
  assert.equal(parsed.skippedThreads[0]?.sourceCommentId, "11");
  assert.equal(parsed.skippedThreads[0]?.warning.payload?.conflictsWithSourceCommentId, "10");
});

test("uses code-unit source IDs as the deterministic overlap tie-break", async () => {
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p>
    <w:commentRangeStart w:id="z"/><w:commentRangeStart w:id="ä"/>
    <w:r><w:t>同范围</w:t></w:r>
    <w:commentRangeEnd w:id="ä"/><w:commentRangeEnd w:id="z"/>
  </w:p>`,
      [
        comment("z", "AAA00091", "Z", "Z", "Z 批注"),
        comment("ä", "AAA00092", "A", "A", "A 批注"),
      ].join(""),
    ),
    undefined,
    {
      createAnnotationId: (sourceCommentId) =>
        sourceCommentId === "z"
          ? "ann_00000000-0000-4000-8000-000000000091"
          : "ann_00000000-0000-4000-8000-000000000092",
      createReplyId: parseOptions.createReplyId,
    },
  );

  assert.deepEqual(
    parsed.threads.map((thread) => thread.sourceCommentId),
    ["z"],
  );
  assert.equal(parsed.skippedThreads[0]?.sourceCommentId, "ä");
  assert.equal(parsed.skippedThreads[0]?.warning.payload?.conflictsWithSourceCommentId, "z");
});

test("preserves directive-shaped source text without creating nested directives", async () => {
  const literal = ":annotation[伪批注]{#ann_00000000-0000-4000-8000-000000000999}";
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="90"/><w:r><w:t>${literal}</w:t></w:r><w:commentRangeEnd w:id="90"/></w:p>`,
      comment("90", "AAA00090", "作者", "A", literal),
    ),
    undefined,
    parseOptions,
  );

  const markdownTree = parseAnnotationMarkdown(parsed.canonicalMarkdown);
  assert.deepEqual(collectAnnotationIds(markdownTree), [
    "ann_00000000-0000-4000-8000-000000000090",
  ]);
  assert.equal(visiblePostText(markdownTree), literal);
  const bodyTree = parseAnnotationMarkdown(parsed.threads[0]!.bodyMarkdown);
  assert.equal(hasAnnotationDirective(bodyTree), false);
  assert.equal(visiblePostText(bodyTree), literal);
});

test("preserves entity-shaped source and comment text through Markdown", async () => {
  const literal = "&copy;";
  const encoded = "&amp;copy;";
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="91"/><w:r><w:t>${encoded}</w:t></w:r><w:commentRangeEnd w:id="91"/></w:p>`,
      comment("91", "AAA00091", "作者", "A", encoded),
    ),
    undefined,
    parseOptions,
  );

  assert.equal(visiblePostText(parseAnnotationMarkdown(parsed.canonicalMarkdown)), literal);
  assert.equal(visiblePostText(parseAnnotationMarkdown(parsed.threads[0]!.bodyMarkdown)), literal);
});

test("builds immediate reply parents from the last comment paragraph and flattens without commentsExtended", () => {
  const definitions = commentsXml(`
    <w:comment w:id="20" w:author="根作者" w:initials="RA" w:date="2024-01-01T00:00:00Z">
      <w:p w14:paraId="OLD00020"><w:r><w:t>第一段</w:t></w:r></w:p>
      <w:p w14:paraId="AAA00020"><w:r><w:t>根批注</w:t></w:r></w:p>
    </w:comment>
    ${comment("22", "AAA00022", "回复二", "R2", "回复回复")}
    ${comment("21", "AAA00021", "回复一", "R1", "第一层回复")}`);
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00020" w15:done="1"/>
    <w15:commentEx w15:paraId="AAA00021" w15:paraIdParent="AAA00020" w15:done="0"/>
    <w15:commentEx w15:paraId="AAA00022" w15:paraIdParent="AAA00021" w15:done="1"/>`);

  const catalog = parseWordComments(
    xml(definitions, "comments"),
    xml(extended, "commentsExtended"),
  );
  const threaded = buildWordThreads(catalog);
  assert.deepEqual(
    threaded.map((thread) => ({
      root: thread.root.sourceCommentId,
      rootBody: thread.root.bodyMarkdown,
      resolved: thread.root.sourceResolved,
      replies: thread.replies.map((reply) => [
        reply.sourceCommentId,
        reply.parentSourceCommentId,
        reply.sourceResolved,
      ]),
    })),
    [
      {
        root: "20",
        rootBody: "第一段\n\n根批注",
        resolved: true,
        replies: [
          ["22", "21", true],
          ["21", "20", false],
        ],
      },
    ],
  );

  const flat = buildWordThreads(parseWordComments(xml(definitions, "comments"), undefined));
  assert.deepEqual(
    flat.map((thread) => [thread.root.sourceCommentId, thread.replies.length]),
    [
      ["20", 0],
      ["22", 0],
      ["21", 0],
    ],
  );
});

test("ignores empty annotation-reference replies emitted by Word", async () => {
  const definitions = `
    ${comment("60", "AAA00060", "根作者", "RA", "根批注")}
    <w:comment w:id="61" w:author="回复作者" w:date="2024-01-01T00:00:00Z">
      <w:p w14:paraId="AAA00061"><w:r><w:annotationRef/></w:r></w:p>
    </w:comment>`;
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00060"/>
    <w15:commentEx w15:paraId="AAA00061" w15:paraIdParent="AAA00060"/>`);
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="60"/><w:commentRangeStart w:id="61"/><w:r><w:t>锚点</w:t></w:r><w:commentRangeEnd w:id="60"/><w:commentRangeEnd w:id="61"/></w:p>`,
      definitions,
      extended,
    ),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.skippedThreads.length, 0);
  assert.deepEqual(
    parsed.threads.map((thread) => [thread.sourceCommentId, thread.replies.length]),
    [["60", 0]],
  );
});

test("enforces the combined root and reply definition limit before graph construction", () => {
  const catalogWith = (count: number) =>
    parseWordComments(
      xml(
        commentsXml(
          Array.from({ length: count }, (_, index) =>
            comment(String(index), String(index).padStart(8, "0"), "作者", "A", "正文"),
          ).join(""),
        ),
        "comments",
      ),
    );

  assert.equal(catalogWith(DOCX_IMPORT_LIMITS.commentsAndReplies).comments.length, 500);
  assert.throws(
    () => catalogWith(DOCX_IMPORT_LIMITS.commentsAndReplies + 1),
    (error: unknown) => error instanceof DocxImportError && error.code === "COMMENT_LIMIT",
  );
});

test("rejects duplicate source comment IDs before graph construction", () => {
  const definitions = commentsXml(
    [
      comment("85", "AAA00085", "作者一", "A1", "第一条"),
      comment("&#56;&#53;", "AAA00086", "作者二", "A2", "第二条"),
    ].join(""),
  );

  assert.throws(
    () => parseWordComments(xml(definitions, "comments")),
    (error: unknown) => error instanceof DocxImportError && error.code === "COMMENT_ID_DUPLICATE",
  );
});

test("marks missing-parent duplicate-paraId and cycle components as atomic invalid threads", () => {
  const definitions = commentsXml(
    [
      comment("30", "AAA00030", "缺父", "MP", "缺父"),
      comment("31", "DUP00031", "重复一", "D1", "重复一"),
      comment("32", "DUP00031", "重复二", "D2", "重复二"),
      comment("33", "AAA00033", "循环一", "C1", "循环一"),
      comment("34", "AAA00034", "循环二", "C2", "循环二"),
      comment("35", "AAA00035", "未绑定", "UB", "无 CommentEx"),
      comment("36", "AAA00036", "歧义子节点", "AC", "父 paraId 重复"),
    ].join(""),
  );
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00030" w15:paraIdParent="MISSING0"/>
    <w15:commentEx w15:paraId="DUP00031"/>
    <w15:commentEx w15:paraId="AAA00033" w15:paraIdParent="AAA00034"/>
    <w15:commentEx w15:paraId="AAA00034" w15:paraIdParent="AAA00033"/>
    <w15:commentEx w15:paraId="AAA00036" w15:paraIdParent="DUP00031"/>`);

  const threads = buildWordThreads(
    parseWordComments(xml(definitions, "comments"), xml(extended, "commentsExtended")),
  );
  assert.deepEqual(
    threads.map((thread) => [
      thread.root.sourceCommentId,
      thread.invalidReason,
      thread.replies.length,
    ]),
    [
      ["30", "MISSING_PARENT", 0],
      ["31", "DUPLICATE_PARA_ID", 2],
      ["33", "CYCLE", 1],
      ["35", "UNBOUND_COMMENT_EX", 0],
    ],
  );
});

test("connects every resolvable parent from conflicting duplicate CommentEx records", () => {
  const definitions = commentsXml(
    [
      comment("37", "AAA00037", "根一", "R1", "根一"),
      comment("38", "AAA00038", "根二", "R2", "根二"),
      comment("39", "AAA00039", "歧义回复", "AR", "歧义回复"),
    ].join(""),
  );
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00037"/>
    <w15:commentEx w15:paraId="AAA00038"/>
    <w15:commentEx w15:paraId="AAA00039" w15:paraIdParent="AAA00037"/>
    <w15:commentEx w15:paraId="AAA00039" w15:paraIdParent="AAA00038"/>`);

  const threads = buildWordThreads(
    parseWordComments(xml(definitions, "comments"), xml(extended, "commentsExtended")),
  );
  assert.deepEqual(
    threads.map((thread) => [
      thread.root.sourceCommentId,
      thread.invalidReason,
      thread.replies.map((reply) => reply.sourceCommentId),
    ]),
    [["37", "DUPLICATE_PARA_ID", ["38", "39"]]],
  );
});

test("imports resolved roots and immediate reply metadata through parseDocx", async () => {
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00060" w15:done="1"/>
    <w15:commentEx w15:paraId="AAA00061" w15:paraIdParent="AAA00060"/>`);
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="60"/><w:r><w:t>锚点</w:t></w:r><w:commentRangeEnd w:id="60"/></w:p>`,
      [
        comment("60", "AAA00060", "根作者", "RA", "根批注"),
        comment("61", "AAA00061", "回复作者", "RP", "回复正文"),
      ].join(""),
      extended,
    ),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.threads.length, 1);
  assert.equal(parsed.threads[0]?.sourceResolved, true);
  assert.deepEqual(
    parsed.threads[0]?.replies.map((reply) => ({
      id: reply.replyId,
      source: reply.sourceCommentId,
      parent: reply.parentSourceCommentId,
      body: reply.bodyMarkdown,
    })),
    [
      {
        id: "00000000-0000-4000-9000-000000000061",
        source: "61",
        parent: "60",
        body: "回复正文",
      },
    ],
  );
});

test("skips an invalid reply graph atomically and reports its reply count", async () => {
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00070" w15:paraIdParent="AAA00071"/>
    <w15:commentEx w15:paraId="AAA00071" w15:paraIdParent="AAA00070"/>`);
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="70"/><w:r><w:t>循环锚点</w:t></w:r><w:commentRangeEnd w:id="70"/></w:p>`,
      [
        comment("70", "AAA00070", "循环根", "C0", "根"),
        comment("71", "AAA00071", "循环回复", "C1", "回复"),
      ].join(""),
      extended,
    ),
    undefined,
    parseOptions,
  );

  assert.deepEqual(parsed.threads, []);
  assert.equal(parsed.skippedThreads[0]?.sourceCommentId, "70");
  assert.equal(parsed.skippedThreads[0]?.warning.code, "ANNOTATION_THREAD_SKIPPED");
  assert.equal(parsed.skippedThreads[0]?.warning.payload?.replyCount, 1);
  assert.equal(parsed.canonicalMarkdown, "循环锚点");
});

test("reports reply count when a valid thread is skipped for an illegal range", async () => {
  const extended = commentsExtendedXml(`
    <w15:commentEx w15:paraId="AAA00072"/>
    <w15:commentEx w15:paraId="AAA00073" w15:paraIdParent="AAA00072"/>`);
  const parsed = await parseDocx(
    await commentFixture(
      `<w:p><w:commentRangeStart w:id="72"/><w:commentRangeEnd w:id="72"/></w:p>`,
      [
        comment("72", "AAA00072", "根", "R", "空范围"),
        comment("73", "AAA00073", "回复", "RP", "回复"),
      ].join(""),
      extended,
    ),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.skippedThreads[0]?.warning.code, "ANNOTATION_EMPTY_RANGE");
  assert.equal(parsed.skippedThreads[0]?.warning.payload?.replyCount, 1);
});

test("accepts list-item and cross-block ranges while classifying unsupported ranges", async () => {
  const body = `
    <w:p><w:commentRangeStart w:id="40"/><w:commentRangeEnd w:id="40"/></w:p>
    <w:p><w:commentRangeStart w:id="41"/><w:r><w:t>跨</w:t></w:r></w:p>
    <w:p><w:r><w:t>段</w:t></w:r><w:commentRangeEnd w:id="41"/></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:commentRangeStart w:id="42"/><w:r><w:t>列表项</w:t></w:r><w:commentRangeEnd w:id="42"/></w:p>
    <w:p><w:commentRangeStart w:id="47"/><w:r><w:t>表前</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:commentRangeStart w:id="43"/><w:r><w:t>表格</w:t></w:r><w:commentRangeEnd w:id="43"/></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>表后</w:t></w:r><w:commentRangeEnd w:id="47"/></w:p>
    <w:p><w:r><w:drawing><w:commentRangeStart w:id="44"/><w:t>图</w:t><w:commentRangeEnd w:id="44"/></w:drawing></w:r></w:p>
    <w:p><w:commentRangeStart w:id="45"/><w:r><w:t>缺定义</w:t></w:r><w:commentRangeEnd w:id="45"/></w:p>
    <w:p><w:commentRangeStart w:id="46"/><w:r><w:t>普通</w:t></w:r><w:commentRangeEnd w:id="46"/><w:r><w:rPr><w:rStyle w:val="CodeChar"/></w:rPr><w:t>代码</w:t></w:r></w:p>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8"?>
    <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="17"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
      <w:num w:numId="7"><w:abstractNumId w:val="17"/></w:num>
    </w:numbering>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/></w:style>
    </w:styles>`;
  const parsed = await parseDocx(
    await commentFixture(
      body,
      [
        comment("40", "AAA00040", "空", "E", "空范围"),
        comment("41", "AAA00041", "跨", "X", "跨段"),
        comment("42", "AAA00042", "列", "L", "列表"),
        comment("43", "AAA00043", "表", "T", "表格"),
        comment("44", "AAA00044", "图", "I", "图片"),
        comment("46", "AAA00046", "码", "C", "含代码块"),
        comment("47", "AAA00047", "障", "B", "跨表格"),
      ].join(""),
      undefined,
      {
        extraParts: {
          "word/numbering.xml": numbering,
          "word/styles.xml": styles,
        },
      },
    ),
    undefined,
    parseOptions,
  );

  assert.equal(parsed.threads.length, 2);
  const crossBlock = parsed.threads.find((thread) => thread.sourceCommentId === "41");
  assert.ok(crossBlock?.endBlockId);
  assert.equal(crossBlock?.blockLocalStart, 0);
  assert.equal(crossBlock?.blockLocalEnd, 1);
  const listThread = parsed.threads.find((thread) => thread.sourceCommentId === "42");
  assert.match(listThread?.blockId ?? "", /_item_1$/);
  assert.equal(
    parsed.canonicalMarkdown.match(/ann_00000000-0000-4000-8000-000000000041/g)?.length,
    2,
  );
  assert.match(parsed.canonicalMarkdown, /- :annotation\[列表项\]/);

  const skipped = Object.fromEntries(
    parsed.skippedThreads.map((thread) => [thread.sourceCommentId, thread.warning.code]),
  );
  assert.deepEqual(skipped, {
    40: "ANNOTATION_EMPTY_RANGE",
    43: "ANNOTATION_TABLE_UNSUPPORTED",
    44: "ANNOTATION_NON_TEXT_RANGE",
    45: "ANNOTATION_ORPHAN_DEFINITION",
    46: "ANNOTATION_NON_TEXT_RANGE",
    47: "ANNOTATION_TABLE_UNSUPPORTED",
  });
});

function xml(value: string, part: string) {
  return parseOrderedXml(value, `word/${part}.xml`);
}

function commentsXml(definitions: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
      ${definitions}
    </w:comments>`;
}

function commentsExtendedXml(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
      ${entries}
    </w15:commentsEx>`;
}

function comment(
  id: string,
  paraId: string,
  author: string,
  initials: string,
  body: string,
): string {
  return `<w:comment w:id="${id}" w:author="${author}" w:initials="${initials}" w:date="2024-01-01T00:00:00Z">
    <w:p w14:paraId="${paraId}"><w:r><w:t>${body}</w:t></w:r></w:p>
  </w:comment>`;
}

async function commentFixture(
  body: string,
  definitions: string,
  extended?: string,
  options: {
    documentTransform?: (document: string) => string;
    extraComments?: string;
    extraParts?: Record<string, string>;
  } = {},
): Promise<File> {
  const document = wordDocumentXml(body);
  return makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": options.documentTransform?.(document) ?? document,
    "word/comments.xml": commentsXml(definitions + (options.extraComments ?? "")),
    ...(extended ? { "word/commentsExtended.xml": extended } : {}),
    ...options.extraParts,
  });
}
