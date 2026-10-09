/**
 * Contract between the shared Settings hosts and the components a module
 * registers for them (Adendo §8.2). The host resolves context, permissions
 * and stored configuration before rendering; the component only presents and
 * saves through its own server action, which revalidates everything again.
 */
import type { ReactNode } from "react";

export type ModuleSettingsComponentProps = Readonly<{
  moduleKey: string;
  destination: "workspace" | "admin";
  /** Validated slug for workspace settings; null in the admin host. */
  workspaceSlug: string | null;
  /** Whether the viewer holds every write permission of the entry. */
  canWrite: boolean;
  /** Stored configuration of this scope, already validated by the schema. */
  config: Record<string, unknown>;
  /** Global configuration the workspace inherits (workspace host only). */
  inherited: Record<string, unknown>;
}>;

export type ModuleSettingsComponent = (
  props: ModuleSettingsComponentProps,
) => ReactNode | Promise<ReactNode>;
