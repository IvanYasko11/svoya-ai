export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const task = typeof body?.task === "string" ? body.task.trim() : "";

    if (!task) return res.status(400).json({ error: "Пустая команда." });
    if (task.length > 12000) return res.status(400).json({ error: "Команда слишком длинная." });

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const openAIKey = process.env.OPENAI_API_KEY;

    if (!openRouterKey && !openAIKey) {
      return res.status(503).json({
        error: "Не настроен API-провайдер. Добавь OPENROUTER_API_KEY в Vercel → Environment Variables."
      });
    }

    const useOpenRouter = Boolean(openRouterKey);
    const apiKey = useOpenRouter ? openRouterKey : openAIKey;
    const endpoint = useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/responses";
    const model = useOpenRouter
      ? (process.env.OPENROUTER_MODEL || "openrouter/free")
      : (process.env.OPENAI_MODEL || "gpt-5.6-luna");

    const requestBody = useOpenRouter
      ? {
          model,
          messages: [
            {
              role: "system",
              content:
                "Ты — СВОЯ AI, личный AI-оператор. Отвечай на русском языке. " +
                "Не выдумывай факты. Если для ответа нужны актуальные данные, скажи, что веб-поиск ещё не подключён. " +
                "Будь кратким и практичным."
            },
            { role: "user", content: task }
          ]
        }
      : {
          model,
          instructions:
            "Ты — СВОЯ AI, личный AI-оператор. Отвечай на русском языке. " +
            "Не выдумывай факты. Если для ответа нужны актуальные данные, скажи, что веб-поиск ещё не подключён. " +
            "Будь кратким и практичным.",
          input: task,
          store: false
        };

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    };

    if (useOpenRouter) {
      headers["HTTP-Referer"] = "https://svoya-ai.vercel.app";
      headers["X-Title"] = "Svoya AI";
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || raw || `LLM API вернул HTTP ${response.status}.`
      });
    }

    const answer = useOpenRouter
      ? data?.choices?.[0]?.message?.content
      : data?.output_text;

    const dbKey = process.env["SUPABASE_SECRET_KEY"];
    if (dbKey) {
      try {
        await fetch("https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/tasks", {
          method: "POST",
          headers: {
            apikey: dbKey,
            Authorization: "Bearer " + dbKey,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            user_request: task,
            language: "ru",
            risk_level: "LOW",
            provider: useOpenRouter ? "OpenRouter" : "OpenAI",
            model,
            answer: answer || "Модель не вернула текст.",
            verification_status: "pending"
          })
        });
      } catch (memoryError) {
        console.error("Database save failed:", memoryError?.message || memoryError);
      }
    }

    return res.status(200).json({
      ok: true,
      provider: useOpenRouter ? "OpenRouter" : "OpenAI",
      model,
      answer: answer || "Модель не вернула текст."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Ошибка соединения с LLM API: ${error?.message || "неизвестная ошибка"}`
    });
  }
}
