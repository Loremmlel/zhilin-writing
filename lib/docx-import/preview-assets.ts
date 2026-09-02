import { escapeMarkdownLiteral } from "./markdown.ts";
import type { DocxPreviewAsset, ImportAsset } from "./types.ts";

export function replaceDocxAssetReferences(
  markdown: string,
  assets: ReadonlyArray<{ source: ImportAsset; uploaded: DocxPreviewAsset }>,
): string {
  let result = markdown;
  for (const { source, uploaded } of assets) {
    const alt = escapeMarkdownLiteral(source.alt);
    result = result.replaceAll(
      `![${alt}](docx-asset:${source.id})`,
      `![${alt}](${uploaded.temporaryUrl})`,
    );
  }
  return result;
}

export async function uploadDocxAssetsSequentially(
  assets: readonly ImportAsset[],
  signal: AbortSignal,
  upload: (asset: ImportAsset, signal: AbortSignal) => Promise<DocxPreviewAsset>,
  onUploaded: (count: number) => void,
) {
  const uploadedAssets: Array<{ source: ImportAsset; uploaded: DocxPreviewAsset }> = [];
  for (const [index, asset] of assets.entries()) {
    signal.throwIfAborted();
    const uploaded = await upload(asset, signal);
    signal.throwIfAborted();
    uploadedAssets.push({ source: asset, uploaded });
    onUploaded(index + 1);
  }
  return uploadedAssets;
}
