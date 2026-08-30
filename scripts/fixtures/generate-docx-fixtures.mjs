import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

const FIXED_ZIP_DATE = new Date("2000-01-01T00:00:00.000Z");
const GENERATED_DIRECTORY = resolve("tests/fixtures/docx/generated");

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>
</Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rIdCommentsExtended" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>
</Relationships>`;

const EMPTY_COMMENTS_EXTENDED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>`;

function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`;
}

function commentsXml(comments) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
${comments}
</w:comments>`;
}

function comment(id, paraId, author, initials, text) {
  return `  <w:comment w:id="${id}" w:author="${author}" w:initials="${initials}" w:date="2024-01-0${Number(id) % 9 + 1}T00:00:00Z">
    <w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:comment>`;
}

function commonParts(document, comments, commentsExtended = EMPTY_COMMENTS_EXTENDED) {
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": PACKAGE_RELS,
    "word/_rels/document.xml.rels": DOCUMENT_RELS,
    "word/comments.xml": comments,
    "word/commentsExtended.xml": commentsExtended,
    "word/document.xml": document,
  };
}

export async function writeDocxFixture(path, parts) {
  const bytes = await createDocxFixtureBytes(parts);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function createDocxFixtureBytes(parts) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  for (const name of Object.keys(parts).sort()) {
    const value = parts[name];
    await writer.add(name, typeof value === "string" ? new TextReader(value) : new Uint8ArrayReader(value), {
      dataDescriptor: false,
      lastModDate: FIXED_ZIP_DATE,
      level: 0,
      useWebWorkers: false,
    });
  }
  return writer.close();
}

export async function generateProbeFixtures(directory = GENERATED_DIRECTORY) {
  const fixtures = await generatedFixtureBytes();
  await mkdir(directory, { recursive: true });
  await Promise.all([...fixtures].map(([filename, bytes]) => writeFile(resolve(directory, filename), bytes)));
}

export async function checkGeneratedFixtures(directory = GENERATED_DIRECTORY) {
  const fixtures = await generatedFixtureBytes();
  for (const [filename, expected] of fixtures) {
    const actual = await readFile(resolve(directory, filename));
    if (!equalBytes(actual, expected)) throw new Error(`${filename} is not byte-for-byte current; regenerate fixtures`);
  }
  process.stdout.write(`verified ${fixtures.size} generated DOCX fixtures\n`);
}

async function generatedFixtureBytes() {
  const adjacentDocument = documentXml(`<w:p>
    <w:r><w:t>before </w:t></w:r>
    <w:commentRangeStart w:id="0"/><w:r><w:t>alpha</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>
    <w:commentRangeStart w:id="1"/><w:r><w:t>beta</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>
    <w:r><w:t> after</w:t></w:r>
  </w:p>`);
  const adjacentComments = commentsXml([
    comment("0", "000000A0", "Adjacent A", "AA", "alpha comment"),
    comment("1", "000000A1", "Adjacent B", "AB", "beta comment"),
  ].join("\n"));
  const overlapDocument = documentXml(`<w:p>
    <w:commentRangeStart w:id="10"/><w:r><w:t>A</w:t></w:r>
    <w:commentRangeStart w:id="11"/><w:r><w:t>B</w:t></w:r>
    <w:commentRangeStart w:id="12"/><w:r><w:t>C</w:t></w:r><w:commentRangeEnd w:id="11"/><w:r><w:commentReference w:id="11"/></w:r>
    <w:r><w:t>D</w:t></w:r><w:commentRangeEnd w:id="12"/><w:r><w:commentReference w:id="12"/></w:r>
    <w:r><w:t>E</w:t></w:r><w:commentRangeEnd w:id="10"/><w:r><w:commentReference w:id="10"/></w:r>
  </w:p>`);
  const overlapComments = commentsXml([
    comment("10", "000000B0", "Outer", "O", "outer comment"),
    comment("11", "000000B1", "Cross A", "CA", "crossing comment A"),
    comment("12", "000000B2", "Cross B", "CB", "crossing comment B"),
  ].join("\n"));
  const threadedDocument = documentXml(`<w:p>
    <w:r><w:t>thread </w:t></w:r><w:commentRangeStart w:id="20"/><w:r><w:t>anchor</w:t></w:r><w:commentRangeEnd w:id="20"/><w:r><w:commentReference w:id="20"/></w:r>
  </w:p>`);
  const threadedComments = commentsXml([
    comment("20", "AAA00020", "Root Author", "RA", "root comment"),
    comment("21", "AAA00021", "Reply Author", "RP", "reply comment"),
  ].join("\n"));
  const threadedExtended = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
  <w15:commentEx w15:paraId="AAA00020" w15:done="1"/>
  <w15:commentEx w15:paraId="AAA00021" w15:paraIdParent="AAA00020" w15:done="0"/>
</w15:commentsEx>`;
  const parts = new Map([
    ["probe-adjacent.docx", commonParts(adjacentDocument, adjacentComments)],
    ["probe-overlap-nested.docx", commonParts(overlapDocument, overlapComments)],
    ["probe-threaded-resolved.docx", commonParts(threadedDocument, threadedComments, threadedExtended)],
    ["semantic-matrix.docx", semanticMatrixParts()],
  ]);
  return new Map(await Promise.all([...parts].map(async ([filename, fixtureParts]) => [
    filename,
    await createDocxFixtureBytes(fixtureParts),
  ])));
}

function semanticMatrixParts() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>
</Types>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${Array.from({ length: 9 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="Heading ${index + 1}"/><w:pPr><w:outlineLvl w:val="${index}"/></w:pPr></w:style>`).join("\n  ")}
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>
  <w:style w:type="paragraph" w:styleId="IntenseQuote"><w:name w:val="Intense Quote"/></w:style>
  <w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/></w:style>
  <w:style w:type="character" w:styleId="CodeChild"><w:basedOn w:val="CodeChar"/></w:style>
  <w:style w:type="character" w:styleId="StrongBase"><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="StrongChild"><w:basedOn w:val="StrongBase"/></w:style>
  <w:style w:type="character" w:styleId="VisualOnly"><w:name w:val="Visual Only"/><w:rPr><w:u w:val="single"/><w:color w:val="FF0000"/></w:rPr></w:style>
</w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl>
    <w:lvl w:ilvl="2"><w:numFmt w:val="lowerLetter"/></w:lvl>
    <w:lvl w:ilvl="3"><w:numFmt w:val="upperRoman"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rCommentsExtended" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>
  <Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
  <Relationship Id="rEndnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>
  <Relationship Id="rSafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/safe?q=1" TargetMode="External"/>
  <Relationship Id="rUnsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
  <Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/matrix.png"/>
</Relationships>`;
  const comments = commentsXml([
    semanticComment("1", "AAA00001", "甲", "J", "相邻一"),
    semanticComment("2", "AAA00002", "乙", "Y", "相邻二"),
    semanticComment("3", "AAA00003", "丙", "B", "相邻三"),
    semanticComment("4", "AAA00004", "外层", "O", "外层批注"),
    semanticComment("5", "AAA00005", "内层", "I", "内层批注"),
    semanticComment("10", "AAA00010", "根作者", "RA", "根批注"),
    semanticComment("11", "AAA00011", "回复作者", "RP", "回复正文"),
    semanticComment("20", "AAA00020", "空范围", "E", "空范围批注"),
    semanticComment("21", "AAA00021", "跨段", "X", "跨段批注"),
    semanticComment("22", "AAA00022", "表格", "T", "表格批注"),
    semanticComment("24", "AAA00024", "图片", "P", "图片批注"),
    semanticComment("25", "AAA00025", "列表", "L", "列表批注"),
    semanticComment("26", "AAA00026", "无扩展", "U", "缺少扩展记录"),
    semanticComment("30", "AAA00030", "循环根", "C0", "循环根批注"),
    semanticComment("31", "AAA00031", "循环回复", "C1", "循环回复"),
  ].join("\n"));
  const extendedRoots = ["1", "2", "3", "4", "5", "20", "21", "22", "24", "25"]
    .map((id) => `  <w15:commentEx w15:paraId="AAA000${id.padStart(2, "0")}"/>`).join("\n");
  const commentsExtended = `<?xml version="1.0" encoding="UTF-8"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
${extendedRoots}
  <w15:commentEx w15:paraId="AAA00010" w15:done="1"/>
  <w15:commentEx w15:paraId="AAA00011" w15:paraIdParent="AAA00010"/>
  <w15:commentEx w15:paraId="AAA00030" w15:paraIdParent="AAA00031"/>
  <w15:commentEx w15:paraId="AAA00031" w15:paraIdParent="AAA00030"/>
</w15:commentsEx>`;
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    ${["一", "二", "三", "四", "五", "六", "七", "八", "九"].map((label, index) => `<w:p><w:pPr><w:pStyle w:val="Heading${index + 1}"/></w:pPr><w:r><w:t>${label}级标题</w:t></w:r></w:p>`).join("\n    ")}
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:strike/></w:rPr><w:t>删除线</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:rStyle w:val="CodeChild"/></w:rPr><w:t>代码样式</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:rStyle w:val="StrongChild"/></w:rPr><w:t>继承粗体</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:rPr><w:rStyle w:val="VisualOnly"/></w:rPr><w:t>非代码样式</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>普通引用</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="IntenseQuote"/></w:pPr><w:r><w:t>强调引用</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="rSafe"><w:r><w:t>安全链接</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:hyperlink r:id="rUnsafe"><w:r><w:t>不安全链接</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> AUTHOR </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>缓存字段</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:p><w:fldSimple w:instr="TOC \\o &quot;1-3&quot;"><w:r><w:t>目录缓存</w:t></w:r></w:fldSimple></w:p>
    <w:p><w:ins><w:r><w:t>保留插入</w:t></w:r></w:ins><w:del><w:r><w:delText>删除修订</w:delText></w:r></w:del><w:moveTo><w:r><w:t>保留移动</w:t></w:r></w:moveTo></w:p>
    ${[0, 1, 2, 3].map((level) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表层级${level + 1}</w:t></w:r></w:p>`).join("\n")}
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:commentRangeStart w:id="25"/><w:r><w:t>列表批注锚点</w:t></w:r><w:commentRangeEnd w:id="25"/></w:p>
    ${semanticTable(true)}
    ${semanticTable(false)}
    <w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并单元格</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>尾格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r>${semanticDrawing(false)}</w:r></w:p>
    <w:p><w:r>${semanticDrawing(true)}</w:r></w:p>
    <w:p><w:r><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>文本框一</w:t></w:r></w:p><w:p><w:r><w:t>文本框二</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></w:r></w:p>
    <w:p><m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></w:p>
    <w:p><w:r><w:t>脚注</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t>尾注</w:t></w:r><w:r><w:endnoteReference w:id="5"/></w:r></w:p>
    <w:p><w:commentRangeStart w:id="1"/><w:r><w:rPr><w:b/></w:rPr><w:t>中</w:t></w:r><w:r><w:t>😀</w:t></w:r><w:commentRangeEnd w:id="1"/><w:commentRangeStart w:id="2"/><w:r><w:t>é</w:t></w:r><w:commentRangeEnd w:id="2"/><w:commentRangeStart w:id="3"/><w:r><w:t>אב</w:t></w:r><w:commentRangeEnd w:id="3"/></w:p>
    <w:p><w:commentRangeStart w:id="4"/><w:commentRangeStart w:id="5"/><w:r><w:t>AB</w:t></w:r><w:commentRangeEnd w:id="5"/><w:r><w:t>CD</w:t></w:r><w:commentRangeEnd w:id="4"/></w:p>
    <w:p><w:commentRangeStart w:id="10"/><w:r><w:t>线程锚点</w:t></w:r><w:commentRangeEnd w:id="10"/></w:p>
    <w:p><w:commentRangeStart w:id="20"/><w:commentRangeEnd w:id="20"/></w:p>
    <w:p><w:commentRangeStart w:id="21"/><w:r><w:t>跨</w:t></w:r></w:p><w:p><w:r><w:t>段</w:t></w:r><w:commentRangeEnd w:id="21"/></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:commentRangeStart w:id="22"/><w:r><w:t>表格批注</w:t></w:r><w:commentRangeEnd w:id="22"/></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:commentRangeStart w:id="23"/><w:r><w:t>孤儿定义</w:t></w:r><w:commentRangeEnd w:id="23"/></w:p>
    <w:p><w:commentRangeStart w:id="24"/><w:r>${semanticDrawing(false)}</w:r><w:commentRangeEnd w:id="24"/></w:p>
    <w:p><w:commentRangeStart w:id="26"/><w:r><w:t>缺少扩展</w:t></w:r><w:commentRangeEnd w:id="26"/></w:p>
    <w:p><w:commentRangeStart w:id="30"/><w:r><w:t>循环线程</w:t></w:r><w:commentRangeEnd w:id="30"/></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
  return {
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": PACKAGE_RELS,
    "word/_rels/document.xml.rels": documentRelationships,
    "word/comments.xml": comments,
    "word/commentsExtended.xml": commentsExtended,
    "word/document.xml": document,
    "word/endnotes.xml": semanticNotes("endnotes", "endnote", "5", "尾注正文"),
    "word/footnotes.xml": semanticNotes("footnotes", "footnote", "2", "脚注正文"),
    "word/media/matrix.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "word/numbering.xml": numbering,
    "word/styles.xml": styles,
  };
}

function semanticComment(id, paraId, author, initials, text) {
  return `  <w:comment w:id="${id}" w:author="${author}" w:initials="${initials}" w:date="2024-02-01T00:00:00Z"><w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
}

function semanticTable(header) {
  return `<w:tbl><w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}<w:tc><w:p><w:r><w:t>${header ? "表头甲" : "无表头甲"}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${header ? "表头乙" : "无表头乙"}</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>单元格甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单元格乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
}

function semanticDrawing(floating) {
  const container = floating ? "anchor" : "inline";
  return `<w:drawing><wp:${container}><wp:docPr descr="语义矩阵图片"/><a:graphic><pic:pic><pic:blipFill><a:blip r:embed="rImage"/></pic:blipFill></pic:pic></a:graphic></wp:${container}></w:drawing>`;
}

function semanticNotes(root, item, id, text) {
  return `<?xml version="1.0" encoding="UTF-8"?><w:${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:${item} w:id="${id}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${item}></w:${root}>`;
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--check")) {
    throw new Error("Usage: node scripts/fixtures/generate-docx-fixtures.mjs [--check]");
  }
  if (process.argv[2] === "--check") await checkGeneratedFixtures();
  else await generateProbeFixtures();
}
