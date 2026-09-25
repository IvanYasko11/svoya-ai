import { executeTool } from "../lib/tool-executor.cjs";

const ALLOWED_TOOLS = new Set(["github_read"]);
const ALLOWED_ACTIONS = new Set(["read_file", "list_files", "compare_commits"]);
const ALLOWED_REPOSITORIES = new Set(["IvanYasko11/svoya-ai"]);

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = parseBody(req);
    const tool = typeof body.tool === "string" ? body.tool : "";
    const action = typeof body.action === "string" ? body.action : "";
    const input = body.input && typeof body.input === "object" ? body.input : {};

    if (!ALLOWED_TOOLS.has(tool) || !ALLOWED_ACTIONS.has(action)) {
      return res.status(403).json({ ok: false, error: "Tool/action is not allowlisted." });
    }
    if (input.repository !== "IvanYasko11/svoya-ai") {
      return res.status(403).json({ ok: false, error: "Repository is not allowlisted for this endpoint." });
    }

    if (!process.env.GITHUB_TOOL_TOKEN) {
      return res.status(503).json({
        ok: false,
        error: "GitHub Tool Executor is wired but GITHUB_TOOL_TOKEN is not configured."
      });
    }

    const result = await executeTool({ tool, action, input });
    return res.status(200).json({ ok: true, tool, action, result });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    return res.status(status >= 400 && status < 600 ? status : 400).json({
      ok: false,
      error: error?.message || "Tool execution failed."
    });
  }
}
