const assert = require("node:assert/strict");
const { STATES } = require("../lib/run-state.cjs");
const { startAutopilotRun, recordExecution, recordVerification, approve, beginRepair } = require("../lib/autopilot-run.cjs");

let run = startAutopilotRun({ goal: "test", route: "GITHUB_TOOL" });
assert.equal(run.state, STATES.EXECUTE);
run = recordExecution(run);
assert.equal(run.state, STATES.VERIFY);
run = recordVerification(run, { status: "PASS", reason: "checks passed" });
assert.equal(run.state, STATES.COMPLETE);
assert.ok(run.evidence.length >= 2);

let repair = startAutopilotRun({ goal: "repair", route: "CODING_AGENT", maxRepairs: 1 });
repair = recordExecution(repair);
repair = recordVerification(repair, { status: "FAIL", reason: "test failed" });
assert.equal(repair.state, STATES.REPAIR);
repair = beginRepair(repair);
assert.equal(repair.state, STATES.EXECUTE);
assert.equal(repair.repair_attempts, 1);
repair = recordExecution(repair);
repair = recordVerification(repair, { status: "FAIL", reason: "still failed" });
assert.equal(repair.state, STATES.BLOCKED);

let gated = startAutopilotRun({ goal: "write", route: "GITHUB_TOOL", requiresApproval: true });
assert.equal(gated.state, STATES.APPROVAL);
gated = approve(gated, true);
assert.equal(gated.state, STATES.EXECUTE);
console.log("autopilot-run.test.cjs: PASS");
