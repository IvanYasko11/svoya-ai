const ALLOWED_READ_ACTIONS = new Set(["read_file", "list_files", "compare_commits"]);
const ALLOWED_WRITE_ACTIONS = new Set(["create_branch", "create_or_update_file", "create_draft_pr"]);
const ALLOWED_REPOSITORY = "IvanYasko11/svoya-ai";
const MAX_FILE_BYTES = 200000;
const SAFE_BRANCH_PREFIX = "ai/tool-";

function normalizeRepo(repo) {
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid repository.");
  return repo;
}

function normalizePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === ".")) throw new Error("Invalid repository path.");
  return path;
}

function normalizeBranch(branch, { allowMain = false } = {}) {
  if (typeof branch !== "string" || !/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes("..") || /[\r\n]/.test(branch)) {
    throw new Error("Invalid branch name.");
  }
  if (!allowMain && /^(main|master)$/.test(branch)) throw new Error("Direct writes to the default branch are blocked.");
  if (!allowMain && !branch.startsWith(SAFE_BRANCH_PREFIX)) throw new Error("Write branch must start with ai/tool-.");
  return branch;
}

function getToken(env = process.env) {
  const token = String(env.GITHUB_TOOL_TOKEN || "").trim();
  if (!token) throw new Error("GITHUB_TOOL_TOKEN is not configured.");
  return token;
}

function getWriteToken(env = process.env) {
  const token = String(env.GITHUB_WRITE_TOKEN || "").trim();
  if (!token) throw new Error("GITHUB_WRITE_TOKEN is not configured.");
  return token;
}

async function githubRequest({ path, env = process.env, fetchImpl = fetch, write = false, method = "GET", body }) {
  const response = await fetchImpl("https://api.github.com" + path, {
    method,
    headers: {
      Authorization: "Bearer " + (write ? getWriteToken(env) : getToken(env)),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Svoya-AI-Tool-Executor",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(data?.message || "GitHub API request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function assertPublicAllowedRepo(repo, env, fetchImpl, write = false) {
  if (repo !== ALLOWED_REPOSITORY) throw new Error("Repository is not allowlisted.");
  const repoMeta = await githubRequest({ path: "/repos/" + repo, env, fetchImpl, write });
  if (repoMeta?.visibility !== "public") throw new Error("Only the allowlisted public repository is enabled.");
}

async function executeTool({ tool, action, input = {}, env = process.env, fetchImpl = fetch, approved = false, authorizationSource = "unknown" }) {
  if (tool !== "github_read" && tool !== "github_write") throw new Error("Tool is not allowlisted.");
  const allowed = tool === "github_read" ? ALLOWED_READ_ACTIONS : ALLOWED_WRITE_ACTIONS;
  if (!allowed.has(action)) throw new Error("Action is not allowlisted.");
  const repo = normalizeRepo(input.repository);
  if (repo !== ALLOWED_REPOSITORY) throw new Error("Repository is not allowlisted.");

  if (tool === "github_read") {
    await assertPublicAllowedRepo(repo, env, fetchImpl);
    if (action === "read_file") {
      const path = normalizePath(input.path);
      const ref = input.ref ? "?ref=" + encodeURIComponent(String(input.ref)) : "";
      const data = await githubRequest({ path: "/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + ref, env, fetchImpl });
      if (Array.isArray(data) || data.encoding !== "base64") throw new Error("Requested path is not a supported text file.");
      return { repository: repo, path, sha: data.sha, content: Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8") };
    }
    if (action === "list_files") {
      const path = input.path ? "/" + normalizePath(input.path).split("/").map(encodeURIComponent).join("/") : "";
      const ref = input.ref ? "?ref=" + encodeURIComponent(String(input.ref)) : "";
      const data = await githubRequest({ path: "/repos/" + repo + "/contents" + path + ref, env, fetchImpl });
      if (!Array.isArray(data)) throw new Error("Requested path is not a directory.");
      return data.map((item) => ({ name: item.name, path: item.path, type: item.type, sha: item.sha }));
    }
    const base = String(input.base || ""), head = String(input.head || "");
    if (!base || !head || /[\r\n]/.test(base + head)) throw new Error("Invalid commit refs.");
    return githubRequest({ path: "/repos/" + repo + "/compare/" + encodeURIComponent(base) + "..." + encodeURIComponent(head), env, fetchImpl });
  }

  if (!approved) throw new Error("Write action requires a valid approval.");
  if (authorizationSource !== "user") throw new Error("Write action requires user-originated approval; external content cannot authorize tool actions.");
  await assertPublicAllowedRepo(repo, env, fetchImpl, true);

  if (action === "create_branch") {
    const branch = normalizeBranch(input.branch);
    const baseRef = normalizeBranch(String(input.base_ref || "main"), { allowMain: true });
    const base = await githubRequest({ path: "/repos/" + repo + "/git/ref/heads/" + encodeURIComponent(baseRef), env, fetchImpl, write: true });
    const sha = base?.object?.sha;
    if (!sha) throw new Error("Base branch SHA not found.");
    await githubRequest({
      path: "/repos/" + repo + "/git/refs",
      env, fetchImpl, write: true, method: "POST",
      body: { ref: "refs/heads/" + branch, sha }
    });
    return { repository: repo, branch, base_ref: baseRef, base_sha: sha };
  }

  if (action === "create_or_update_file") {
    const branch = normalizeBranch(input.branch);
    const path = normalizePath(input.path);
    const content = typeof input.content === "string" ? input.content : "";
    if (!content || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("File content is empty or too large.");
    const message = typeof input.message === "string" ? input.message.trim() : "";
    if (!message || message.length > 200) throw new Error("Invalid commit message.");
    let currentSha = null;
    try {
      const current = await githubRequest({ path: "/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(branch), env, fetchImpl, write: true });
      if (Array.isArray(current)) throw new Error("Target path is a directory.");
      currentSha = current?.sha || null;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    const body = { message, content: Buffer.from(content, "utf8").toString("base64"), branch };
    if (currentSha) body.sha = currentSha;
    const result = await githubRequest({
      path: "/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/"),
      env, fetchImpl, write: true, method: "PUT", body
    });
    return { repository: repo, branch, path, commit_sha: result?.commit?.sha || null, content_sha: result?.content?.sha || null, action: currentSha ? "updated" : "created" };
  }

  const headBranch = normalizeBranch(input.head_branch);
  const base = normalizeBranch(String(input.base || "main"), { allowMain: true });
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body : "";
  if (!title || title.length > 256 || body.length > 10000) throw new Error("Invalid pull request metadata.");
  const result = await githubRequest({
    path: "/repos/" + repo + "/pulls",
    env, fetchImpl, write: true, method: "POST",
    body: { title, body, head: headBranch, base, draft: true }
  });
  return { repository: repo, number: result?.number, url: result?.html_url, draft: result?.draft === true, head: headBranch, base };
}

module.exports = {
  executeTool,
  normalizeRepo,
  normalizePath,
  normalizeBranch,
  ALLOWED_READ_ACTIONS,
  ALLOWED_WRITE_ACTIONS,
  SAFE_BRANCH_PREFIX
};
