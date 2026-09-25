const assert = require("node:assert/strict");
const { STATES } = require("../lib/run-state.cjs");
const { verifyTransition, buildEvidence } = require("../lib/autopilot-verifier.cjs");

assert.equal(verifyTransition({ state: STATES.VERIFY, verification: { status: "PASS" } }), true);
assert.equal(verifyTransition({ state: STATES.VERIFY, verification: { status: "FAIL" } }), false);
assert.throws(() => verifyTransition({ state: STATES.EXECUTE, verification: { status: "PASS" } }), /only finalize/);
assert.deepEqual(buildEvidence({ verification: { status: "PASS", reason: "deterministic checks passed" } }), {
  source: "verifier",
  status: "PASS",
  reason: "deterministic checks passed"
});
console.log("autopilot-verifier.test.cjs: PASS");
