"use client";

import { AnnotationThread, type AnnotationCardView } from "./annotation-thread";

export function AnnotationReadonlyThread({ annotation, onLocate }: {
  annotation: AnnotationCardView;
  onLocate?: () => void;
}) {
  return <AnnotationThread annotation={annotation} onLocate={onLocate} readOnly />;
}
