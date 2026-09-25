const TOOL_REGISTRY = Object.freeze({
  github_read: {
    capability: "REPOSITORY_READ",
    risk: "LOW",
    actions: ["read_file", "list_files", "compare_commits"],
    confirmation: false
  },
  github_write: {
    capability: "REPOSITORY_WRITE",
    risk: "HIGH",
    actions: ["create_branch", "create_or_update_file", "create_draft_pr"],
    confirmation: true
  },
  web_research: {
    capability: "WEB_RESEARCH",
    risk: "LOW",
    actions: ["search", "open", "compare_sources"],
    confirmation: false
  },
  file_analysis: {
    capability: "FILE_ANALYSIS",
    risk: "MEDIUM",
    actions: ["read", "extract", "transform"],
    confirmation: true
  },
  coding_agent: {
    capability: "CODE_EXECUTION",
    risk: "HIGH",
    actions: ["generate", "test", "repair"],
    confirmation: true
  }
});

export function getToolRegistry() {
  return TOOL_REGISTRY;
}

export function selectTools({ route, riskLevel }) {
  const mapping = {
    CODING_AGENT: ["coding_agent", "github_read", "github_write"],
    GITHUB_TOOL: ["github_read"],
    WEB_RESEARCH: ["web_research"],
    FILE_ANALYSIS: ["file_analysis"],
    GENERAL: []
  };
  const names = mapping[route] || [];
  return names.map((name) => {
    const tool = TOOL_REGISTRY[name];
    return {
      name,
      capability: tool.capability,
      actions: tool.actions,
      risk: tool.risk,
      confirmation: tool.confirmation || riskLevel === "HIGH"
    };
  });
}
