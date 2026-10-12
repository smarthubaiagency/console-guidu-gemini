import { createFakeTranslator } from "./fake";
import type { MachineTranslator } from "./types";

/**
 * Which machine translator this process uses (I6), from its environment:
 *
 * - `TRANSLATION_PROVIDER=fake`: the deterministic fake (tests and e2e).
 * - else `TRANSLATION_ANTHROPIC_API_KEY` set: Claude (Anthropic API).
 * - else none: the buttons are disabled with a notice, and a run that
 *   reaches a worker without the key fails with a clear message.
 *
 * The web reads only whether a provider exists; the key itself is read in
 * the worker when a job runs and never leaves the server.
 */

export type MachineProvider = "anthropic" | "fake";

type Env = Readonly<Record<string, string | undefined>>;

export function machineTranslationProvider(
  env: Env = process.env,
): MachineProvider | null {
  if (env.TRANSLATION_PROVIDER?.trim() === "fake") return "fake";
  if (env.TRANSLATION_ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return null;
}

export function machineTranslationConfigured(env: Env = process.env): boolean {
  return machineTranslationProvider(env) !== null;
}

/** The translator of this process, or null when none is configured. */
export async function getMachineTranslator(
  env: Env = process.env,
): Promise<MachineTranslator | null> {
  switch (machineTranslationProvider(env)) {
    case "fake":
      return createFakeTranslator();
    case "anthropic": {
      // Loaded only where a job translates; the web never needs the SDK.
      const { createAnthropicTranslator } = await import("./anthropic");
      return createAnthropicTranslator(
        env.TRANSLATION_ANTHROPIC_API_KEY!.trim(),
      );
    }
    default:
      return null;
  }
}
