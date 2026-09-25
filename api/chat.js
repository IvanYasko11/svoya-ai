import { createRequire } from "node:module";
import { buildPlan } from "../lib/planner.js";
import { selectTools } from "../lib/tools.js";
import { executeTool } from "../lib/tool-executor.cjs";

const require = createRequire(import.meta.url);
const { requestWithFallback } = require("../scripts/provider-router.cjs");
const { dispatchBrowserTask } = require("../lib/browser-dispatch.cjs");
const { normalizeUrl, isAllowedHost, verifyBrowserResult } = require("../lib/browser-tool.cjs");
const { buildUntrustedBrowserContext } = require("../lib/browser-content.cjs");
const { classifyBrowserJob, buildBrowserResult } = require("../lib/browser-result.cjs");

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
  if (/(браузер|browser|сайт|website|открой сайт|перейди на)/i.test(text)) {
    return { intent: "BROWSER", route: "BROWSER_TOOL" };
  }
  if (/(github|репозитор|readme|коммит|ветк|pull request|файл в github)/i.test(text)) {
    return { intent: "GITHUB_TOOL", route: "GITHUB_TOOL" };
  }
  if (/(файл|pdf|документ|таблиц|xlsx|csv|docx)/i.test(text)) {
    return { intent: "FILE_ANALYSIS", route: "FILE_TOOL" };
  }
  if (/(сейчас|сегодня|последн|актуаль|новост|цена|курс|погода|интернет|исследуй|research)/i.test(text)) {
    return { intent: "WEB_RESEARCH", route: "WEB_RESEARCH" };
  }
  return { intent: "GENERAL", route: "LLM" };
}

function classifyGithubWrite(task) {
  const text = task.toLowerCase();
  if (!/(github|репозитор|ветк|pull request|pr|файл)/i.test(text)) return false;
  return /(создай.*ветк|создать.*ветк|нов.*ветк|create.*branch|создай.*файл|создать.*файл|измени.*файл|обнови.*файл|create.*file|update.*file|draft.*pr|чернов.*pull request|создай.*pull request)/i.test(text);
}

function parseGithubWrite(task) {
  const text = task.trim();
  const branchMatch = text.match(/(?:ветк[ау]|branch)\s+(?:с\s+именем\s+)?([A-Za-z0-9._/-]+)/i);
  const fileMatch = text.match(/(?:файл|file)\s+([A-Za-z0-9_.\/-]+)/i);
  const contentMatch = text.match(/(?:содержимым|content)\s*[:=]\s*([\s\S]+)$/i);
  const titleMatch = text.match(/(?:название|title)\s*[:=]\s*([^\n]+)/i);
  const bodyMatch = text.match(/(?:описание|body)\s*[:=]\s*([\s\S]+)$/i);
  if (branchMatch && /(создай|создать|create|нов)/i.test(text) && !fileMatch) {
    return { action: "create_branch", input: { repository: "IvanYasko11/svoya-ai", branch: branchMatch[1], base_ref: "main" } };
  }
  if (fileMatch && contentMatch && branchMatch) {
    return {
      action: "create_or_update_file",
      input: {
        repository: "IvanYasko11/svoya-ai",
        branch: branchMatch[1],
        path: fileMatch[1],
        content: contentMatch[1],
        message: "SVOYA AI safe write"
      }
    };
  }
  if (/(draft.*pr|чернов.*pull request|создай.*pull request)/i.test(text) && branchMatch) {
    return {
      action: "create_draft_pr",
      input: {
        repository: "IvanYasko11/svoya-ai",
        head_branch: branchMatch[1],
        base: "main",
        title: titleMatch?.[1]?.trim() || "СВОЯ AI safe write",
        body: bodyMatch?.[1]?.trim() || "Draft PR created by approved СВОЯ AI tool execution."
      }
    };
  }
  return null;
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

async function createBrowserJob({ taskId, action, url, session, dbKey }) {
  const response = await fetch("https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/browser_jobs", {
    method: "POST",
    headers: {
      apikey: dbKey,
      Authorization: "Bearer " + dbKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      id: taskId,
      task_id: taskId,
      status: "queued",
      action,
      requested_url: url,
      session_hash: hash(session)
    })
  });
  if (!response.ok) throw new Error("Не удалось создать browser job.");
}

async function updateBrowserJob({ taskId, status, fields = {}, dbKey, session }) {
  const query = "task_id=eq." + encodeURIComponent(taskId) +
    "&session_hash=eq." + encodeURIComponent(hash(session));
  const response = await fetch("https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/browser_jobs?" + query, {
    method: "PATCH",
    headers: {
      apikey: dbKey,
      Authorization: "Bearer " + dbKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ status, ...fields })
  });
  if (!response.ok) throw new Error("Не удалось обновить browser job.");
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

  if (req.method === "GET") {
    const taskId = typeof req.query?.browser_task_id === "string" ? req.query.browser_task_id : "";
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(taskId)) return res.status(400).json({ error: "Invalid browser task id." });
    const dbKey = process.env.SUPABASE_SECRET_KEY;
    if (!dbKey) return res.status(503).json({ error: "Browser result storage is not configured." });
    const session = getSession(req, res);
    const response = await fetch(
      "https://wmyvdrxsqrntkxurzgps.supabase.co/rest/v1/browser_jobs?task_id=eq." +
      encodeURIComponent(taskId) + "&session_hash=eq." + encodeURIComponent(hash(session)) +
      "&select=id,task_id,status,action,requested_url,final_url,title,text,error,verification_status,verification_reason,created_at,started_at,completed_at,expires_at&limit=1",
      { headers: { apikey: dbKey, Authorization: "Bearer " + dbKey } }
    );
    if (!response.ok) return res.status(502).json({ error: "Не удалось получить browser job." });
    const rows = await response.json();
    if (!rows.length) return res.status(404).json({ error: "Browser task not found." });
    const job = rows[0];
    const verification = classifyBrowserJob({
      job,
      allowedHosts: process.env.BROWSER_ALLOWED_HOSTS,
      verify: verifyBrowserResult
    });
    if (verification.status === "EXPIRED" && job.status !== "expired") {
      await updateBrowserJob({
        taskId,
        status: "expired",
        fields: {
          error: verification.reason,
          verification_status: "FAIL",
          verification_reason: verification.reason,
          completed_at: new Date().toISOString()
        },
        dbKey,
        session
      }).catch(() => {});
      job.status = "expired";
      job.error = verification.reason;
    }
    const browserContext = job.status === "succeeded"
      ? buildUntrustedBrowserContext({ url: job.final_url, title: job.title, text: job.text })
      : null;
    return res.status(200).json({
      ok: true,
      browser_job: job,
      result: buildBrowserResult({ job, verification, browserContext })
    });
  }

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
    const browserTask = routing.route === "BROWSER_TOOL";
    const githubWrite = classifyGithubWrite(task);
    const approvalCapable = isCoding || githubWrite || browserTask;
    const needsApproval = approvalCapable || risk.requiresConfirmation;
    const dbKey = process.env.SUPABASE_SECRET_KEY;
    const session = getSession(req, res);

    if (needsApproval && !confirmed && !(isCoding && preview)) {
      if (isCoding && !dbKey) {
        return res.status(503).json({ error: "Безопасное подтверждение временно недоступно: SUPABASE_SECRET_KEY не настроен." });
      }

      let approvalToken = null;
      if (approvalCapable) {
        if (!dbKey) return res.status(503).json({ error: "Безопасное подтверждение временно недоступно: SUPABASE_SECRET_KEY не настроен." });
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
        confirmation_type: isCoding ? "CODING_APPLY" : githubWrite ? "GITHUB_WRITE" : browserTask ? "BROWSER_ACTION" : risk.level,
        error: isCoding
          ? "Coding Agent готов выполнить задачу, но применение изменений требует отдельного подтверждения."
          : githubWrite
            ? "GitHub Safe Write подготовлен, но запись требует отдельного подтверждения."
            : risk.level === "HIGH"
            ? "Команда относится к действиям высокого риска. Требуется явное подтверждение непосредственно перед выполнением."
            : "Команда относится к действиям среднего риска. Требуется явное подтверждение непосредственно перед выполнением."
      });
    }

    let codingApply = false;
    let githubWriteApproved = false;
    let approvedTaskId = null;
    if (approvalCapable && confirmed) {
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
      if (isCoding) codingApply = true;
      if (githubWrite) githubWriteApproved = true;
    } else if (confirmed && risk.requiresConfirmation) {
      return res.status(403).json({
        ok: false,
        requires_confirmation: true,
        error: "Это действие требует отдельного подтверждения через поддерживаемый безопасный workflow."
      });
    }

    if (routing.route === "BROWSER_TOOL") {
      if (!browserTask) return res.status(400).json({ ok: false, error: "Invalid browser task." });
      if (!confirmed || !approvedTaskId) return res.status(403).json({ ok: false, requires_confirmation: true, error: "Browser action requires explicit approval." });
      const urlMatch = task.match(/https?:\\/\\/[^\\s"'<>]+/i);
      if (!urlMatch) return res.status(400).json({ ok: false, error: "Для browser-задачи нужен явный http(s) URL." });
      const url = normalizeUrl(urlMatch[0].replace(/[),.;]+$/, ""));
      if (!isAllowedHost(new URL(url).hostname, process.env.BROWSER_ALLOWED_HOSTS)) {
        return res.status(403).json({ ok: false, error: "Browser host is not allowlisted. Configure BROWSER_ALLOWED_HOSTS." });
      }
      const action = /текст|содержим|extract/i.test(task) ? "extract_text" : "open";
      const taskId = crypto.randomBytes(12).toString("hex");
      if (!dbKey) return res.status(503).json({ ok: false, error: "Browser result storage is not configured: SUPABASE_SECRET_KEY is required." });
      await createBrowserJob({ taskId, action, url, session, dbKey });
      let dispatched;
      try {
        dispatched = await dispatchBrowserTask({ action, url, taskId });
      } catch (error) {
        await updateBrowserJob({
          taskId,
          status: "failed",
          fields: { error: String(error?.message || error), completed_at: new Date().toISOString() },
          dbKey,
          session
        }).catch(() => {});
        throw error;
      }
      return res.status(202).json({
        ok: true,
        async: true,
        task_id: taskId,
        risk_level: risk.level,
        requires_confirmation: false,
        intent: routing.intent,
        route: routing.route,
        plan,
        tools,
        provider: "GitHub Actions + Playwright",
        answer: "Browser job поставлен в очередь. Результат будет сформирован после выполнения Playwright job.",
        browser_result: dispatched,
        result_url: "/api/chat?browser_task_id=" + encodeURIComponent(taskId)
      });
    }

    if (routing.route === "GITHUB_TOOL") {
      if (githubWrite) {
        if (!githubWriteApproved) {
          return res.status(403).json({ ok: false, requires_confirmation: true, error: "GitHub write approval is required." });
        }
        const githubWriteToken = process.env.GITHUB_WRITE_TOKEN;
        if (!githubWriteToken) {
          return res.status(503).json({ ok: false, intent: routing.intent, route: routing.route, error: "GitHub Safe Write Executor requires GITHUB_WRITE_TOKEN." });
        }
        const parsed = parseGithubWrite(task);
        if (!parsed) {
          return res.status(400).json({
            ok: false,
            intent: routing.intent,
            route: routing.route,
            error: "Не удалось безопасно разобрать GitHub write-команду. Для файла используй формат: «создай файл path в ветке ai/tool-name с содержимым: ...»."
          });
        }
        const result = await executeTool({
          tool: "github_write",
          action: parsed.action,
          input: parsed.input,
          approved: true,
          authorizationSource: "user"
        });
        return res.status(200).json({
          ok: true,
          risk_level: risk.level,
          requires_confirmation: false,
          intent: routing.intent,
          route: routing.route,
          plan,
          tools,
          provider: "GitHub Safe Write Executor",
          model: null,
          answer: "GitHub write выполнен в разрешённом контуре.",
          tool_result: result
        });
      }

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
