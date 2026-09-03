import {
  BlobReader,
  ERR_AMBIGUOUS_ARCHIVE,
  ERR_UNSAFE_FILENAME,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";

import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { DocxImportError } from "./types.ts";
import { assertSafeXmlText } from "./xml.ts";

export interface DocxPackageEntry {
  readonly path: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export interface DocxPackageReader {
  readonly entries: readonly DocxPackageEntry[];
  has(path: string): boolean;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

const REQUIRED_PARTS = ["[Content_Types].xml", "word/document.xml"] as const;
const ZIP_LOCAL_FILE_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const OLE_SIGNATURE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function openDocxPackage(file: File): Promise<DocxPackageReader> {
  validateFileEnvelope(file);
  const prefix = new Uint8Array(await file.slice(0, OLE_SIGNATURE.length).arrayBuffer());
  if (startsWith(prefix, OLE_SIGNATURE)) {
    throw new DocxImportError(
      "OLE_DOCUMENT_UNSUPPORTED",
      "Legacy .doc and encrypted or protected OLE Office documents are not supported",
    );
  }
  if (!startsWith(prefix, ZIP_LOCAL_FILE_SIGNATURE)) {
    throw new DocxImportError(
      "ZIP_SIGNATURE_INVALID",
      "The selected file is not a DOCX ZIP package",
    );
  }

  const zipReader = new ZipReader(new BlobReader(file), {
    strictness: "strict",
    checkAmbiguity: true,
    maxAppendedDataSize: 0,
    useWebWorkers: false,
  });

  try {
    const entries = await zipReader.getEntries({
      strictness: "strict",
      checkAmbiguity: true,
      maxAppendedDataSize: 0,
    });
    const files = validateEntries(entries);
    return createPackageReader(zipReader, files);
  } catch (error) {
    await zipReader.close();
    if (error instanceof DocxImportError) throw error;
    throw mapZipError(error);
  }
}

function validateFileEnvelope(file: File): void {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".docx")) {
    throw new DocxImportError("INVALID_EXTENSION", "Only .docx files can be imported", {
      filename: file.name,
    });
  }
  if (file.size > DOCX_IMPORT_LIMITS.compressedBytes) {
    throw new DocxImportError(
      "FILE_SIZE_LIMIT",
      `DOCX file exceeds the ${DOCX_IMPORT_LIMITS.compressedBytes}-byte compressed limit`,
      { size: file.size },
    );
  }
}

function validateEntries(entries: Entry[]): Map<string, FileEntry> {
  if (entries.length > DOCX_IMPORT_LIMITS.zipEntries) {
    throw new DocxImportError(
      "ZIP_ENTRY_LIMIT",
      `DOCX package contains more than ${DOCX_IMPORT_LIMITS.zipEntries} ZIP entries`,
      { count: entries.length },
    );
  }

  const files = new Map<string, FileEntry>();
  const canonicalNames = new Set<string>();
  let totalUncompressed = 0;

  for (const entry of entries) {
    assertSafePackagePath(entry.filename, entry.directory);
    const canonicalName = entry.filename.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalNames.has(canonicalName)) {
      throw new DocxImportError(
        "ZIP_DUPLICATE_ENTRY",
        "DOCX package contains an ambiguous duplicate entry",
        {
          path: entry.filename,
        },
      );
    }
    canonicalNames.add(canonicalName);

    if (entry.encrypted) {
      throw new DocxImportError(
        "ZIP_ENCRYPTED_ENTRY",
        "Encrypted DOCX package entries are not supported",
        {
          path: entry.filename,
        },
      );
    }
    if (entry.symlink) {
      throw new DocxImportError(
        "ZIP_SYMLINK_ENTRY",
        "Symbolic links are forbidden in DOCX packages",
        {
          path: entry.filename,
        },
      );
    }

    totalUncompressed += entry.uncompressedSize;
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > DOCX_IMPORT_LIMITS.compressionRatio)
    ) {
      throw new DocxImportError(
        "ZIP_RATIO_LIMIT",
        `DOCX entry exceeds the ${DOCX_IMPORT_LIMITS.compressionRatio}:1 compression-ratio limit`,
        {
          path: entry.filename,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
        },
      );
    }
    if (!entry.directory) files.set(entry.filename, entry);
  }

  if (totalUncompressed > DOCX_IMPORT_LIMITS.uncompressedBytes) {
    throw new DocxImportError(
      "ZIP_UNCOMPRESSED_LIMIT",
      `DOCX package exceeds the ${DOCX_IMPORT_LIMITS.uncompressedBytes}-byte uncompressed limit`,
      { totalUncompressed },
    );
  }

  for (const [path, entry] of files) {
    if (isXmlPart(path) && entry.uncompressedSize > DOCX_IMPORT_LIMITS.xmlPartBytes) {
      throw new DocxImportError(
        "XML_PART_SIZE_LIMIT",
        `XML part exceeds the ${DOCX_IMPORT_LIMITS.xmlPartBytes}-byte limit`,
        { path, uncompressedSize: entry.uncompressedSize },
      );
    }
  }

  for (const path of REQUIRED_PARTS) {
    if (!files.has(path)) {
      throw new DocxImportError("REQUIRED_PART_MISSING", `DOCX package is missing ${path}`, {
        path,
      });
    }
  }
  return files;
}

function createPackageReader(
  zipReader: ZipReader<Blob>,
  files: Map<string, FileEntry>,
): DocxPackageReader {
  let closed = false;
  const publicEntries = Object.freeze(
    [...files].map(([path, entry]) =>
      Object.freeze({
        path,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
      }),
    ),
  );

  const assertOpen = () => {
    if (closed) throw new DocxImportError("PACKAGE_CLOSED", "DOCX package reader is closed");
  };

  const readBytes = async (path: string): Promise<Uint8Array> => {
    assertOpen();
    const entry = files.get(path);
    if (!entry) {
      throw new DocxImportError("ZIP_ENTRY_NOT_FOUND", "DOCX package entry does not exist", {
        path,
      });
    }
    try {
      const bytes = new Uint8Array(
        await entry.arrayBuffer({
          strictness: "strict",
          checkAmbiguity: true,
          checkCrc32: true,
          checkOverlappingEntry: true,
          useWebWorkers: false,
        }),
      );
      if (bytes.byteLength !== entry.uncompressedSize) {
        throw new DocxImportError(
          "ZIP_ENTRY_SIZE_MISMATCH",
          "Extracted DOCX entry size does not match central-directory metadata",
          { path, declared: entry.uncompressedSize, actual: bytes.byteLength },
        );
      }
      return bytes;
    } catch (error) {
      if (error instanceof DocxImportError) throw error;
      throw new DocxImportError(
        "ZIP_ENTRY_READ_FAILED",
        "DOCX package entry could not be read safely",
        { path },
        { cause: error },
      );
    }
  };

  return {
    entries: publicEntries,
    has(path) {
      assertOpen();
      return files.has(path);
    },
    async readText(path) {
      const bytes = await readBytes(path);
      const text = decodeXmlBytes(bytes, path);
      assertSafeXmlText(text, path);
      return text;
    },
    readBytes,
    async close() {
      if (closed) return;
      closed = true;
      await zipReader.close();
    },
  };
}

function assertSafePackagePath(path: string, directory: boolean): void {
  const normalizedPath = directory && path.endsWith("/") ? path.slice(0, -1) : path;
  const components = normalizedPath.split("/");
  if (
    normalizedPath.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    (!directory && path.endsWith("/")) ||
    components.some((component) => component === "" || component === "." || component === "..")
  ) {
    throw new DocxImportError("ZIP_PATH_UNSAFE", "DOCX package contains an unsafe entry path", {
      path,
    });
  }
}

function decodeXmlBytes(bytes: Uint8Array, path: string): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = bytes.subarray(2).slice();
      for (let index = 0; index + 1 < swapped.length; index += 2) {
        [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
      }
      return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes,
    );
  } catch (error) {
    throw new DocxImportError(
      "XML_ENCODING_INVALID",
      "DOCX XML part is not valid UTF-8 or BOM-marked UTF-16",
      { path },
      { cause: error },
    );
  }
}

function isXmlPart(path: string): boolean {
  const lower = path.toLocaleLowerCase("en-US");
  return lower.endsWith(".xml") || lower.endsWith(".rels");
}

function mapZipError(error: unknown): DocxImportError {
  const message = error instanceof Error ? error.message : String(error);
  if (message === ERR_UNSAFE_FILENAME) {
    return new DocxImportError(
      "ZIP_PATH_UNSAFE",
      "DOCX package contains an unsafe entry path",
      undefined,
      {
        cause: error,
      },
    );
  }
  if (message === ERR_AMBIGUOUS_ARCHIVE) {
    return new DocxImportError("ZIP_AMBIGUOUS", "DOCX ZIP structure is ambiguous", undefined, {
      cause: error,
    });
  }
  return new DocxImportError("ZIP_INVALID", "DOCX ZIP package is malformed", undefined, {
    cause: error,
  });
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.length >= prefix.length && prefix.every((byte, index) => value[index] === byte);
}
