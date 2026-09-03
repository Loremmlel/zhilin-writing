import type { MarkType, Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Selection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";

import { inspectAnnotationTransaction, type AnnotationImpactReason } from "./annotation-guard.ts";
import { analyzeAnnotationRanges } from "./annotation-ranges.ts";

export type PendingAnnotationImpact = {
  token: number;
  affectedAnnotationIds: string[];
  reasons: AnnotationImpactReason[];
  excerpts: Array<{ annotationId: string; text: string }>;
  source: "transaction" | "composition";
};

type PendingRecord = PendingAnnotationImpact & {
  beforeDoc: ProseMirrorNode;
  beforeDocSignature: string;
  epoch: number;
  selectionSignature: string;
  stepSignature: string;
  proposedTransaction: Transaction;
};

type ConfirmedTransition = {
  beforeDocSignature: string;
  afterDocSignature: string;
  stepSignature: string;
  affectedAnnotationIds: string[];
};

type CompositionAuthorization = {
  beforeDocSignature: string;
  epoch: number;
  selectionSignature: string;
};

type SessionOptions = {
  baseAnnotationIds: string[];
  initialConfirmedAnnotationDeletionIds?: string[];
  onPendingImpact?: (pending: PendingAnnotationImpact) => void;
  onStateChange?: (state: {
    pending: PendingAnnotationImpact | null;
    confirmedAnnotationDeletionIds: string[];
  }) => void;
};

export type AnnotationTransactionDecision =
  | { kind: "ALLOW" }
  | { kind: "ALLOW_CONFIRMED" }
  | { kind: "BLOCK"; pending: PendingAnnotationImpact }
  | { kind: "REPLACE"; transaction: Transaction };

export type AnnotationConfirmationResult =
  | { kind: "APPLY"; transaction: Transaction }
  | { kind: "REENTER_COMPOSITION"; message: string }
  | { kind: "CLIPBOARD_ERROR"; message: string }
  | { kind: "STALE"; message: string };

const staleMessage = "正文已经变化，请重新执行刚才的操作";
const reenterMessage = "批注已确认待撤下，请重新输入刚才的文字";
const transitionLimit = 32;

function docSignature(doc: ProseMirrorNode) {
  return JSON.stringify(doc.toJSON());
}

function selectionSignature(state: EditorState) {
  return JSON.stringify(state.selection.toJSON());
}

function transactionStepSignature(transaction: Transaction) {
  return JSON.stringify(transaction.steps.map((step) => step.toJSON()));
}

function normalizedIds(ids: Iterable<string>) {
  return [...new Set([...ids].filter((id) => id.length > 0))].sort();
}

function annotationMarkType(state: EditorState): MarkType {
  const markType = state.schema.marks.annotation;
  if (!markType)
    throw new Error("AnnotationGuard requires the annotation mark in the editor schema");
  return markType;
}

function affectedExcerpts(doc: ProseMirrorNode, ids: string[]) {
  const wanted = new Set(ids);
  const grouped = new Map<string, string[]>();
  for (const range of analyzeAnnotationRanges(doc).ranges) {
    if (wanted.has(range.annotationId))
      grouped.set(range.annotationId, [...(grouped.get(range.annotationId) ?? []), range.text]);
  }
  return ids.flatMap((annotationId) => {
    const parts = grouped.get(annotationId);
    return parts ? [{ annotationId, text: parts.join("\n\n").slice(0, 120) }] : [];
  });
}

function compositeTransaction(
  state: EditorState,
  proposed: Transaction,
  affectedIds: string[],
): Transaction {
  const transaction = state.tr;
  const wanted = new Set(affectedIds);
  const markType = annotationMarkType(state);
  for (const step of proposed.steps) transaction.step(step);
  // Input transactions can carry the old annotation mark on replacement text.
  // Remove affected anchors from the proposed document, after positions settle.
  for (const range of analyzeAnnotationRanges(transaction.doc).ranges) {
    if (wanted.has(range.annotationId)) transaction.removeMark(range.from, range.to, markType);
  }
  transaction.setSelection(Selection.fromJSON(transaction.doc, proposed.selection.toJSON()));
  if (proposed.storedMarksSet) transaction.setStoredMarks(proposed.storedMarks);
  for (const key of ["uiEvent", "composition", "paste", "cut"]) {
    const value = proposed.getMeta(key);
    if (value !== undefined) transaction.setMeta(key, value);
  }
  transaction.setMeta("addToHistory", true);
  transaction.setMeta("annotationGuard", {
    confirmed: true,
    affectedAnnotationIds: normalizedIds(affectedIds),
  });
  return transaction;
}

export function createAnnotationGuardSession(options: SessionOptions) {
  const baseAnnotationIds = new Set(normalizedIds(options.baseAnnotationIds));
  const approvedDeletionIds = new Set(
    normalizedIds(options.initialConfirmedAnnotationDeletionIds ?? []),
  );
  let pending: PendingRecord | null = null;
  let epoch = 0;
  let token = 0;
  let lastDoc: ProseMirrorNode | null = null;
  let compositionMode: "idle" | "blocked" | "authorized" | "applied" = "idle";
  let compositionAuthorization: CompositionAuthorization | null = null;
  const transitions: ConfirmedTransition[] = [];

  function confirmedAnnotationDeletionIds(doc: ProseMirrorNode) {
    const present = new Set(analyzeAnnotationRanges(doc).ranges.map((range) => range.annotationId));
    return normalizedIds(
      [...approvedDeletionIds].filter((id) => baseAnnotationIds.has(id) && !present.has(id)),
    );
  }

  function notify(doc: ProseMirrorNode | null) {
    options.onStateChange?.({
      pending,
      confirmedAnnotationDeletionIds: doc ? confirmedAnnotationDeletionIds(doc) : [],
    });
  }

  function capturePending(
    state: EditorState,
    proposedTransaction: Transaction,
    source: PendingAnnotationImpact["source"],
  ) {
    const impact = inspectAnnotationTransaction(state.doc, proposedTransaction);
    if (impact.kind === "SAFE") return null;
    const record: PendingRecord = {
      token: ++token,
      affectedAnnotationIds: impact.affectedAnnotationIds,
      reasons: impact.reasons,
      excerpts: affectedExcerpts(state.doc, impact.affectedAnnotationIds),
      source,
      beforeDoc: state.doc,
      beforeDocSignature: docSignature(state.doc),
      epoch,
      selectionSignature: selectionSignature(state),
      stepSignature: transactionStepSignature(proposedTransaction),
      proposedTransaction,
    };
    lastDoc = state.doc;
    pending = record;
    options.onPendingImpact?.(record);
    notify(state.doc);
    return record;
  }

  function isCurrent(record: PendingRecord, state: EditorState) {
    const impact = inspectAnnotationTransaction(state.doc, record.proposedTransaction);
    return (
      impact.kind === "ANNOTATION_IMPACT" &&
      JSON.stringify(impact.affectedAnnotationIds) ===
        JSON.stringify(record.affectedAnnotationIds) &&
      record.epoch === epoch &&
      record.beforeDoc.eq(state.doc) &&
      record.beforeDocSignature === docSignature(state.doc) &&
      record.selectionSignature === selectionSignature(state) &&
      record.stepSignature === transactionStepSignature(record.proposedTransaction)
    );
  }

  function registerTransition(
    before: ProseMirrorNode,
    transaction: Transaction,
    affectedAnnotationIds: string[],
  ) {
    transitions.push({
      beforeDocSignature: docSignature(before),
      afterDocSignature: docSignature(transaction.doc),
      stepSignature: transactionStepSignature(transaction),
      affectedAnnotationIds: normalizedIds(affectedAnnotationIds),
    });
    if (transitions.length > transitionLimit) transitions.shift();
  }

  function isRegisteredTransition(
    state: EditorState,
    transaction: Transaction,
    affectedAnnotationIds: string[],
  ) {
    const before = docSignature(state.doc);
    const after = docSignature(transaction.doc);
    const steps = transactionStepSignature(transaction);
    return transitions.some(
      (transition) =>
        transition.beforeDocSignature === before &&
        transition.afterDocSignature === after &&
        transition.stepSignature === steps &&
        JSON.stringify(transition.affectedAnnotationIds) ===
          JSON.stringify(normalizedIds(affectedAnnotationIds)),
    );
  }

  function replaceConfirmedTransaction(
    state: EditorState,
    transaction: Transaction,
    affectedIds: string[],
  ) {
    const replacement = compositeTransaction(state, transaction, affectedIds);
    for (const id of affectedIds) approvedDeletionIds.add(id);
    registerTransition(state.doc, replacement, affectedIds);
    return replacement;
  }

  function inspectTransaction(
    state: EditorState,
    transaction: Transaction,
    context: { source?: "composition" } = {},
  ): AnnotationTransactionDecision {
    const impact = inspectAnnotationTransaction(state.doc, transaction);
    if (impact.kind === "SAFE") return { kind: "ALLOW" };
    if (isRegisteredTransition(state, transaction, impact.affectedAnnotationIds))
      return { kind: "ALLOW_CONFIRMED" };
    if (
      context.source === "composition" &&
      compositionMode === "authorized" &&
      compositionAuthorization &&
      compositionAuthorization.epoch === epoch &&
      compositionAuthorization.beforeDocSignature === docSignature(state.doc) &&
      compositionAuthorization.selectionSignature === selectionSignature(state)
    ) {
      compositionMode = "applied";
      compositionAuthorization = null;
      return {
        kind: "REPLACE",
        transaction: replaceConfirmedTransaction(state, transaction, impact.affectedAnnotationIds),
      };
    }
    const nextPending = capturePending(
      state,
      transaction,
      context.source === "composition" ? "composition" : "transaction",
    );
    if (!nextPending) return { kind: "ALLOW" };
    return { kind: "BLOCK", pending: nextPending };
  }

  function cancelPendingAnnotationImpact(value: number) {
    if (pending?.token !== value) return;
    pending = null;
    compositionMode = "idle";
    compositionAuthorization = null;
    notify(lastDoc);
  }

  function confirmPendingAnnotationImpact(
    value: number,
    state: EditorState,
  ): AnnotationConfirmationResult {
    const record = pending;
    if (!record || record.token !== value || !isCurrent(record, state)) {
      pending = null;
      compositionMode = "idle";
      compositionAuthorization = null;
      notify(state.doc);
      return { kind: "STALE", message: staleMessage };
    }
    pending = null;
    for (const id of record.affectedAnnotationIds) approvedDeletionIds.add(id);
    if (record.source === "composition") {
      compositionAuthorization = {
        beforeDocSignature: record.beforeDocSignature,
        epoch: record.epoch,
        selectionSignature: record.selectionSignature,
      };
      compositionMode = "idle";
      notify(state.doc);
      return { kind: "REENTER_COMPOSITION", message: reenterMessage };
    }
    const replacement = compositeTransaction(
      state,
      record.proposedTransaction,
      record.affectedAnnotationIds,
    );
    registerTransition(state.doc, replacement, record.affectedAnnotationIds);
    notify(replacement.doc);
    return { kind: "APPLY", transaction: replacement };
  }

  function beginComposition(state: EditorState) {
    if (
      compositionAuthorization &&
      compositionAuthorization.epoch === epoch &&
      compositionAuthorization.beforeDocSignature === docSignature(state.doc) &&
      compositionAuthorization.selectionSignature === selectionSignature(state)
    ) {
      compositionMode = "authorized";
      return { kind: "AUTHORIZED" } as const;
    }
    compositionAuthorization = null;
    if (state.selection.empty) {
      compositionMode = "idle";
      return { kind: "ALLOW" } as const;
    }
    const proposed = state.tr.deleteSelection();
    const record = capturePending(state, proposed, "composition");
    if (!record) {
      compositionMode = "idle";
      return { kind: "ALLOW" } as const;
    }
    compositionMode = "blocked";
    return { kind: "BLOCK", pending: record } as const;
  }

  function acceptTransaction(before: EditorState, _transaction: Transaction, after: EditorState) {
    const selectionChanged =
      JSON.stringify(before.selection.toJSON()) !== JSON.stringify(after.selection.toJSON());
    if (!before.doc.eq(after.doc) || selectionChanged) epoch += 1;
    lastDoc = after.doc;
    if (compositionAuthorization && compositionAuthorization.epoch !== epoch)
      compositionAuthorization = null;
    notify(after.doc);
  }

  return {
    inspectTransaction,
    confirmPendingAnnotationImpact,
    cancelPendingAnnotationImpact,
    confirmedAnnotationDeletionIds,
    acceptTransaction,
    pendingImpact: () => pending as PendingAnnotationImpact | null,
    beginComposition,
    blockCompositionUpdate: () => compositionMode === "blocked",
    endComposition: (cancelled: boolean) => {
      const restoreConfirmedComposition = cancelled && compositionMode === "applied";
      if (cancelled && pending?.source === "composition") pending = null;
      const affectedAnnotationIds = restoreConfirmedComposition
        ? (transitions.pop()?.affectedAnnotationIds ?? [])
        : [];
      compositionMode = "idle";
      if (cancelled) compositionAuthorization = null;
      notify(lastDoc);
      return affectedAnnotationIds;
    },
    hasCompositionAuthorization: () => compositionAuthorization !== null,
    discard: () => {
      pending = null;
      approvedDeletionIds.clear();
      transitions.length = 0;
      compositionAuthorization = null;
      compositionMode = "idle";
      notify(lastDoc);
    },
  };
}
