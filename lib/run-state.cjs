const STATES = Object.freeze({ PLAN: "PLAN", APPROVAL: "APPROVAL", EXECUTE: "EXECUTE", VERIFY: "VERIFY", REPAIR: "REPAIR", COMPLETE: "COMPLETE", BLOCKED: "BLOCKED" });

function nextState({ state, ok, requiresApproval = false, repairAttempts = 0, maxRepairs = 3, evidence = [] }) {
  if (state === STATES.PLAN) return requiresApproval ? STATES.APPROVAL : STATES.EXECUTE;
  if (state === STATES.APPROVAL) return ok ? STATES.EXECUTE : STATES.BLOCKED;
  if (state === STATES.EXECUTE) return STATES.VERIFY;
  if (state === STATES.VERIFY) return ok ? STATES.COMPLETE : repairAttempts < maxRepairs ? STATES.REPAIR : STATES.BLOCKED;
  if (state === STATES.REPAIR) return STATES.EXECUTE;
  if (state === STATES.COMPLETE || state === STATES.BLOCKED) return state;
  throw new Error("Unknown run state.");
}

function createRun({ goal, route, requiresApproval = false, maxRepairs = 3 }) {
  if (!goal || typeof goal !== "string") throw new Error("Goal is required.");
  if (!route || typeof route !== "string") throw new Error("Route is required.");
  return { version: "2.0-core", goal, route, state: requiresApproval ? STATES.APPROVAL : STATES.EXECUTE, repair_attempts: 0, max_repairs: Math.max(0, Math.min(3, Number(maxRepairs) || 0)), evidence: [] };
}

function transition(run, { ok, requiresApproval = false, evidence = "" }) {
  const next = nextState({ state: run.state, ok: Boolean(ok), requiresApproval, repairAttempts: run.repair_attempts, maxRepairs: run.max_repairs });
  const updated = { ...run, state: next };
  if (run.state === STATES.REPAIR && next === STATES.EXECUTE) updated.repair_attempts += 1;
  if (evidence) updated.evidence = [...run.evidence, String(evidence).slice(0, 2000)].slice(-20);
  return updated;
}

module.exports = { STATES, nextState, createRun, transition };
