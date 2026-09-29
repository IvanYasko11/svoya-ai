const INJECTION_PATTERNS = Object.freeze([
  /ignore\s+(all|any|the|previous|prior)\s+(instructions|rules|messages)/i,
  /system\s+prompt/i,
  /developer\s+(message|instructions)/i,
  /reveal\s+(the\s+)?(system|developer)\s+prompt/i,
  /disregard\s+(the\s+)?(above|previous)/i,
  /follow\s+these\s+instructions/i,
  /you\s+are\s+now\s+(an?\s+)?(assistant|agent)/i,
  /send\s+(the|your)\s+(api|secret|access)\s*(key|token)?/i,
  /exfiltrat|steal\s+(the|your)\s+(secret|token|key)/i
]);

function detectPromptInjection(text) {
  const value = String(text || "");
  const matches = INJECTION_PATTERNS.filter((pattern) => pattern.test(value)).map((pattern) => pattern.source);
  return {
    detected: matches.length > 0,
    match_count: matches.length
  };
}

function buildUntrustedBrowserContext({ url, title = "", text = "" }) {
  const limited = String(text || "").slice(0, 50000);
  const risk = detectPromptInjection(limited);
  return {
    source: "browser",
    trust: "UNTRUSTED_EXTERNAL_CONTENT",
    instructions_allowed: false,
    tool_actions_allowed_from_content: false,
    prompt_injection: risk,
    url: String(url || ""),
    title: String(title || "").slice(0, 1000),
    text: limited
  };
}

module.exports = { detectPromptInjection, buildUntrustedBrowserContext };
