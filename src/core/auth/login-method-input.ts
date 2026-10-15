import type { SettingKey } from "@/core/settings/catalog";
import type { SettingsInput } from "@/core/settings/service";

/**
 * Form of one login method card (CF5b): `method` names the method and the
 * `enabled` checkbox its state at the level.
 *
 * - Platform: checked offers it (`true`); unchecked goes back to the
 *   default, off.
 * - Partner: checked keeps what the platform offers (no row); unchecked
 *   hides it on the partner's hosts (`false`).
 */

export const LOGIN_METHOD_KEYS = {
  google: "auth.google",
  magicLink: "auth.magic_link",
} as const satisfies Record<string, SettingKey>;

export type LoginMethodKey = keyof typeof LOGIN_METHOD_KEYS;

export function isLoginMethodKey(value: unknown): value is LoginMethodKey {
  return typeof value === "string" && Object.hasOwn(LOGIN_METHOD_KEYS, value);
}

export function loginMethodInput(
  level: "platform" | "partner",
  formData: FormData,
): SettingsInput | null {
  const method = formData.get("method");
  if (!isLoginMethodKey(method)) return null;
  const enabled = formData.get("enabled") === "on";
  const value =
    level === "platform" ? (enabled ? true : null) : enabled ? null : false;
  return { values: { [LOGIN_METHOD_KEYS[method]]: value } };
}
