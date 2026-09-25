const dns = require("node:dns").promises;

const ALLOWED_ACTIONS = new Set(["open", "extract_text"]);
const MAX_TEXT = 50000;
const PRIVATE_RANGES = [
  [0x00000000, 0x00ffffff], [0x0a000000, 0x0affffff], [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff], [0xa9fe0000, 0xa9feffff], [0xac100000, 0xac1fffff],
  [0xc0a80000, 0xc0a8ffff], [0xc0000000, 0xc00000ff], [0xc0000200, 0xc00002ff],
  [0xc6336400, 0xc63364ff], [0xcb007100, 0xcb0071ff], [0xe0000000, 0xffffffff]
];

function ipv4ToInt(ip) {
  const p = String(ip).split(".");
  if (p.length !== 4 || p.some((x) => !/^\d+$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((n, x) => ((n * 256) + Number(x)) >>> 0, 0);
}
function isPrivateIp(ip) {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return PRIVATE_RANGES.some(([a,b]) => v4 >= a && v4 <= b);
  const x = String(ip).toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") ||
    x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb");
}
function isAllowedHost(hostname, allowedHosts) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const rules = String(allowedHosts || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return rules.some((rule) => host === rule || host.endsWith("." + rule));
}
async function validateBrowserTarget(rawUrl, allowedHosts, { lookup = dns.lookup } = {}) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https URLs are allowed.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are blocked.");
  if (!isAllowedHost(url.hostname, allowedHosts)) throw new Error("Browser host is not allowlisted.");
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("Browser host did not resolve.");
  if (records.some((r) => isPrivateIp(r.address))) throw new Error("Browser target resolves to a private or reserved network address.");
  return url.toString();
}
function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("URL is required.");
  return new URL(value).toString();
}
function normalizeAction(action) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("Browser action is not allowlisted.");
  return action;
}
async function executeBrowserTool({ action, input = {}, browserImpl, allowedHosts = process.env.BROWSER_ALLOWED_HOSTS, lookup }) {
  normalizeAction(action);
  const url = normalizeUrl(input.url);
  await validateBrowserTarget(url, allowedHosts, lookup ? { lookup } : {});
  if (typeof browserImpl !== "function") throw new Error("Browser runtime is not configured.");
  const result = await browserImpl({ action, url });
  if (!result || typeof result !== "object") throw new Error("Browser runtime returned an invalid result.");
  return {
    action, url,
    title: typeof result.title === "string" ? result.title : "",
    text: typeof result.text === "string" ? result.text.slice(0, MAX_TEXT) : ""
  };
}
module.exports = { executeBrowserTool, normalizeUrl, normalizeAction, isAllowedHost, isPrivateIp, validateBrowserTarget, ALLOWED_ACTIONS };
