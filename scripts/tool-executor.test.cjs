const assert = require("node:assert/strict");
const { executeTool, normalizeRepo, normalizePath } = require("../lib/tool-executor.cjs");

assert.equal(normalizeRepo("IvanYasko11/svoya-ai"), "IvanYasko11/svoya-ai");
assert.throws(() => normalizeRepo("IvanYasko11/svoya-ai/extra"));
assert.throws(() => normalizePath("../secrets"));
assert.throws(() => normalizePath("/etc/passwd"));

let calls = [];
const fakeFetch = async (url, options) => {
  calls.push({ url, options });
  const payload = url.endsWith("/repos/IvanYasko11/svoya-ai")
    ? { visibility: "public" }
    : { name: "README.md",
    path: "README.md",
    sha: "abc",
    encoding: "base64",
    content: Buffer.from("SVOYA_TOOL_OK", "utf8").toString("base64") };
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
  assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers.Authorization, /^Bearer /);

  await assert.rejects(
    executeTool({
      tool: "github_write",
      action: "create_branch",
      input: { repository: "IvanYasko11/svoya-ai", branch: "test" },
      env: { GITHUB_TOOL_TOKEN: "test-token" },
      fetchImpl: fakeFetch
    }),
    /Only github_read/
  );

  console.log("SVOYA_TOOL_EXECUTOR_OK");
})();
