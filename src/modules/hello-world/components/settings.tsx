import type { ModuleSettingsComponentProps } from "@/core/module-contracts/settings";

import { HELLO_WORLD_FALLBACK_GREETING } from "../manifest";
import { pickGreeting } from "../server/services/greeting";
import { AdminGreetingForm, WorkspaceGreetingForm } from "./forms";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
      {children}
    </div>
  );
}

/** Workspace Settings component registered as hello-world.workspace-settings. */
export function HelloWorldWorkspaceSettings(
  props: ModuleSettingsComponentProps,
) {
  const inherited = pickGreeting({}, props.inherited);
  const greeting =
    typeof props.config.greeting === "string" ? props.config.greeting : "";
  return (
    <Card>
      <WorkspaceGreetingForm
        workspaceSlug={props.workspaceSlug ?? ""}
        greeting={greeting}
        inheritedGreeting={inherited.greeting}
        canWrite={props.canWrite}
      />
    </Card>
  );
}

/** Admin Settings component registered as hello-world.admin-settings. */
export function HelloWorldAdminSettings(props: ModuleSettingsComponentProps) {
  const defaultGreeting =
    typeof props.config.defaultGreeting === "string"
      ? props.config.defaultGreeting
      : "";
  return (
    <Card>
      <AdminGreetingForm
        defaultGreeting={defaultGreeting}
        fallback={HELLO_WORLD_FALLBACK_GREETING}
        canWrite={props.canWrite}
      />
    </Card>
  );
}
