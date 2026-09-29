const assert = require("node:assert/strict");
const { dispatchBrowserTask } = require("../lib/browser-dispatch.cjs");

(async () => {
  let request;
  const result = await dispatchBrowserTask({
    action: "open",
    url: "https://example.com/",
    taskId: "browser_test_123",
    env: { GITHUB_DISPATCH_TOKEN: "test-token" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response("", { status: 200 });
    }
  });
  assert.equal(result.dispatched, true);
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  assert.equal(JSON.parse(request.options.body).event_type, "svoya-browser-task");
  console.log("SVOYA_BROWSER_DISPATCH_OK");
})();
