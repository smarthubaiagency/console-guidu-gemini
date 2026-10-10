import { PARTNER_ROLES } from "@/core/permissions/matrix";

import { inputClass, labelClass } from "./action-form";
import { PARTNER_ROLE_LABELS } from "./role-label";

export function RoleSelect({
  defaultValue = "partner_admin",
  label = "Papel",
  name = "role",
}: Readonly<{ defaultValue?: string; label?: string; name?: string }>) {
  return (
    <label className={labelClass}>
      {label}
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        {PARTNER_ROLES.map((role) => (
          <option key={role} value={role}>
            {PARTNER_ROLE_LABELS[role]}
          </option>
        ))}
      </select>
    </label>
  );
}
