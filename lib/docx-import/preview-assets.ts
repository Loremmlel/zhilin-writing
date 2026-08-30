import {
  parseAnnotationMarkdown,
  stringifyAnnotationMarkdown,
} from "../annotations/markdown.ts";
import type { DocxPreviewAsset, ImportAsset } from "./types.ts";

type ImageNode = {
  type: string;
  url?: string;
  children?: ImageNode[];
};

export function replaceDocxAssetReferences(
  markdown: string,
  assets: ReadonlyArray<{ source: ImportAsset; uploaded: DocxPreviewAsset }>,
): string {
  const replacements = new Map(assets.map(({ source, uploaded }) => [
    `docx-asset:${source.id}`,
    uploaded.temporaryUrl,
  ]));
  const tree = parseAnnotationMarkdown(markdown) as ImageNode;
  visit(tree, (node) => {
    if (node.type === "image" && node.url && replacements.has(node.url)) {
      node.url = replacements.get(node.url);
    }
  });
  return stringifyAnnotationMarkdown(tree as never).trimEnd();
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

function visit(node: ImageNode, callback: (node: ImageNode) => void) {
  callback(node);
  node.children?.forEach((child) => visit(child, callback));
}
