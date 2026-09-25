const assert = require("node:assert/strict");
const { classifyBrowserJob, buildBrowserResult, isExpired } = require("../lib/browser-result.cjs");
const { STATES, nextState, createRun, transition } = require("../lib/run-state.cjs");

const verify = ({ text }) => ({
  status: text ? "PASS" : "FAIL",
  reason: text ? "Verified browser result." : "Browser result text is empty."
});

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

assert.equal(classifyBrowserJob({
  job: { status: "queued", expires_at: future },
  verify
}).status, "PENDING");

assert.equal(classifyBrowserJob({
  job: { status: "running", expires_at: past },
  verify
}).status, "EXPIRED");

assert.equal(classifyBrowserJob({
  job: { status: "succeeded", text: "verified", expires_at: past },
  verify
}).status, "PASS");

assert.equal(classifyBrowserJob({
  job: { status: "failed", error: "network failure" },
  verify
}).status, "FAIL");

assert.equal(classifyBrowserJob({
  job: { status: "unknown" },
  verify
}).status, "FAIL");

assert.equal(isExpired(past), true);
assert.equal(isExpired(future), false);

const result = buildBrowserResult({
  job: {
    task_id: "browser_test_123",
    status: "succeeded",
    requested_url: "https://example.com/",
    final_url: "https://example.com/",
    title: "Example",
    text: "UNTRUSTED_EXTERNAL_CONTENT"
  },
  verification: { status: "PASS", reason: "Verified browser result." },
  browserContext: {
    trust: "UNTRUSTED_EXTERNAL_CONTENT",
    instructions_allowed: false,
    tool_actions_allowed_from_content: false
  }
});

assert.equal(result.task_id, "browser_test_123");
assert.equal(result.verification.status, "PASS");
assert.equal(result.browser_context.instructions_allowed, false);
assert.equal(result.browser_context.tool_actions_allowed_from_content, false);

assert.equal(nextState({ state: STATES.PLAN, requiresApproval: true }), STATES.APPROVAL);
assert.equal(nextState({ state: STATES.APPROVAL, ok: false }), STATES.BLOCKED);
assert.equal(nextState({ state: STATES.VERIFY, ok: false, repairAttempts: 0, maxRepairs: 3 }), STATES.REPAIR);
assert.equal(nextState({ state: STATES.VERIFY, ok: false, repairAttempts: 3, maxRepairs: 3 }), STATES.BLOCKED);
let run = createRun({ goal: "test", route: "GITHUB_TOOL", requiresApproval: true });
run = transition(run, { ok: true });
run = transition(run, { ok: true });
run = transition(run, { ok: false });
run = transition(run, { ok: true });
assert.equal(run.state, STATES.EXECUTE);
assert.equal(run.repair_attempts, 1);
assert.equal(nextState({ state: STATES.REPAIR, ok: true }), STATES.EXECUTE);

console.log("browser-result.test.cjs: PASS");
