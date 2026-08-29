import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
  type ZipWriterAddDataOptions,
} from "@zip.js/zip.js";

export const MINIMAL_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

export const MINIMAL_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body>
</w:document>`;

export function wordDocumentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`;
}

export function documentRelationshipsXml(relationships: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
</Relationships>`;
}

type FixtureValue = string | Uint8Array;

export interface DocxFixtureEntry {
  name: string;
  value: FixtureValue;
  options?: ZipWriterAddDataOptions;
}

export interface DocxFixtureOptions {
  filename?: string;
  entries?: DocxFixtureEntry[];
  level?: number;
  patchSizes?: Array<{
    name: string;
    compressedSize?: number;
    uncompressedSize?: number;
  }>;
}

const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const encoder = new TextEncoder();

export async function makeDocxFixture(
  parts: Record<string, FixtureValue> = {
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": MINIMAL_DOCUMENT,
  },
  options: DocxFixtureOptions = {},
): Promise<File> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: options.level ?? 0,
  });
  const entries: DocxFixtureEntry[] = options.entries
    ?? Object.entries(parts).map(([name, value]) => ({ name, value }));

  for (const entry of entries) {
    const reader = typeof entry.value === "string"
      ? new TextReader(entry.value)
      : new Uint8ArrayReader(entry.value);
    await writer.add(entry.name, reader, {
      dataDescriptor: false,
      lastModDate: FIXED_DATE,
      level: options.level ?? 0,
      useWebWorkers: false,
      ...entry.options,
    });
  }

  let bytes: Uint8Array<ArrayBuffer> = await writer.close();
  for (const patch of options.patchSizes ?? []) {
    bytes = patchEntrySizes(bytes, patch.name, patch);
  }

  return new File([bytes], options.filename ?? "fixture.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function makeHighlyCompressibleDocx(size: number): Promise<File> {
  return makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": MINIMAL_DOCUMENT,
    "word/large.bin": new Uint8Array(size).fill(65),
  }, { level: 9 });
}

export function replaceZipEntryName(file: File, from: string, to: string): Promise<File> {
  if (encoder.encode(from).length !== encoder.encode(to).length) {
    throw new Error("ZIP entry name replacements must have equal UTF-8 byte lengths");
  }
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    replaceAll(bytes, encoder.encode(from), encoder.encode(to));
    return new File([bytes], file.name, { type: file.type });
  });
}

function patchEntrySizes(
  source: Uint8Array<ArrayBuffer>,
  filename: string,
  sizes: { compressedSize?: number; uncompressedSize?: number },
): Uint8Array<ArrayBuffer> {
  const bytes = source.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedName = encoder.encode(filename);
  let matchedLocal = false;
  let matchedCentral = false;

  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      if (equalBytes(bytes.subarray(offset + 30, offset + 30 + nameLength), expectedName)) {
        if (sizes.compressedSize !== undefined) view.setUint32(offset + 18, sizes.compressedSize, true);
        if (sizes.uncompressedSize !== undefined) view.setUint32(offset + 22, sizes.uncompressedSize, true);
        matchedLocal = true;
      }
    }
    if (signature === 0x02014b50) {
      const nameLength = view.getUint16(offset + 28, true);
      if (equalBytes(bytes.subarray(offset + 46, offset + 46 + nameLength), expectedName)) {
        if (sizes.compressedSize !== undefined) view.setUint32(offset + 20, sizes.compressedSize, true);
        if (sizes.uncompressedSize !== undefined) view.setUint32(offset + 24, sizes.uncompressedSize, true);
        matchedCentral = true;
      }
    }
  }

  if (!matchedLocal || !matchedCentral) {
    throw new Error(`Unable to patch ZIP metadata for ${filename}`);
  }
  return bytes;
}

function replaceAll(bytes: Uint8Array, from: Uint8Array, to: Uint8Array): void {
  let matches = 0;
  for (let offset = 0; offset <= bytes.length - from.length; offset += 1) {
    if (!equalBytes(bytes.subarray(offset, offset + from.length), from)) continue;
    bytes.set(to, offset);
    matches += 1;
    offset += from.length - 1;
  }
  if (matches < 2) {
    throw new Error("Expected to replace a ZIP entry name in local and central headers");
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
