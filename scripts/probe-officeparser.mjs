import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOffice } from "officeparser";

const DEFAULT_FIXTURE_DIRECTORY = resolve("tests/fixtures/docx/generated");

function textNodes(nodes) {
  return nodes.flatMap((node) => [
    ...(node.type === "text" ? [node] : []),
    ...textNodes(node.children ?? []),
  ]);
}

function attachedCommentIds(node) {
  return (node.comments ?? [])
    .map((comment) => comment.metadata?.commentId)
    .filter((id) => typeof id === "string");
}

function observedAnchorText(ast, commentId) {
  return textNodes(ast.content)
    .filter((node) => attachedCommentIds(node).includes(commentId))
    .map((node) => node.text ?? "")
    .join("");
}

function commentsIn(ast) {
  return textNodes(ast.content).flatMap((node) => node.comments ?? []);
}

function commentIds(ast) {
  return [...new Set(commentsIn(ast)
    .map((comment) => comment.metadata?.commentId)
    .filter((id) => typeof id === "string"))].sort();
}

function hasImmediateParent(comment, parentId) {
  const metadata = comment?.metadata ?? {};
  return [metadata.parentCommentId, metadata.parentId, metadata.replyTo, metadata.paraIdParent]
    .some((value) => String(value) === parentId);
}

function isResolved(comment) {
  const metadata = comment?.metadata ?? {};
  return metadata.resolved === true || metadata.sourceResolved === true || metadata.done === true || metadata.done === "1";
}

export async function runOfficeparserProbe(fixtureDirectory = DEFAULT_FIXTURE_DIRECTORY) {
  const [packageJson, adjacent, adjacentAgain, overlap, threaded] = await Promise.all([
    readFile(resolve("node_modules/officeparser/package.json"), "utf8").then(JSON.parse),
    parseOffice(resolve(fixtureDirectory, "probe-adjacent.docx")),
    parseOffice(resolve(fixtureDirectory, "probe-adjacent.docx")),
    parseOffice(resolve(fixtureDirectory, "probe-overlap-nested.docx")),
    parseOffice(resolve(fixtureDirectory, "probe-threaded-resolved.docx")),
  ]);

  const overlapRanges = {
    "10": observedAnchorText(overlap, "10"),
    "11": observedAnchorText(overlap, "11"),
    "12": observedAnchorText(overlap, "12"),
  };
  const exactOverlapRanges = overlapRanges["10"] === "ABCDE"
    && overlapRanges["11"] === "BC"
    && overlapRanges["12"] === "CD";
  const adjacentRanges = {
    "0": observedAnchorText(adjacent, "0"),
    "1": observedAnchorText(adjacent, "1"),
  };
  const root = commentsIn(threaded).find((comment) => comment.metadata?.commentId === "20");
  const reply = commentsIn(threaded).find((comment) => comment.metadata?.commentId === "21");
  const firstIds = commentIds(adjacent);
  const secondIds = commentIds(adjacentAgain);

  const gates = {
    inlineRange: exactOverlapRanges,
    adjacentDistinct: adjacentRanges["0"] === "alpha" && adjacentRanges["1"] === "beta",
    nestedOverlapDistinct: exactOverlapRanges && commentIds(overlap).join(",") === "10,11,12",
    stableCommentId: firstIds.join(",") === "0,1" && firstIds.join(",") === secondIds.join(","),
    immediateReplyParent: Boolean(reply && hasImmediateParent(reply, "20")),
    resolvedState: isResolved(root),
    noSelectedTextSearch: exactOverlapRanges,
  };

  return {
    version: packageJson.version,
    gates,
    evidence: {
      inlineRange: `expected 10=ABCDE,11=BC,12=CD; observed ${JSON.stringify(overlapRanges)}`,
      adjacentDistinct: `observed ${JSON.stringify(adjacentRanges)}`,
      nestedOverlapDistinct: `IDs ${commentIds(overlap).join(",") || "none"}; ranges ${JSON.stringify(overlapRanges)}`,
      stableCommentId: `first ${firstIds.join(",") || "none"}; second ${secondIds.join(",") || "none"}`,
      immediateReplyParent: reply ? `reply metadata ${JSON.stringify(reply.metadata ?? {})}` : "reply comment 21 absent from AST",
      resolvedState: root ? `root metadata ${JSON.stringify(root.metadata ?? {})}` : "root comment 20 absent from AST",
      noSelectedTextSearch: exactOverlapRanges
        ? "exact ranges are directly reconstructable from AST comment membership"
        : "exact ranges require reparsing raw OOXML or guessing from selected text",
    },
    productionEligible: Object.values(gates).every(Boolean),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runOfficeparserProbe(), null, 2));
}
