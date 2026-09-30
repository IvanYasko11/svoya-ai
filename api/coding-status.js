import operatorAuth from '../lib/operator-auth.cjs';
import cloudConfig from '../cloud-config.js';
export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user=await operatorAuth.requireOperator(req,res);
  if(!user)return;
  const taskId = typeof req.query?.task_id === "string" ? req.query.task_id.trim().toLowerCase() : "";
  if (!operatorAuth.UUID.test(taskId)) return res.status(400).json({ error: "Нужен корректный task_id." });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return res.status(503).json({ error: "GITHUB_DISPATCH_TOKEN не настроен." });

  try {
    const own=await fetch(cloudConfig.url+'/rest/v1/operator_jobs?task_id=eq.'+encodeURIComponent(taskId)+'&user_id=eq.'+encodeURIComponent(user.id)+'&select=task_id,user_id',{
      headers:{apikey:cloudConfig.key,Authorization:req.headers.authorization},signal:AbortSignal.timeout(10000)
    });
    if(!own.ok)return res.status(503).json({error:'Не удалось проверить владельца задачи.'});
    const owned=await own.json();
    if(!Array.isArray(owned)||owned.length!==1||owned[0].task_id!==taskId||owned[0].user_id!==user.id)return res.status(404).json({error:'Задача не найдена в этом аккаунте.'});
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
      return res.status(response.status===429?429:502).json({ error: "Не удалось получить статус Coding Agent.",github_status:response.status });
    }

    const data = raw ? JSON.parse(raw) : {};
    const run = (data.workflow_runs || []).find((item) =>
      new RegExp('\\b'+taskId+'\\b','i').test(String(item.display_title || ""))
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

    let pr = null;
    if (status === "completed") {
      const branch = "ai/coding-" + taskId;
      try {
        const prResponse = await fetch(
          "https://api.github.com/repos/IvanYasko11/svoya-ai/pulls?state=open&head=IvanYasko11:" + encodeURIComponent(branch) + "&per_page=1",
          {
            headers: {
              Authorization: "Bearer " + token,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "Svoya-AI"
            }
          }
        );
        if (prResponse.ok) {
          const prs = await prResponse.json();
          if (Array.isArray(prs) && prs[0]) {
            pr = {
              number: prs[0].number,
              url: prs[0].html_url,
              draft: Boolean(prs[0].draft),
              head: prs[0].head?.ref || branch
            };
          }
        }
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      task_id: taskId,
      status,
      conclusion: run.conclusion || null,
      run_id: run.id,
      url: run.html_url,
      pr,
      created_at: run.created_at,
      updated_at: run.updated_at
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Не удалось проверить Coding Agent. Повтори позже.'
    });
  }
}
