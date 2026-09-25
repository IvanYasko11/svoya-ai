const { STATES } = require("./run-state.cjs");

function verifyTransition({ state, verification }) {
  const result = String(verification?.status || "").toUpperCase();
  if (state !== STATES.VERIFY) {
    throw new Error("Verification can only finalize an EXECUTE result.");
  }
  return result === "PASS";
}

function buildEvidence({ verification, source = "verifier" }) {
  return {
    source,
    status: String(verification?.status || "FAIL").toUpperCase(),
    reason: String(verification?.reason || "").slice(0, 2000)
  };
}

module.exports = { verifyTransition, buildEvidence };
