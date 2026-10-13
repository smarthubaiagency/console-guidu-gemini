/**
 * Catalog of the tools an agent may list in `integration.tools`
 * (especificação de agentes §8). The list of an agent is an allowlist the
 * engine checks again on every call (A2); a new tool enters here, in one
 * place. There is no generic HTTP, SQL or file tool.
 */

export type AgentKind = "assistant" | "guid";

export const AGENT_TOOLS = {
  create_contact: ["guid"],
  add_note: ["guid"],
  update_contact_property: ["guid"],
  set_conversation_variable: ["guid", "assistant"],
  // Waits for tags in the CRM (D-AG-22).
  add_tag: ["guid"],
  think: ["guid", "assistant"],
  score_lead: ["guid"],
  handoff: ["guid"],
  search_knowledge: ["guid", "assistant"],
  // Reading of the workspace with the permissions of who asks (MCP tools).
  workspace_read: ["assistant"],
  propose_operation: ["assistant"],
} as const satisfies Record<string, readonly AgentKind[]>;

export type AgentTool = keyof typeof AGENT_TOOLS;

export const AGENT_TOOL_IDS = Object.keys(AGENT_TOOLS) as [
  AgentTool,
  ...AgentTool[],
];

export function toolAllowedFor(tool: AgentTool, kind: AgentKind): boolean {
  return (AGENT_TOOLS[tool] as readonly AgentKind[]).includes(kind);
}
