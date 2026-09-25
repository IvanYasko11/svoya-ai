const ALLOWED_ACTIONS = new Set(["open", "extract_text"]);
const MAX_TEXT = 50000;

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("URL is required.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https URLs are allowed.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are blocked.");
  return url.toString();
}

function isAllowedHost(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  const rules = String(allowedHosts || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return rules.some((rule) => host === rule || host.endsWith("." + rule));
}

function normalizeAction(action) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("Browser action is not allowlisted.");
  return action;
}

async function executeBrowserTool({ action, input = {}, browserImpl, allowedHosts = process.env.BROWSER_ALLOWED_HOSTS }) {
  normalizeAction(action);
  const url = normalizeUrl(input.url);
  const parsed = new URL(url);
  if (!isAllowedHost(parsed.hostname, allowedHosts)) {
    throw new Error("Browser host is not allowlisted. Configure BROWSER_ALLOWED_HOSTS.");
  }
  if (typeof browserImpl !== "function") throw new Error("Browser runtime is not configured.");
  const result = await browserImpl({ action, url });
  if (!result || typeof result !== "object") throw new Error("Browser runtime returned an invalid result.");
  const text = typeof result.text === "string" ? result.text.slice(0, MAX_TEXT) : "";
  return { action, url, title: typeof result.title === "string" ? result.title : "", text };
}

module.exports = { executeBrowserTool, normalizeUrl, normalizeAction, isAllowedHost, ALLOWED_ACTIONS };
