# СВОЯ AI

Личный AI-оператор: User → Operator → Planner/Router → Risk Gate → Tool/Agent → Verifier → Repair → Memory → Result.

## Текущий этап

V1.9-R — Browser Tool hardened: approval binding, SSRF/DNS guards, redirect/request checks, session-bound result persistence.

### Реально работает

- Vercel Operator/API.
- Risk Gate HIGH/MEDIUM/LOW и подтверждение для опасных действий.
- Smart Router: GENERAL / WEB_RESEARCH / FILE_ANALYSIS / CODING_AGENT / GITHUB_TOOL.
- Coding Agent через GitHub Actions + OpenCode.
- Safe Apply: изолированная ветка и Draft PR; main автоматически не сливается.
- Semantic Verifier и bounded Repair Loop до 3 попыток.
- Broker изолирует ключи провайдеров от дочернего Coding/Repair Agent.
- Provider Router: OpenRouter + Groq + Gemini + Mistral при наличии соответствующих ключей.
- OpenRouter account-level free quota распознаётся отдельно: при ошибке free-models-per-day система не тратит дополнительные запросы на другие модели того же аккаунта и переходит к другому настроенному провайдеру.
- Planner v1.7 возвращает структурированный план до исполнения и сохраняет его в Supabase tasks.
- Supabase memory/tasks и approval state.

## Архитектура

```
User
  ↓
Operator
  ↓
Planner + Smart Router
  ↓
Risk Gate / Approval
  ↓
Tool or Coding Agent
  ↓
Provider Router
  ├─ OpenRouter
  ├─ Groq
  ├─ Gemini
  └─ Mistral
  ↓
Verifier
  ↓
Repair Loop (≤3)
  ↓
Memory / Draft PR
  ↓
Result
```

## Почему V1.6 застрял

Мы сначала решали проблему как «плохая модель / нужен ещё один free model». Red Team показал другой класс ошибки: бесплатная квота OpenRouter привязана к аккаунту, поэтому переключение между free-моделями внутри OpenRouter не меняет лимит. Дополнительные retry при такой ошибке только расходуют квоту.

Исправление: Provider Router + классификация account-level quota, с fail-fast внутри провайдера и переходом к другому провайдеру.

Отдельно исправлена глобальная concurrency-группа GitHub Actions: теперь один task не отменяет другой task.

## Ключи провайдеров

GitHub Actions secrets:

- OPENROUTER_API_KEY
- GROQ_API_KEY
- GEMINI_API_KEY
- MISTRAL_API_KEY

Vercel Operator использует те же имена окружения только в серверной части. Секреты не хранятся в репозитории и удаляются из окружения дочернего OpenCode процесса.

## Проверки

Provider Router имеет отдельные Node unit tests в scripts/provider-router.test.cjs. Проверяются account-level quota, временный 429, переход на другой провайдер и non-retryable auth error.

## Ограничения, которые ещё не закрыты

- GitHub Actions job всё ещё имеет более широкие права, чем идеальная двухконтурная схема trusted/untrusted jobs.
- Нет полноценной авторизации пользователя; approval cookie связывает подтверждение с браузерной сессией, но не с аккаунтом.
- Shell-среда Coding Agent всё ещё обладает сетевой властью; broker уменьшает риск утечки ключа, но не заменяет sandbox.
- Semantic Verifier проверяет соответствие изменения задаче и структуру результата, а не фактическую истинность бизнес-утверждений.
- WEB_RESEARCH и FILE_TOOL пока представлены маршрутизацией/планом, а не полноценными исполнителями.

## Текущий следующий уровень

V1.8 — Tool Layer. Первый шаг реализован: allowlisted capability registry (`lib/tools.js`) выбирает допустимые инструменты по маршруту и уровню риска. Оператор теперь возвращает этот tool-plan вместе с execution plan.

Следующий gate V1.8: подключить реальный GitHub MCP/connector execution adapter с read-only по умолчанию, а write-действия — только после существующего approval flow. Не подключать произвольные MCP-серверы и не давать агенту универсальный доступ.

Старый Unity-проект IvanYasko11/emocional_game не трогать.
\n\n### Следующий этап\n\n- Result Poller + Verifier for browser jobs.\n- Treat webpage content as untrusted input before any LLM reasoning.\n- Then V2.0 Genius Autopilot: broader tool selection, bounded execution, verification and repair.\n

## V1.9-R9 — Web Prompt Injection

Browser results are treated as untrusted external data. The result API exposes an explicit `UNTRUSTED_EXTERNAL_CONTENT` context with `instructions_allowed=false` and `tool_actions_allowed_from_content=false`. Common prompt-injection patterns are detected for downstream verification. Webpage text is never an authorization source for tool actions.

## Следующий gate

V1.10 — Result Poller + Verifier for browser jobs. Polling now has an explicit state machine (queued/running/succeeded/failed/expired), TTL handling, deterministic verification, and a stable result envelope. R10 browser-to-tool trust-boundary hardening is now implemented: write tools require user-originated approval and explicitly reject external/browser content as an authorization source. After R10 verification: V2.0 Genius Autopilot.
