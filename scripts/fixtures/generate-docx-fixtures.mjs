import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

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
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  for (const name of Object.keys(parts).sort()) {
    await writer.add(name, new TextReader(parts[name]), {
      dataDescriptor: false,
      lastModDate: FIXED_ZIP_DATE,
      level: 0,
      useWebWorkers: false,
    });
  }
  const bytes = await writer.close();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function generateProbeFixtures(directory = GENERATED_DIRECTORY) {
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

  await Promise.all([
    writeDocxFixture(resolve(directory, "probe-adjacent.docx"), commonParts(adjacentDocument, adjacentComments)),
    writeDocxFixture(resolve(directory, "probe-overlap-nested.docx"), commonParts(overlapDocument, overlapComments)),
    writeDocxFixture(resolve(directory, "probe-threaded-resolved.docx"), commonParts(threadedDocument, threadedComments, threadedExtended)),
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateProbeFixtures();
}
