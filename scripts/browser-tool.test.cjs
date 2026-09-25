const assert = require("node:assert/strict");
const { executeBrowserTool, normalizeUrl, normalizeAction, isAllowedHost, isPrivateIp, validateBrowserTarget } = require("../lib/browser-tool.cjs");

assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
assert.throws(() => normalizeUrl("javascript:alert(1)"), /URL|Invalid/);
assert.throws(() => normalizeUrl("https://user:pass@example.com"), /./);
assert.throws(() => normalizeAction("click"));
assert.equal(normalizeAction("open"), "open");
assert.equal(isAllowedHost("www.example.com", "example.com"), true);
assert.equal(isAllowedHost("evil.example.net", "example.com"), false);
assert.equal(isPrivateIp("127.0.0.1"), true);
assert.equal(isPrivateIp("10.0.0.1"), true);
assert.equal(isPrivateIp("192.0.2.1"), true);
assert.equal(isPrivateIp("8.8.8.8"), false);

(async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const privateLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  assert.equal(await validateBrowserTarget("https://example.com", "example.com", { lookup: publicLookup }), "https://example.com/");
  await assert.rejects(validateBrowserTarget("https://example.com", "example.com", { lookup: privateLookup }), /private or reserved/);
  await assert.rejects(validateBrowserTarget("https://not-allowed.example", "example.com", { lookup: publicLookup }), /not allowlisted/);

  const result = await executeBrowserTool({
    action: "open",
    input: { url: "https://example.com" },
    allowedHosts: "example.com",
    lookup: publicLookup,
    browserImpl: async ({ url }) => ({ title: "Example", text: "BROWSER_TOOL_OK", url })
  });
  assert.equal(result.text, "BROWSER_TOOL_OK");
  assert.equal(result.title, "Example");
  console.log("SVOYA_BROWSER_TOOL_OK");
})();
