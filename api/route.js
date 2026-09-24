function classifyIntent(task) {
  const text = task.toLowerCase();

  if (/(код|скрипт|программ|функци|javascript|python|sql|debug)/i.test(text)) {
    return { intent: "CODING", route: "CODING_AGENT" };
  }

  if (/(файл|pdf|документ|таблиц|xlsx|csv|docx)/i.test(text)) {
    return { intent: "FILE_ANALYSIS", route: "FILE_TOOL" };
  }

  if (/(сейчас|сегодня|последн|актуаль|новост|цена|курс|погода|интернет|исследуй|research)/i.test(text)) {
    return { intent: "WEB_RESEARCH", route: "WEB_RESEARCH" };
  }

  return { intent: "GENERAL", route: "LLM" };
}

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
