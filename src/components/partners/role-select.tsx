import { PARTNER_ROLES, type PartnerRoleKey } from "@/core/permissions/matrix";

import { PARTNER_ROLE_LABELS } from "./role-label";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

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
    <Label className="flex-col items-start">
      {label}
      <NativeSelect name={name} defaultValue={defaultValue} className="w-full">
        {PARTNER_ROLES.map((role) => (
          <NativeSelectOption key={role} value={role}>
            {roleLabels[role]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Label>
  );
}
