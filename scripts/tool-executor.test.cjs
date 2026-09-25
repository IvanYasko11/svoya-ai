const assert = require("node:assert/strict");
const { executeTool, normalizeRepo, normalizePath, normalizeBranch } = require("../lib/tool-executor.cjs");

assert.equal(normalizeRepo("IvanYasko11/svoya-ai"), "IvanYasko11/svoya-ai");
assert.throws(() => normalizeRepo("IvanYasko11/svoya-ai/extra"));
assert.throws(() => normalizePath("../secrets"));
assert.throws(() => normalizePath("/etc/passwd"));
assert.equal(normalizeBranch("ai/tool-test"), "ai/tool-test");
assert.throws(() => normalizeBranch("main"));
assert.throws(() => normalizeBranch("feature/test"));

let calls = [];
const fakeFetch = async (url, options) => {
  calls.push({ url, options });
  let payload;
  if (url.endsWith("/repos/IvanYasko11/svoya-ai")) payload = { visibility: "public" };
  else if (url.includes("/contents/README.md")) payload = { name: "README.md", path: "README.md", sha: "abc", encoding: "base64", content: Buffer.from("SVOYA_TOOL_OK", "utf8").toString("base64") };
  else if (url.includes("/git/ref/heads/main")) payload = { object: { sha: "base-sha" } };
  else if (url.endsWith("/git/refs")) payload = { ref: "refs/heads/ai/tool-test" };
  else if (url.includes("/contents/test.txt?ref=ai%2Ftool-test")) return new Response("missing", { status: 404 });
  else if (url.includes("/contents/test.txt")) payload = { sha: "old-sha" };
  else if (url.includes("/pulls")) payload = { number: 7, html_url: "https://github.com/IvanYasko11/svoya-ai/pull/7", draft: true };
  else payload = {};
  return new Response(JSON.stringify(payload), { status: 200 });
};

(async () => {
  const result = await executeTool({
    tool: "github_read",
    action: "read_file",
    input: { repository: "IvanYasko11/svoya-ai", path: "README.md" },
    env: { GITHUB_TOOL_TOKEN: "test-token" },
    fetchImpl: fakeFetch
  });
  assert.equal(result.content, "SVOYA_TOOL_OK");

  await assert.rejects(
    executeTool({
      tool: "github_write",
      action: "create_branch",
      input: { repository: "IvanYasko11/svoya-ai", branch: "ai/tool-test" },
      env: { GITHUB_WRITE_TOKEN: "test-token" },
      fetchImpl: fakeFetch
    }),
    /valid approval/
  );

  const branchResult = await executeTool({
    tool: "github_write",
    action: "create_branch",
    input: { repository: "IvanYasko11/svoya-ai", branch: "ai/tool-test" },
    env: { GITHUB_WRITE_TOKEN: "test-token", GITHUB_TOOL_TOKEN: "read-token" },
    fetchImpl: fakeFetch,
    approved: true
  });
  assert.equal(branchResult.base_sha, "base-sha");

  const fileResult = await executeTool({
    tool: "github_write",
    action: "create_or_update_file",
    input: { repository: "IvanYasko11/svoya-ai", branch: "ai/tool-test", path: "test.txt", content: "SAFE_WRITE_OK", message: "test safe write" },
    env: { GITHUB_WRITE_TOKEN: "test-token", GITHUB_TOOL_TOKEN: "read-token" },
    fetchImpl: fakeFetch,
    approved: true
  });
  assert.equal(fileResult.action, "created");

  const prResult = await executeTool({
    tool: "github_write",
    action: "create_draft_pr",
    input: { repository: "IvanYasko11/svoya-ai", head_branch: "ai/tool-test", title: "Safe write test", body: "test" },
    env: { GITHUB_WRITE_TOKEN: "test-token" },
    fetchImpl: fakeFetch,
    approved: true
  });
  assert.equal(prResult.draft, true);

  assert.ok(calls.some((c) => c.options?.headers?.Authorization === "Bearer test-token"));
  console.log("SVOYA_TOOL_EXECUTOR_OK");
})();
