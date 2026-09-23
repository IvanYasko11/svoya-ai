export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "OPENAI_API_KEY не настроен в Vercel. Добавь его в Settings → Environment Variables."
    });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const task = typeof body?.task === "string" ? body.task.trim() : "";

  if (!task) {
    return res.status(400).json({ error: "Пустая команда." });
  }

  if (task.length > 12000) {
    return res.status(400).json({ error: "Команда слишком длинная." });
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions:
          "Ты — СВОЯ AI, личный AI-оператор. Отвечай на русском языке. " +
          "Не выдумывай факты. Если для ответа нужны актуальные данные, прямо скажи, что на этом этапе веб-поиск ещё не подключён. " +
          "Будь кратким и практичным. Это V0.4: пока у тебя только базовый LLM без внешних инструментов.",
        input: task,
        store: false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Ошибка LLM API."
      });
    }

    return res.status(200).json({
      ok: true,
      model,
      answer: data.output_text || "Модель не вернула текст."
    });
  } catch (error) {
    return res.status(500).json({
      error: "Ошибка соединения с LLM API."
    });
  }
}
