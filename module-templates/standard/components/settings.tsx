import type { ModuleSettingsComponentProps } from "@/core/module-contracts/settings";

/**
 * Registered as "__MODULE_KEY__.workspace-settings" in
 * src/modules/settings-components.ts. The host already resolved context,
 * module state and read permission; render a client form whose action
 * revalidates everything again.
 */
export function __ModuleName__WorkspaceSettings(props: ModuleSettingsComponentProps) {
  return (
    <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
      <p className="text-12 text-text-secondary">
        {props.canWrite ? "Formulário de configuração." : "Somente leitura."}
      </p>
    </div>
  );
}
