import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OFFICEPARSER_PROBE_GATES,
  officeparserProductionEligible,
  type OfficeparserProbeReport,
} from "../lib/docx-import/officeparser-probe.ts";
import { generateProbeFixtures, writeDocxFixture } from "../scripts/fixtures/generate-docx-fixtures.mjs";
import { runOfficeparserProbe } from "../scripts/probe-officeparser.mjs";

const EXPECTED_GATES = [
  "inlineRange",
  "adjacentDistinct",
  "nestedOverlapDistinct",
  "stableCommentId",
  "immediateReplyParent",
  "resolvedState",
  "noSelectedTextSearch",
] as const;

test("officeparser eligibility requires exactly the seven approved comment capabilities", () => {
  assert.deepEqual(OFFICEPARSER_PROBE_GATES, EXPECTED_GATES);

  const passingGates = Object.fromEntries(EXPECTED_GATES.map((gate) => [gate, true]));
  const passing = {
    version: "7.8.0",
    gates: passingGates,
  } as OfficeparserProbeReport;

  assert.equal(officeparserProductionEligible(passing), true);
  for (const failedGate of EXPECTED_GATES) {
    assert.equal(officeparserProductionEligible({
      ...passing,
      gates: { ...passing.gates, [failedGate]: false },
    }), false, failedGate);
  }
});

test("officeparser probe reports remain JSON serializable", () => {
  const report: OfficeparserProbeReport = {
    version: "7.8.0",
    gates: Object.fromEntries(EXPECTED_GATES.map((gate) => [gate, false])) as OfficeparserProbeReport["gates"],
    evidence: Object.fromEntries(EXPECTED_GATES.map((gate) => [gate, "not exposed"])),
    productionEligible: false,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
});

test("DOCX probe fixture bytes are deterministic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhilin-docx-probe-"));
  const firstPath = join(directory, "a.docx");
  const secondPath = join(directory, "b.docx");
  const parts = {
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": "<document>固定内容</document>",
  };

  try {
    await writeDocxFixture(firstPath, parts);
    await writeDocxFixture(secondPath, parts);
    assert.deepEqual(await readFile(firstPath), await readFile(secondPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("officeparser 7.8.0 fails the production gate on exact ranges and threads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhilin-officeparser-probe-"));
  try {
    await generateProbeFixtures(directory);
    const report = await runOfficeparserProbe(directory);

    assert.equal(report.version, "7.8.0");
    assert.deepEqual(report.gates, {
      inlineRange: false,
      adjacentDistinct: true,
      nestedOverlapDistinct: false,
      stableCommentId: true,
      immediateReplyParent: false,
      resolvedState: false,
      noSelectedTextSearch: false,
    });
    assert.equal(report.productionEligible, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
