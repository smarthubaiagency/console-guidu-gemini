import type { AbstractIntlMessages } from "next-intl";

/**
 * Namespaces used by browser components (I1). Server components read every
 * message; the client receives only these, so the page payload does not
 * grow with each translated screen.
 */
export const CLIENT_NAMESPACES = [
  "common",
  "shell",
  "ui",
  "auth",
  "invite",
  "legal",
  "account",
  "team",
  "modules",
  "credentials",
  "channels",
  "mcp",
  "brand",
  "platformKeys",
  "crm",
  "helloWorld",
  "aiAgents",
  "aiConsole",
  "designLab",
  "analytics",
] as const;

export function clientMessages(
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  return Object.fromEntries(
    CLIENT_NAMESPACES.flatMap((ns) =>
      messages[ns] === undefined ? [] : [[ns, messages[ns]]],
    ),
  );
}
