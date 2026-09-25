const assert = require("node:assert/strict");
const { executeBrowserTool, normalizeUrl, normalizeAction } = require("../lib/browser-tool.cjs");

assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
assert.throws(() => normalizeUrl("javascript:alert(1)"), /http\/https/);
assert.throws(() => normalizeUrl("https://user:pass@example.com"), /Credential-bearing/);
assert.throws(() => normalizeAction("click"));
assert.equal(normalizeAction("open"), "open");

(async () => {
  const result = await executeBrowserTool({
    action: "open",
    input: { url: "https://example.com" },
    browserImpl: async ({ url }) => ({ title: "Example", text: "BROWSER_TOOL_OK", url })
  });
  assert.equal(result.text, "BROWSER_TOOL_OK");
  assert.equal(result.title, "Example");
  console.log("SVOYA_BROWSER_TOOL_OK");
})();
