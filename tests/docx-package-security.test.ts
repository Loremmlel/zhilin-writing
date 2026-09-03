import assert from "node:assert/strict";
import test from "node:test";

import { DOCX_IMPORT_LIMITS } from "../lib/docx-import/limits.ts";
import { DocxImportError, type DocxImportErrorCode } from "../lib/docx-import/types.ts";
import { openDocxPackage, type DocxPackageReader } from "../lib/docx-import/package.ts";
import {
  parseOrderedXml,
  xmlAttr,
  xmlChild,
  xmlChildren,
  xmlText,
} from "../lib/docx-import/xml.ts";
import {
  makeDocxFixture,
  makeHighlyCompressibleDocx,
  MINIMAL_CONTENT_TYPES,
  MINIMAL_DOCUMENT,
  replaceZipEntryName,
  type DocxFixtureEntry,
} from "./helpers/docx-fixture.ts";

const OLE_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

async function expectImportError(
  operation: () => unknown | Promise<unknown>,
  code: DocxImportErrorCode,
): Promise<void> {
  await assert.rejects(Promise.resolve().then(operation), (error: unknown) => {
    assert.ok(error instanceof DocxImportError);
    assert.equal(error.code, code);
    return true;
  });
}

async function openAndReadMainDocument(file: File): Promise<string> {
  let pkg: DocxPackageReader | undefined;
  try {
    pkg = await openDocxPackage(file);
    return await pkg.readText("word/document.xml");
  } finally {
    await pkg?.close();
  }
}

test("opens a minimum DOCX and exposes bounded package reads", async () => {
  const pkg = await openDocxPackage(await makeDocxFixture());
  try {
    assert.equal(pkg.has("[Content_Types].xml"), true);
    assert.equal(pkg.has("word/document.xml"), true);
    assert.deepEqual(
      pkg.entries.map((entry) => entry.path),
      ["[Content_Types].xml", "word/document.xml"],
    );
    assert.equal(await pkg.readText("word/document.xml"), MINIMAL_DOCUMENT);
    assert.deepEqual(
      await pkg.readBytes("[Content_Types].xml"),
      new TextEncoder().encode(MINIMAL_CONTENT_TYPES),
    );
  } finally {
    await pkg.close();
  }
  await expectImportError(() => pkg.readText("word/document.xml"), "PACKAGE_CLOSED");
});

test("allows explicit safe directory entries used by some DOCX producers", async () => {
  const pkg = await openDocxPackage(
    await makeDocxFixture(
      {},
      {
        entries: [
          { name: "[Content_Types].xml", value: MINIMAL_CONTENT_TYPES },
          { name: "word/", value: "" },
          { name: "word/document.xml", value: MINIMAL_DOCUMENT },
        ],
      },
    ),
  );
  try {
    assert.equal(pkg.has("word/document.xml"), true);
    assert.equal(pkg.has("word/"), false);
  } finally {
    await pkg.close();
  }
});

test("requires a .docx filename before opening package bytes", async () => {
  await expectImportError(
    async () => openDocxPackage(await makeDocxFixture(undefined, { filename: "fixture.zip" })),
    "INVALID_EXTENSION",
  );
});

test("rejects the compressed DOCX size limit before ZIP parsing", async () => {
  const file = new File([new Uint8Array(DOCX_IMPORT_LIMITS.compressedBytes + 1)], "oversized.docx");
  await expectImportError(() => openDocxPackage(file), "FILE_SIZE_LIMIT");
});

test("distinguishes legacy or protected OLE documents from invalid ZIP files", async () => {
  await expectImportError(
    () => openDocxPackage(new File([OLE_MAGIC], "legacy.docx")),
    "OLE_DOCUMENT_UNSUPPORTED",
  );
  await expectImportError(
    () => openDocxPackage(new File([new Uint8Array([1, 2, 3, 4])], "invalid.docx")),
    "ZIP_SIGNATURE_INVALID",
  );
});

test("requires the DOCX package content-types and main-document parts", async () => {
  await expectImportError(
    async () => openDocxPackage(await makeDocxFixture({ "word/document.xml": MINIMAL_DOCUMENT })),
    "REQUIRED_PART_MISSING",
  );
  await expectImportError(
    async () =>
      openDocxPackage(await makeDocxFixture({ "[Content_Types].xml": MINIMAL_CONTENT_TYPES })),
    "REQUIRED_PART_MISSING",
  );
});

test("rejects encrypted and symbolic-link entries from central-directory metadata", async () => {
  await expectImportError(
    async () =>
      openDocxPackage(
        await makeDocxFixture(
          {},
          {
            entries: minimumEntries({ password: "secret" }),
          },
        ),
      ),
    "ZIP_ENCRYPTED_ENTRY",
  );

  await expectImportError(
    async () =>
      openDocxPackage(
        await makeDocxFixture(
          {},
          {
            entries: minimumEntries(undefined, { unixMode: 0o120777 }),
          },
        ),
      ),
    "ZIP_SYMLINK_ENTRY",
  );
});

test("rejects traversal paths and case-folded duplicate package names", async () => {
  const safe = await makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": MINIMAL_DOCUMENT,
    "word/x.xml": "<safe/>",
  });
  const traversing = await replaceZipEntryName(safe, "word/x.xml", "../bad.xml");
  await expectImportError(() => openDocxPackage(traversing), "ZIP_PATH_UNSAFE");

  await expectImportError(
    async () =>
      openDocxPackage(
        await makeDocxFixture({
          "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
          "word/document.xml": MINIMAL_DOCUMENT,
          "word/Document.xml": "<duplicate/>",
        }),
      ),
    "ZIP_DUPLICATE_ENTRY",
  );
});

test("enforces the ZIP entry-count limit", async () => {
  const parts: Record<string, string> = {
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": MINIMAL_DOCUMENT,
  };
  for (let index = 0; index < DOCX_IMPORT_LIMITS.zipEntries - 1; index += 1) {
    parts[`custom/item-${index}.txt`] = "";
  }
  await expectImportError(
    async () => openDocxPackage(await makeDocxFixture(parts)),
    "ZIP_ENTRY_LIMIT",
  );
});

test("rejects a compression ratio above 100 to 1", async () => {
  await expectImportError(
    async () => openDocxPackage(await makeHighlyCompressibleDocx(2_000_000)),
    "ZIP_RATIO_LIMIT",
  );
});

test("enforces total uncompressed and single XML part metadata limits before extraction", async () => {
  const totalLimitFixture = await makeDocxFixture(undefined, {
    patchSizes: [
      {
        name: "word/document.xml",
        compressedSize: Math.ceil((DOCX_IMPORT_LIMITS.uncompressedBytes + 1) / 100),
        uncompressedSize: DOCX_IMPORT_LIMITS.uncompressedBytes + 1,
      },
    ],
  });
  await expectImportError(() => openDocxPackage(totalLimitFixture), "ZIP_UNCOMPRESSED_LIMIT");

  const xmlLimitFixture = await makeDocxFixture(undefined, {
    patchSizes: [
      {
        name: "word/document.xml",
        compressedSize: Math.ceil((DOCX_IMPORT_LIMITS.xmlPartBytes + 1) / 100),
        uncompressedSize: DOCX_IMPORT_LIMITS.xmlPartBytes + 1,
      },
    ],
  });
  await expectImportError(() => openDocxPackage(xmlLimitFixture), "XML_PART_SIZE_LIMIT");
});

test("rejects DTD and entity declarations before the XML parser sees them", async () => {
  for (const forbidden of [
    "<!DOCTYPE w:document><w:document/>",
    "<!EnTiTy x 'unsafe'><w:document/>",
  ]) {
    const file = await makeDocxFixture({
      "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
      "word/document.xml": forbidden,
    });
    await expectImportError(() => openAndReadMainDocument(file), "XML_DTD_FORBIDDEN");
  }
});

test("decodes BOM-marked UTF-16 XML and rejects unsupported byte encodings", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-16"?><w:document xmlns:w="urn:test"><w:body>正文</w:body></w:document>`;
  for (const bytes of [encodeUtf16(xml, true), encodeUtf16(xml, false)]) {
    const file = await makeDocxFixture({
      "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
      "word/document.xml": bytes,
    });
    assert.equal(await openAndReadMainDocument(file), xml);
  }

  const invalid = await makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": new Uint8Array([0xff, 0xff, 0xff]),
  });
  await expectImportError(() => openAndReadMainDocument(invalid), "XML_ENCODING_INVALID");
});

test("rejects malformed XML and nesting deeper than 100 elements", async () => {
  await expectImportError(
    () => parseOrderedXml("<w:document><w:body></w:document>", "word/document.xml"),
    "XML_MALFORMED",
  );

  const deeplyNested = `${"<n>".repeat(DOCX_IMPORT_LIMITS.xmlDepth + 1)}text${"</n>".repeat(DOCX_IMPORT_LIMITS.xmlDepth + 1)}`;
  await expectImportError(
    () => parseOrderedXml(deeplyNested, "word/document.xml"),
    "XML_DEPTH_LIMIT",
  );
});

test("rejects undeclared and invalid numeric entity references", async () => {
  for (const malformed of [
    "<root>&foo;</root>",
    "<root>&AMP;</root>",
    "<root>&#0;</root>",
    '<root value="&#xD800;"/>',
  ]) {
    await expectImportError(() => parseOrderedXml(malformed, "word/document.xml"), "XML_MALFORMED");
  }
});

test("preserves CDATA without interpreting entity-shaped content", () => {
  const nodes = parseOrderedXml("<root><![CDATA[&foo;&amp;]]></root>", "word/document.xml");
  assert.equal(xmlText(xmlChild(nodes, "root")!), "&foo;&amp;");
});

test("ordered XML helpers preserve source order and ignore namespace prefixes", () => {
  const nodes = parseOrderedXml(
    `<w:document xmlns:w="urn:test" w:kind="main"><w:p>A</w:p><x:p xmlns:x="urn:other">B<w:r>C</w:r></x:p></w:document>`,
    "word/document.xml",
  );
  const document = xmlChild(nodes, "document");
  assert.ok(document);
  assert.equal(xmlAttr(document, "kind"), "main");
  const paragraphs = xmlChildren(document, "p");
  assert.equal(paragraphs.length, 2);
  assert.deepEqual(
    paragraphs.map((node) => xmlText(node)),
    ["A", "BC"],
  );
  assert.equal(xmlText(document), "ABC");
});

function minimumEntries(
  documentOptions?: DocxFixtureEntry["options"],
  extraOptions?: DocxFixtureEntry["options"],
): DocxFixtureEntry[] {
  return [
    { name: "[Content_Types].xml", value: MINIMAL_CONTENT_TYPES },
    { name: "word/document.xml", value: MINIMAL_DOCUMENT, options: documentOptions },
    ...(extraOptions ? [{ name: "word/link", value: "target", options: extraOptions }] : []),
  ];
}

function encodeUtf16(value: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(2 + index * 2, value.charCodeAt(index), littleEndian);
  }
  return bytes;
}
