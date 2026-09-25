export function buildPlan(task, routing, risk) {
  let stages;
  if (routing.route === "CODING_AGENT") {
    stages = [
      "Понять задачу и ограничения.",
      "Запустить Coding Agent в изолированной ветке.",
      "Выполнить детерминированные проверки безопасности.",
      "Выполнить semantic verification.",
      "При FAIL — bounded Repair Loop, максимум 3 попытки.",
      "Собрать отчёт; для apply — создать Draft PR без авто-merge."
    ];
  } else if (routing.route === "WEB_RESEARCH") {
    stages = [
      "Сформулировать исследовательский вопрос.",
      "Собрать актуальные внешние источники.",
      "Сверить ключевые факты и указать неопределённость.",
      "Сформировать практический вывод."
    ];
  } else if (routing.route === "FILE_TOOL") {
    stages = [
      "Определить нужные файлы и формат результата.",
      "Прочитать только необходимые данные.",
      "Проверить результат.",
      "Вернуть результат без лишних изменений исходных файлов."
    ];
  } else {
    stages = [
      "Разобрать задачу и зафиксировать цель.",
      "Выбрать допустимый инструмент/модель.",
      "Проверить результат и не расширять область задачи.",
      "Сформировать ответ с учётом уровня риска."
    ];
  }

  return {
    version: "1.7",
    goal: task,
    risk_level: risk.level,
    route: routing.route,
    requires_confirmation: Boolean(risk.requiresConfirmation || routing.route === "CODING_AGENT"),
    stages,
    status: "planned"
  };
}
