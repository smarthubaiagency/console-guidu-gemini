/**
 * ============================================================================
 * File: src/modules/settings-components.ts
 * Module: Static registry of module Settings components (Adendo §8.2)
 *
 * Maintenance Rationale:
 * - `componentKey` in a manifest resolves only through this explicit map,
 *   never through imports chosen at runtime or stored in the database.
 * - Registry tests fail when a manifest references a missing component.
 * ============================================================================
 */

import "server-only";

import { createElement, type ReactNode } from "react";

import type {
  ModuleSettingsComponent,
  ModuleSettingsComponentProps,
} from "@/core/module-contracts/settings";
import {
  HelloWorldAdminSettings,
  HelloWorldWorkspaceSettings,
} from "@/modules/hello-world/server";

const SETTINGS_COMPONENTS: Readonly<Record<string, ModuleSettingsComponent>> = {
  "hello-world.workspace-settings": HelloWorldWorkspaceSettings,
  "hello-world.admin-settings": HelloWorldAdminSettings,
};

export function hasSettingsComponent(componentKey: string): boolean {
  return componentKey in SETTINGS_COMPONENTS;
}

/** Renders a registered component; unknown keys render nothing. */
export function renderSettingsComponent(
  componentKey: string,
  props: ModuleSettingsComponentProps,
): ReactNode {
  const component = SETTINGS_COMPONENTS[componentKey];
  return component ? createElement(component, props) : null;
}

export function listSettingsComponentKeys(): readonly string[] {
  return Object.keys(SETTINGS_COMPONENTS);
}
