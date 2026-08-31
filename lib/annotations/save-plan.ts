import { scanCanonicalAnnotationAnchorStates, validateCanonicalAnnotationDocument } from "./invariants.ts";

export type AnnotationDelta = {
  retained: string[];
  removed: string[];
  unexpected: string[];
};

export type AnchorRetirementReason = "POST_EDIT" | "REVISION_RESTORE";

export type AnnotationRetirementPlan = {
  annotationId: string;
  patch: {
    anchorRetiredAt: Date;
    anchorRetiredByUserId: string;
    anchorRetiredReason: AnchorRetirementReason;
  };
};

export type AnnotationRestorationPlan = {
  annotationId: string;
  patch: {
    anchorRetiredAt: null;
    anchorRetiredByUserId: null;
    anchorRetiredReason: null;
  };
};

export class AnnotationIntegrityError extends Error {
  readonly code = "ANNOTATION_INTEGRITY_ERROR" as const;

  constructor(message = "正文批注状态不一致，请重新载入后再试") {
    super(message);
    this.name = "AnnotationIntegrityError";
  }
}

type AnnotationRevisionState = {
  annotationId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: string | null;
};

type AnnotationRevisionSnapshot = {
  markdown: string;
  states: AnnotationRevisionState[];
  importedReplyStates?: ImportedReplyRevisionState[];
};

type ImportedReplyRevisionState = {
  annotationId: string;
  annotationReplyId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: string | null;
};

const annotationIdPattern = /^ann_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function stableUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

export function computeAnnotationDelta(baseIds: Iterable<string>, submittedIds: Iterable<string>): AnnotationDelta {
  const base = stableUnique(baseIds);
  const submitted = stableUnique(submittedIds);
  const baseSet = new Set(base);
  const submittedSet = new Set(submitted);
  return {
    retained: base.filter((id) => submittedSet.has(id)),
    removed: base.filter((id) => !submittedSet.has(id)),
    unexpected: submitted.filter((id) => !baseSet.has(id)),
  };
}

export function planAnnotationRetirement(
  annotationIds: Iterable<string>,
  actorUserId: string,
  at: Date,
  reason: AnchorRetirementReason,
): AnnotationRetirementPlan[] {
  return stableUnique(annotationIds).map((annotationId) => ({
    annotationId,
    patch: {
      anchorRetiredAt: at,
      anchorRetiredByUserId: actorUserId,
      anchorRetiredReason: reason,
    },
  }));
}

export function planAnnotationRestoration(annotationIds: Iterable<string>): AnnotationRestorationPlan[] {
  return stableUnique(annotationIds).map((annotationId) => ({
    annotationId,
    patch: {
      anchorRetiredAt: null,
      anchorRetiredByUserId: null,
      anchorRetiredReason: null,
    },
  }));
}

export function assertConfirmedAnnotationRemovals(
  baseIds: Iterable<string>,
  removedIds: Iterable<string>,
  confirmedIds: Iterable<string>,
): string[] {
  const base = new Set(baseIds);
  const confirmed = stableUnique(confirmedIds);
  if (confirmed.some((id) => !annotationIdPattern.test(id) || !base.has(id))) {
    throw new AnnotationIntegrityError();
  }
  const confirmedSet = new Set(confirmed);
  if ([...removedIds].some((id) => !confirmedSet.has(id))) throw new AnnotationIntegrityError();
  return [...confirmedSet].sort();
}

function time(value: Date | null): number | null {
  return value?.getTime() ?? null;
}

function annotationSignature(snapshot: AnnotationRevisionSnapshot): string {
  const anchors = scanCanonicalAnnotationAnchorStates(snapshot.markdown)
    .sort((left, right) => left.annotationId.localeCompare(right.annotationId));
  const states = snapshot.states.map((state) => ({
    annotationId: state.annotationId,
    deletedAt: time(state.deletedAt),
    deletedByUserId: state.deletedByUserId,
    hiddenAt: time(state.hiddenAt),
    hiddenByUserId: state.hiddenByUserId,
  })).sort((left, right) => left.annotationId.localeCompare(right.annotationId));
  const importedReplyStates = (snapshot.importedReplyStates ?? []).map((state) => ({
    annotationId: state.annotationId,
    annotationReplyId: state.annotationReplyId,
    deletedAt: time(state.deletedAt),
    deletedByUserId: state.deletedByUserId,
    hiddenAt: time(state.hiddenAt),
    hiddenByUserId: state.hiddenByUserId,
  })).sort((left, right) => left.annotationReplyId.localeCompare(right.annotationReplyId));
  return JSON.stringify({ anchors, states, importedReplyStates });
}

export function hasAnnotationTransition(snapshots: AnnotationRevisionSnapshot[]): boolean {
  for (let index = 1; index < snapshots.length; index += 1) {
    if (annotationSignature(snapshots[index - 1]) !== annotationSignature(snapshots[index])) return true;
  }
  return false;
}

export function planAnnotatedPostSave(input: {
  baseIds: string[];
  submittedMarkdown: string;
  confirmedDeletionIds: string[];
  currentStates: AnnotationRevisionState[];
  currentImportedReplyStates: ImportedReplyRevisionState[];
  actorUserId: string;
  at: Date;
}) {
  const validation = validateCanonicalAnnotationDocument(input.submittedMarkdown, input.baseIds, []);
  if (!validation.ok) throw new AnnotationIntegrityError();
  const submittedIds = validation.anchors.map((anchor) => anchor.annotationId);
  const delta = computeAnnotationDelta(input.baseIds, submittedIds);
  if (delta.unexpected.length > 0) throw new AnnotationIntegrityError();
  const confirmedDeletionIds = assertConfirmedAnnotationRemovals(
    input.baseIds,
    delta.removed,
    input.confirmedDeletionIds,
  );
  const stateIds = stableUnique(input.currentStates.map((state) => state.annotationId));
  if (stateIds.join("\n") !== stableUnique(input.baseIds).join("\n")
    || input.currentStates.length !== stateIds.length
    || input.currentImportedReplyStates.some((state) => !stateIds.includes(state.annotationId))) {
    throw new AnnotationIntegrityError();
  }
  const retained = new Set(delta.retained);
  return {
    delta,
    confirmedDeletionIds,
    retirements: planAnnotationRetirement(delta.removed, input.actorUserId, input.at, "POST_EDIT"),
    retainedStates: input.currentStates.filter((state) => retained.has(state.annotationId)),
    retainedImportedReplyStates: input.currentImportedReplyStates.filter((state) => retained.has(state.annotationId)),
  };
}

export type AnnotatedPostSavePlan = ReturnType<typeof planAnnotatedPostSave>;
