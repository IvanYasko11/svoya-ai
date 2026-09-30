import intentRouting from '../lib/intent-routing.cjs';
const { classifyIntent } = intentRouting;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;

    const task = typeof body?.task === "string"
      ? body.task.trim()
      : "";

    if (!task) {
      return res.status(400).json({ error: "Пустая команда." });
    }

    if (task.length > 12000) {
      return res.status(400).json({ error: "Команда слишком длинная." });
    }

    const result = classifyIntent(task);

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch {
    return res.status(500).json({
      error: "Ошибка маршрутизации."
    });
  }
}

