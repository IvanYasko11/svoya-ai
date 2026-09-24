function classifyRisk(task) {
  const text = task.toLowerCase();
  const normalizedText = text.replace(/[\s.,!?;:'"()\[\]{}<>_\-+=*\/\\]+/g, "");

  const highRiskPatterns = [
    /(парол|password|api[-_ ]?key|секрет|secret|токен|token)/i,
    /(оплат|плат[еи]|перевод|покупк|payment|purchase)/i,
    /(удал[иь]|delete|стереть|уничтож)/i,
    /(опубликов|publish|размести|выложи)/i,
    /(войти|логин|login|авториз|sign[ -]?in)/i
  ];

  const mediumRiskPatterns = [
    /(отправ[ьи]|send|сообщен|email|электронн.*почт|почт[аые]|письм)/i,
    /(измен[ьи]|modify|обнов[ьи]|update)/i,
    /(создай.*файл|измен[ьи].*файл|файл.*измен)/i,
    /(запусти|execute|выполн)/i,
    /(броузер|browser|сайт|website)/i
  ];

  if (highRiskPatterns.some((pattern) => pattern.test(text) || pattern.test(normalizedText))) {
    return { level: "HIGH", requiresConfirmation: true };
  }

  if (mediumRiskPatterns.some((pattern) => pattern.test(text) || pattern.test(normalizedText))) {
    return { level: "MEDIUM", requiresConfirmation: true };
  }

  return { level: "LOW", requiresConfirmation: false };
}

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

import crypto from "node:crypto";

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const task = typeof body?.task === "string" ? body.task.trim() : "";

    if (!task) return res.status(400).json({ error: "Пустая команда." });
    if (task.length > 12000) return res.status(400).json({ error: "Команда слишком длинная." });

    const risk = classifyRisk(task);
    const routing = classifyIntent(task);
    const confirmed = body?.confirmed === true;
    const preview = body?.preview === true;
    const isCoding = routing.route === "CODING_AGENT";
    const needsApproval = isCoding || risk.requiresConfirmation;
    const codingApply = isCoding && confirmed && !preview;

    if (needsApproval && !confirmed && !(isCoding && preview)) {
      return res.status(409).json({
        ok: false,
        risk_level: risk.level,
        requires_confirmation: true,
        intent: routing.intent,
        route: routing.route,
        confirmation_type: isCoding ? "CODING_APPLY" : risk.level,
        error: isCoding
          ? "Coding Agent готов выполнить задачу, но применение изменений требует отдельного подтверждения."
          : risk.level === "HIGH"
            ? "Команда относится к действиям высокого риска. Требуется явное подтверждение непосредственно перед выполнением."
            : "Команда относится к действиям среднего риска. Требуется явное подтверждение непосредственно перед выполнением."
      });
    }

    if (routing.route === "CODING_AGENT") {
      const githubToken = process.env.GITHUB_DISPATCH_TOKEN;

      if (!githubToken) {
        return res.status(503).json({
          error: "Coding Agent не подключён: GITHUB_DISPATCH_TOKEN не настроен."
        });
      }

      const codingModel = process.env.CODING_AGENT_MODEL || "cohere/north-mini-code:free";
      const taskId = crypto.randomUUID();

      const dispatchResponse = await fetch(
        "https://api.github.com/repos/IvanYasko11/svoya-ai/dispatches",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "Svoya-AI"
          },
          body: JSON.stringify({
            event_type: "svoya-coding-task",
            client_payload: {
              task,
              task_id: taskId,
              model: codingModel,
              apply_changes: codingApply ? "true" : "false"
            }
          })
        }
      );

      if (!dispatchResponse.ok) {
        const raw = await dispatchResponse.text();
        let githubMessage = raw;
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          githubMessage = parsed?.message || raw;
        } catch {}

        return res.status(502).json({
          error: "GitHub не принял задачу Coding Agent.",
          github_status: dispatchResponse.status,
          details: githubMessage,
          hint:
            dispatchResponse.status === 401
              ? "GITHUB_DISPATCH_TOKEN недействителен или истёк."
              : dispatchResponse.status === 403
                ? "У токена GITHUB_DISPATCH_TOKEN недостаточно прав для repository_dispatch. Нужен доступ к репозиторию с правом Contents: Read and write."
                : "Проверь GITHUB_DISPATCH_TOKEN и доступ репозитория."
        });
      }

      const answer = codingApply
        ? "Coding Agent запущен с подтверждением. Изменения будут применены только в изолированную ветку и оформлены в Draft PR. В main ничего не сливается автоматически."
        : "Coding Agent подключён. Задача поставлена в безопасный preview-режим. Изменения в репозиторий не применяются. Чтобы разрешить применение, повторите задачу с отдельным подтверждением.";

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
              intent: routing.intent,
              language: "ru",
              risk_level: risk.level,
              selected_tool: routing.route,
              provider: "GitHub Actions + OpenCode",
              model: codingModel,
              answer,
              verification_status: "queued"
            })
          });
        } catch (memoryError) {
          console.error("Database save failed:", memoryError?.message || memoryError);
        }
      }

      return res.status(202).json({
        ok: true,
        risk_level: risk.level,
        requires_confirmation: needsApproval && !confirmed && !preview,
        apply_changes: codingApply,
        preview: isCoding && !codingApply,
        intent: routing.intent,
        route: routing.route,
        provider: "GitHub Actions + OpenCode",
        model: codingModel,
        task_id: taskId,
        answer
      });
    }

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
        const memoryResponse = await fetch("https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/tasks", {
          method: "POST",
          headers: {
            apikey: dbKey,
            Authorization: "Bearer " + dbKey,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            user_request: task,
            intent: routing.intent,
            language: "ru",
            risk_level: risk.level,
            selected_tool: routing.route,
            provider: useOpenRouter ? "OpenRouter" : "OpenAI",
            model,
            answer: answer || "Модель не вернула текст.",
            verification_status: "pending"
          })
        });

        if (!memoryResponse.ok) {
          console.error("Database save failed:", await memoryResponse.text());
        }
      } catch (memoryError) {
        console.error("Database save failed:", memoryError?.message || memoryError);
      }
    }

    return res.status(200).json({
      ok: true,
      risk_level: risk.level,
      requires_confirmation: risk.requiresConfirmation,
      intent: routing.intent,
      route: routing.route,
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
