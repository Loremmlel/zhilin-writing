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
