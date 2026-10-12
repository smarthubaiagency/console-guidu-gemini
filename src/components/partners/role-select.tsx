import { PARTNER_ROLES, type PartnerRoleKey } from "@/core/permissions/matrix";

import { inputClass, labelClass } from "./form-classes";
import { PARTNER_ROLE_LABELS } from "./role-label";

/**
 * Role picker of a partner form. Translated callers pass `label` and
 * `roleLabels`; the defaults are the Portuguese texts.
 */
export function RoleSelect({
  defaultValue = "partner_admin",
  label = "Papel",
  name = "role",
  roleLabels = PARTNER_ROLE_LABELS,
}: Readonly<{
  defaultValue?: string;
  label?: string;
  name?: string;
  roleLabels?: Readonly<Record<PartnerRoleKey, string>>;
}>) {
  return (
    <label className={labelClass}>
      {label}
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        {PARTNER_ROLES.map((role) => (
          <option key={role} value={role}>
            {roleLabels[role]}
          </option>
        ))}
      </select>
    </label>
  );
}
