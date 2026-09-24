export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
  if (!task) return res.status(400).json({ error: "Пустая coding-задача." });
  if (task.length > 12000) return res.status(400).json({ error: "Задача слишком длинная." });

  const risk = typeof req.body?.risk_level === "string" ? req.body.risk_level : "MEDIUM";
  const confirmed = req.body?.confirmed === true;

  if (risk !== "LOW" && !confirmed) {
    return res.status(409).json({
      ok: false,
      requires_confirmation: true,
      error: "Перед запуском Coding Agent требуется явное подтверждение."
    });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: "GITHUB_DISPATCH_TOKEN ещё не настроен в Vercel."
    });
  }

  const response = await fetch(
    "https://api.github.com/repos/IvanYasko11/svoya-ai/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "Svoya-AI"
      },
      body: JSON.stringify({
        event_type: "svoya-coding-task",
        client_payload: {
          task,
          model: req.body?.model || "cohere/north-mini-code:free",
          apply_changes: confirmed ? "true" : "false"
        }
      })
    }
  );

  if (!response.ok) {
    const raw = await response.text();
    return res.status(response.status).json({
      error: "GitHub не принял задачу.",
      details: raw
    });
  }

  return res.status(202).json({
    ok: true,
    status: "queued",
    message: "Coding Agent запущен.",
    route: "CODING_AGENT"
  });
}
