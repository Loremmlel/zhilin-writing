export const DOCX_IMPORT_LIMITS = Object.freeze({
  compressedBytes: 20 * 1024 * 1024,
  zipEntries: 1000,
  uncompressedBytes: 200 * 1024 * 1024,
  compressionRatio: 100,
  xmlPartBytes: 20 * 1024 * 1024,
  xmlDepth: 100,
  images: 200,
  imageBytes: 10 * 1024 * 1024,
  commentsAndReplies: 500,
  markdownUtf8Bytes: 1_500_000,
  workerTimeoutMs: 20_000,
  previewTtlMs: 24 * 60 * 60 * 1000,
});
