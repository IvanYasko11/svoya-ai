import { createRequire } from "node:module";
import { buildPlan } from "../lib/planner.js";
import { selectTools } from "../lib/tools.js";
import { executeTool } from "../lib/tool-executor.cjs";

const require = createRequire(import.meta.url);
const { requestWithFallback } = require("../scripts/provider-router.cjs");

import crypto from "node:crypto";

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
  if (/(github|репозитор|readme|коммит|ветк|pull request|файл в github)/i.test(text)) {
    return { intent: "GITHUB_TOOL", route: "GITHUB_TOOL" };
  }
  if (/(файл|pdf|документ|таблиц|xlsx|csv|docx)/i.test(text)) {
    return { intent: "FILE_ANALYSIS", route: "FILE_TOOL" };
  }
  if (/(github|репозитор|readme|коммит|ветк|pull request|файл в github)/i.test(text)) {
    return { intent: "GITHUB_TOOL", route: "GITHUB_TOOL" };
  }
  if (/(сейчас|сегодня|последн|актуаль|новост|цена|курс|погода|интернет|исследуй|research)/i.test(text)) {
    return { intent: "WEB_RESEARCH", route: "WEB_RESEARCH" };
  }
  return { intent: "GENERAL", route: "LLM" };
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getSession(req, res) {
  const cookieHeader = req.headers?.cookie || "";
  const match = cookieHeader.match(/(?:^|;\s*)svoya_session=([^;]+)/);
  let session = match ? decodeURIComponent(match[1]) : "";
  if (!session || session.length < 32) {
    session = crypto.randomBytes(32).toString("base64url");
    res.setHeader("Set-Cookie", "svoya_session=" + encodeURIComponent(session) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000");
  }
  return session;
}

async function createApproval({ task, taskId, session, dbKey }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hash(token);
  const response = await fetch("https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/coding_approvals", {
    method: "POST",
    headers: {
      apikey: dbKey,
      Authorization: "Bearer " + dbKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      task_hash: hash(task),
      task_id: taskId,
      approval_token_hash: tokenHash,
      session_hash: hash(session)
    })
  });
  if (!response.ok) throw new Error("Не удалось создать approval.");
  return token;
}

async function consumeApproval({ task, token, session, dbKey }) {
  if (!token || !session) return false;
  const tokenHash = hash(token);
  const sessionHash = hash(session);
  const response = await fetch(
    "https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/coding_approvals?approval_token_hash=eq." +
      encodeURIComponent(tokenHash) +
      "&task_hash=eq." + encodeURIComponent(hash(task)) +
      "&session_hash=eq." + encodeURIComponent(sessionHash) +
      "&status=eq.pending&expires_at=gt." + encodeURIComponent(new Date().toISOString()) +
      "&select=id,task_id&limit=1",
    {
      method: "PATCH",
      headers: {
        apikey: dbKey,
        Authorization: "Bearer " + dbKey,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ status: "used", used_at: new Date().toISOString() })
    }
  );
  if (!response.ok) return false;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1 ? rows[0].task_id : null;
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const task = typeof body?.task === "string" ? body.task.trim() : "";
    if (!task) return res.status(400).json({ error: "Пустая команда." });
    if (task.length > 12000) return res.status(400).json({ error: "Команда слишком длинная." });

    const risk = classifyRisk(task);
    const routing = classifyIntent(task);
    const plan = buildPlan(task, routing, risk);
    const tools = selectTools({ route: routing.route, riskLevel: risk.level });
    const confirmed = body?.confirmed === true;
    const preview = body?.preview === true;
    const isCoding = routing.route === "CODING_AGENT";
    const needsApproval = isCoding || risk.requiresConfirmation;
    const dbKey = process.env.SUPABASE_SECRET_KEY;
    const session = getSession(req, res);

    if (needsApproval && !confirmed && !(isCoding && preview)) {
      if (isCoding && !dbKey) {
        return res.status(503).json({ error: "Безопасное подтверждение временно недоступно: SUPABASE_SECRET_KEY не настроен." });
      }

      let approvalToken = null;
      if (isCoding) {
        const taskId = crypto.randomUUID();
        approvalToken = await createApproval({ task, taskId, session, dbKey });
        res.setHeader("Set-Cookie", [
          "svoya_session=" + encodeURIComponent(session) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000",
          "svoya_approval=" + encodeURIComponent(approvalToken) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600"
        ]);
      }

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

    let codingApply = false;
    let approvedTaskId = null;
    if (isCoding && confirmed) {
      if (!dbKey) return res.status(503).json({ error: "Безопасное подтверждение недоступно." });
      approvedTaskId = await consumeApproval({
        task,
        token: (() => {
          const cookieHeader = req.headers?.cookie || "";
          const match = cookieHeader.match(/(?:^|;\s*)svoya_approval=([^;]+)/);
          return match ? decodeURIComponent(match[1]) : "";
        })(),
        session,
        dbKey
      });
      if (approvedTaskId) {
        res.setHeader("Set-Cookie", "svoya_approval=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      }
      if (!approvedTaskId) {
        return res.status(403).json({
          ok: false,
          requires_confirmation: true,
          error: "Подтверждение недействительно, уже использовано или истекло. Запроси новое разрешение."
        });
      }
      codingApply = true;
    }

    if (routing.route === "GITHUB_TOOL") {
      if (risk.level !== "LOW") {
        return res.status(409).json({
          ok: false,
          requires_confirmation: true,
          risk_level: risk.level,
          intent: routing.intent,
          route: routing.route,
          error: "GitHub action requires explicit confirmation because the request is not read-only."
        });
      }

      const githubToolToken = process.env.GITHUB_TOOL_TOKEN;
      if (!githubToolToken) {
        return res.status(503).json({
          ok: false,
          intent: routing.intent,
          route: routing.route,
          plan,
          tools,
          error: "GitHub Tool Executor wired but GITHUB_TOOL_TOKEN is not configured."
        });
      }

      const match = task.match(/(?:прочитай|покажи|открой|прочесть|содержимое).*?(?:файл|file)?\s*([A-Za-z0-9_.\/-]+)?/i);
      const requestedPath = (match?.[1] || "").replace(/^\/+/, "");
      if (!requestedPath) {
        return res.status(400).json({
          ok: false,
          intent: routing.intent,
          route: routing.route,
          error: "Для GitHub read нужен путь к файлу, например README.md."
        });
      }

      const result = await executeTool({
        tool: "github_read",
        action: "read_file",
        input: { repository: "IvanYasko11/svoya-ai", path: requestedPath }
      });

      return res.status(200).json({
        ok: true,
        risk_level: risk.level,
        requires_confirmation: false,
        intent: routing.intent,
        route: routing.route,
        plan,
        tools,
        provider: "GitHub Tool Executor",
        model: null,
        answer: result.content,
        tool_result: {
          repository: result.repository,
          path: result.path,
          sha: result.sha
        }
      });
    }

    if (routing.route === "CODING_AGENT") {
      const githubToken = process.env.GITHUB_DISPATCH_TOKEN;
      if (!githubToken) {
        return res.status(503).json({ error: "Coding Agent не подключён: GITHUB_DISPATCH_TOKEN не настроен." });
      }

      const codingModel = process.env.CODING_AGENT_MODEL || "cohere/north-mini-code:free";
      const taskId = codingApply ? approvedTaskId : crypto.randomUUID();

      const dispatchResponse = await fetch("https://api.github.com/repos/IvanYasko11/svoya-ai/dispatches", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + githubToken,
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
      });

      if (!dispatchResponse.ok) {
        const raw = await dispatchResponse.text();
        let githubMessage = raw;
        try { githubMessage = (raw ? JSON.parse(raw)?.message : "") || raw; } catch {}
        return res.status(502).json({
          error: "GitHub не принял задачу Coding Agent.",
          github_status: dispatchResponse.status,
          details: githubMessage,
          hint: dispatchResponse.status === 401
            ? "GITHUB_DISPATCH_TOKEN недействителен или истёк."
            : dispatchResponse.status === 403
              ? "У токена GITHUB_DISPATCH_TOKEN недостаточно прав для repository_dispatch. Нужен доступ к репозиторию с правом Contents: Read and write."
              : "Проверь GITHUB_DISPATCH_TOKEN и доступ репозитория."
        });
      }

      const answer = codingApply
        ? "Coding Agent запущен с подтверждением. Изменения будут применены только в изолированную ветку и оформлены в Draft PR. В main ничего не сливается автоматически."
        : "Coding Agent подключён. Задача поставлена в безопасный preview-режим. Изменения в репозиторий не применяются.";

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
              plan,
              tools,
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
        requires_confirmation: false,
        apply_changes: codingApply,
        preview: !codingApply,
        intent: routing.intent,
        route: routing.route,
        plan,
        tools,
        provider: "GitHub Actions + OpenCode",
        model: codingModel,
        task_id: taskId,
        answer
      });
    }

    const preferredModel = process.env.SVOYA_OPERATOR_MODEL || process.env.OPENROUTER_MODEL || "openrouter/free";
    const providerResult = await requestWithFallback({
      model: preferredModel,
      messages: [
        {
          role: "system",
          content: "Ты — СВОЯ AI, личный AI-оператор. Отвечай на русском языке. Не выдумывай факты. Если нужны актуальные данные, используй подключённый Web Research route. Будь кратким и практичным."
        },
        { role: "user", content: task }
      ],
      temperature: 0
    });

    if (!providerResult.ok) {
      return res.status(providerResult.status).json({
        error: providerResult.code === "ACCOUNT_QUOTA_EXHAUSTED"
          ? "Квота текущего провайдера исчерпана, а другой настроенный провайдер не смог принять запрос."
          : "Все настроенные LLM-провайдеры недоступны.",
        provider: providerResult.provider,
        model: providerResult.model,
        attempts: providerResult.attempts
      });
    }

    let data = {};
    try { data = providerResult.text ? JSON.parse(providerResult.text) : {}; } catch {}
    const answer = data?.choices?.[0]?.message?.content || "Модель не вернула текст.";

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
            plan,
            selected_tool: routing.route,
            provider: providerResult.provider,
            model: providerResult.model,
            answer,
            verification_status: "pending"
          })
        });
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
      plan,
      provider: providerResult.provider,
      model: providerResult.model,
      answer
    });
  } catch (error) {
    return res.status(500).json({ error: "Ошибка соединения с LLM API: " + (error?.message || "неизвестная ошибка") });
  }
}
