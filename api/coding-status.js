export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const taskId = typeof req.query?.task_id === "string" ? req.query.task_id.trim() : "";
  if (!taskId) return res.status(400).json({ error: "task_id обязателен." });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return res.status(503).json({ error: "GITHUB_DISPATCH_TOKEN не настроен." });

  try {
    const response = await fetch(
      "https://api.github.com/repos/IvanYasko11/svoya-ai/actions/runs?event=repository_dispatch&per_page=20",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Svoya-AI"
        }
      }
    );

    const raw = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Не удалось получить статус Coding Agent.", details: raw });
    }

    const data = raw ? JSON.parse(raw) : {};
    const run = (data.workflow_runs || []).find((item) =>
      String(item.display_title || "").includes(taskId)
    );

    if (!run) {
      return res.status(200).json({
        ok: true,
        status: "queued",
        task_id: taskId,
        message: "Задача принята. GitHub Actions ещё не показал запуск."
      });
    }

    const status = run.status === "completed"
      ? (run.conclusion === "success" ? "completed" : "failed")
      : "running";

    return res.status(200).json({
      ok: true,
      task_id: taskId,
      status,
      conclusion: run.conclusion || null,
      run_id: run.id,
      url: run.html_url,
      created_at: run.created_at,
      updated_at: run.updated_at
    });
  } catch (error) {
    return res.status(500).json({
      error: `Ошибка проверки Coding Agent: ${error?.message || "неизвестная ошибка"}`
    });
  }
}
