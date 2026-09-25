const ALLOWED_READ_ACTIONS = new Set(["read_file", "list_files", "compare_commits"]);

function normalizeRepo(repo) {
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Invalid repository.");
  }
  return repo;
}

function normalizePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === ".")) {
    throw new Error("Invalid repository path.");
  }
  return path;
}

function getToken(env = process.env) {
  const token = String(env.GITHUB_TOOL_TOKEN || "").trim();
  if (!token) throw new Error("GITHUB_TOOL_TOKEN is not configured.");
  return token;
}

async function githubRequest({ path, env = process.env, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.github.com" + path, {
    headers: {
      Authorization: "Bearer " + getToken(env),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Svoya-AI-Tool-Executor"
    }
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

async function executeTool({ tool, action, input = {}, env = process.env, fetchImpl = fetch }) {
  if (tool !== "github_read") throw new Error("Only github_read is enabled in V1.8.1.");
  if (!ALLOWED_READ_ACTIONS.has(action)) throw new Error("Action is not allowlisted.");
  const repo = normalizeRepo(input.repository);

  const repoMeta = await githubRequest({ path: "/repos/" + repo, env, fetchImpl });
  if (repoMeta?.visibility !== "public") throw new Error("Only public repositories are enabled in V1.8.1.");

  if (action === "read_file") {
    const path = normalizePath(input.path);
    const ref = input.ref ? "?ref=" + encodeURIComponent(String(input.ref)) : "";
    const data = await githubRequest({
      path: "/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + ref,
      env, fetchImpl
    });
    if (Array.isArray(data) || data.encoding !== "base64") throw new Error("Requested path is not a supported text file.");
    return {
      repository: repo,
      path,
      sha: data.sha,
      content: Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8")
    };
  }

  if (action === "list_files") {
    const path = input.path ? "/" + normalizePath(input.path).split("/").map(encodeURIComponent).join("/") : "";
    const ref = input.ref ? "?ref=" + encodeURIComponent(String(input.ref)) : "";
    const data = await githubRequest({ path: "/repos/" + repo + "/contents" + path + ref, env, fetchImpl });
    if (!Array.isArray(data)) throw new Error("Requested path is not a directory.");
    return data.map((item) => ({ name: item.name, path: item.path, type: item.type, sha: item.sha }));
  }

  if (action === "compare_commits") {
    const base = String(input.base || "");
    const head = String(input.head || "");
    if (!base || !head || /[\r\n]/.test(base + head)) throw new Error("Invalid commit refs.");
    return githubRequest({
      path: "/repos/" + repo + "/compare/" + encodeURIComponent(base) + "..." + encodeURIComponent(head),
      env, fetchImpl
    });
  }
}

module.exports = { executeTool, normalizeRepo, normalizePath, ALLOWED_READ_ACTIONS };
