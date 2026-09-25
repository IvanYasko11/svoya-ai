const TERMINAL = new Set(["succeeded", "failed", "expired"]);

function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return false;
  return now.getTime() >= expires;
}

function classifyBrowserJob({ job, allowedHosts, now = new Date(), verify }) {
  const status = String(job?.status || "");
  if (!job || !status) {
    return { status: "FAIL", reason: "Browser job payload is missing." };
  }

  if (!TERMINAL.has(status) && isExpired(job.expires_at, now)) {
    return { status: "EXPIRED", reason: "Browser job exceeded its result TTL." };
  }

  if (status === "succeeded") {
    const result = verify({
      action: job.action,
      finalUrl: job.final_url,
      title: job.title,
      text: job.text,
      allowedHosts
    });
    return {
      status: result.status === "PASS" ? "PASS" : "FAIL",
      reason: result.reason
    };
  }

  if (status === "failed") {
    return { status: "FAIL", reason: job.error || "Browser job failed." };
  }

  if (status === "expired") {
    return { status: "EXPIRED", reason: job.error || "Browser job expired." };
  }

  if (status === "queued" || status === "running") {
    return { status: "PENDING", reason: "Browser job is not complete." };
  }

  return { status: "FAIL", reason: "Unknown browser job status." };
}

function buildBrowserResult({ job, verification, browserContext }) {
  return {
    task_id: job.task_id,
    status: job.status,
    requested_url: job.requested_url,
    final_url: job.final_url || null,
    title: job.title || null,
    text: job.text || null,
    error: job.error || null,
    verification,
    browser_context: browserContext || null
  };
}

module.exports = {
  TERMINAL,
  isExpired,
  classifyBrowserJob,
  buildBrowserResult
};
