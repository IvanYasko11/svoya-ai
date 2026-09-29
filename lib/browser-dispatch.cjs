async function dispatchBrowserTask({ action, url, taskId, env = process.env, fetchImpl = fetch }) {
  if (!taskId || !/^[A-Za-z0-9_-]{8,100}$/.test(taskId)) throw new Error("Invalid browser task id.");
  const response = await fetchImpl("https://api.github.com/repos/IvanYasko11/svoya-ai/dispatches", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + String(env.GITHUB_DISPATCH_TOKEN || "").trim(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "Svoya-AI-Browser-Executor"
    },
    body: JSON.stringify({
      event_type: "svoya-browser-task",
      client_payload: { task_id: taskId, action, url }
    })
  });
  if (!response.ok) {
    const error = new Error("Failed to dispatch browser task.");
    error.status = response.status;
    throw error;
  }
  return { task_id: taskId, dispatched: true };
}
module.exports = { dispatchBrowserTask };
