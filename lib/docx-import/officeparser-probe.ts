export const OFFICEPARSER_PROBE_GATES = [
  "inlineRange",
  "adjacentDistinct",
  "nestedOverlapDistinct",
  "stableCommentId",
  "immediateReplyParent",
  "resolvedState",
  "noSelectedTextSearch",
] as const;

export type OfficeparserProbeGate = (typeof OFFICEPARSER_PROBE_GATES)[number];

export type OfficeparserProbeReport = {
  version: string;
  gates: Record<OfficeparserProbeGate, boolean>;
  evidence?: Partial<Record<OfficeparserProbeGate, string>>;
  productionEligible?: boolean;
};

export function officeparserProductionEligible(report: OfficeparserProbeReport) {
  return OFFICEPARSER_PROBE_GATES.every((gate) => report.gates[gate] === true);
}
