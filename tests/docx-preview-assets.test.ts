import assert from "node:assert/strict";
import test from "node:test";

import {
  replaceDocxAssetReferences,
  uploadDocxAssetsSequentially,
} from "../lib/docx-import/preview-assets.ts";
import type { DocxPreviewAsset, ImportAsset } from "../lib/docx-import/types.ts";

test("replaces only generated DOCX image destinations", () => {
  const source: ImportAsset = {
    id: "asset_000001",
    filename: "image.png",
    mimeType: "image/png",
    bytes: new Uint8Array([1]),
    alt: "image",
    sourceRelationshipId: "rImage",
    floating: false,
  };
  const uploaded: DocxPreviewAsset = {
    assetId: "stored-1",
    temporaryUrl: "/api/assets/stored-1",
    filename: "image.png",
    mimeType: "image/png",
  };
  const markdown = [
    "Meeting time stays escaped: 5\\:00.",
    "",
    "Literal docx-asset:asset_000001 stays.",
    "",
    "[ordinary link](docx-asset:asset_000001)",
    "",
    "![image](docx-asset:asset_000001)",
  ].join("\n");

  const result = replaceDocxAssetReferences(markdown, [{ source, uploaded }]);

  assert.match(result, /Meeting time stays escaped: 5\\:00\./);
  assert.match(result, /Literal docx-asset:asset_000001 stays\./);
  assert.match(result, /\[ordinary link\]\(docx-asset\\?:asset_000001\)/);
  assert.match(result, /!\[image\]\(\/api\/assets\/stored-1\)/);
});

test("uploads DOCX assets one at a time in source order", async () => {
  const first = sourceAsset("first");
  const second = sourceAsset("second");
  const calls: string[] = [];
  let active = 0;
  const progress: number[] = [];

  const result = await uploadDocxAssetsSequentially(
    [first, second],
    new AbortController().signal,
    async (asset) => {
      active += 1;
      assert.equal(active, 1);
      calls.push(asset.id);
      await Promise.resolve();
      active -= 1;
      return uploadedAsset(asset.id);
    },
    (count) => progress.push(count),
  );

  assert.deepEqual(calls, ["first", "second"]);
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(result.map(({ source, uploaded }) => [source.id, uploaded.assetId]), [
    ["first", "stored-first"],
    ["second", "stored-second"],
  ]);
});

test("stops when cancellation arrives during the final upload", async () => {
  const controller = new AbortController();
  await assert.rejects(
    uploadDocxAssetsSequentially(
      [sourceAsset("only")],
      controller.signal,
      async (asset) => {
        controller.abort();
        return uploadedAsset(asset.id);
      },
      () => undefined,
    ),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});

function sourceAsset(id: string): ImportAsset {
  return {
    id,
    filename: `${id}.png`,
    mimeType: "image/png",
    bytes: new Uint8Array([1]),
    alt: id,
    sourceRelationshipId: `r-${id}`,
    floating: false,
  };
}

function uploadedAsset(id: string): DocxPreviewAsset {
  return {
    assetId: `stored-${id}`,
    temporaryUrl: `/api/assets/stored-${id}`,
    filename: `${id}.png`,
    mimeType: "image/png",
  };
}
