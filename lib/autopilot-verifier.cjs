const { STATES } = require("./run-state.cjs");

function normalizeVerification(verification = {}) {
  const status = String(verification.status || "FAIL").toUpperCase();
  return {
    source: String(verification.source || "verifier").slice(0, 120),
    status: status === "PASS" ? "PASS" : "FAIL",
    reason: String(verification.reason || "").slice(0, 2000)
  };
}

function verifyTransition({ state, verification }) {
  if (state !== STATES.VERIFY) throw new Error("Verification can only finalize a VERIFY state.");
  return normalizeVerification(verification).status === "PASS";
}

function buildEvidence({ verification, source }) {
  return normalizeVerification({ ...verification, source: source || verification?.source });
}

module.exports = { normalizeVerification, verifyTransition, buildEvidence };
