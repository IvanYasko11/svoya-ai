const assert = require("node:assert/strict");
const { executeBrowserTool, normalizeUrl, normalizeAction, isAllowedHost } = require("../lib/browser-tool.cjs");

assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
assert.throws(() => normalizeUrl("javascript:alert(1)"), /http\/https/);
assert.throws(() => normalizeUrl("https://user:pass@example.com"), /Credential-bearing/);
assert.throws(() => normalizeAction("click"));
assert.equal(normalizeAction("open"), "open");
assert.equal(isAllowedHost("www.example.com", "example.com"), true);
assert.equal(isAllowedHost("evil.example.net", "example.com"), false);

(async () => {
  const result = await executeBrowserTool({
    action: "open",
    input: { url: "https://example.com" },
    allowedHosts: "example.com",
    browserImpl: async ({ url }) => ({ title: "Example", text: "BROWSER_TOOL_OK", url })
  });
  assert.equal(result.text, "BROWSER_TOOL_OK");
  assert.equal(result.title, "Example");
  await assert.rejects(
    executeBrowserTool({
      action: "open",
      input: { url: "https://not-allowed.example" },
      allowedHosts: "example.com",
      browserImpl: async () => ({})
    }),
    /not allowlisted/
  );
  console.log("SVOYA_BROWSER_TOOL_OK");
})();
