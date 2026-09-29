const { STATES, createRun, transition } = require("./run-state.cjs");
const { buildEvidence } = require("./autopilot-verifier.cjs");

function startAutopilotRun({ goal, route, requiresApproval = false, maxRepairs = 3 }) {
  return createRun({ goal, route, requiresApproval, maxRepairs });
}

function recordExecution(run, { ok = true, reason = "execution completed" } = {}) {
  if (run.state !== STATES.EXECUTE) throw new Error("Execution evidence requires EXECUTE state.");
  return transition(run, { ok, evidence: JSON.stringify(buildEvidence({ verification: { status: ok ? "PASS" : "FAIL", reason }, source: "executor" })) });
}

function recordVerification(run, verification) {
  if (run.state !== STATES.VERIFY) throw new Error("Verification evidence requires VERIFY state.");
  const evidence = buildEvidence({ verification, source: verification?.source || "verifier" });
  return transition(run, { ok: evidence.status === "PASS", evidence: JSON.stringify(evidence) });
}

function approve(run, approved) {
  if (run.state !== STATES.APPROVAL) throw new Error("Approval requires APPROVAL state.");
  return transition(run, { ok: approved, evidence: approved ? "user approval accepted" : "approval denied" });
}

function beginRepair(run, reason = "verification failed") {
  if (run.state !== STATES.REPAIR) throw new Error("Repair requires REPAIR state.");
  return transition(run, { ok: true, evidence: reason });
}

module.exports = { startAutopilotRun, recordExecution, recordVerification, approve, beginRepair };
