/**
 * ============================================================================
 * File: e2e/modules-hello-world.spec.ts
 * Module: End-to-End Tests for the module contract (F2) and reference module
 *
 * Maintenance Rationale:
 * - Adendo §8.4: menus and Settings for two workspaces with the module enabled
 *   in only one, users with different permissions, direct route access,
 *   admin global policy and maintenance.
 * - The rig database runs as superuser, so these flows prove the UI and the
 *   server guards; RLS is proven by tests/core/modules-rls.sql in CI.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

test.describe.configure({ mode: "serial" });

const sidebar = (page: Page) => page.locator("aside");
const helloRow = (page: Page) =>
  page.locator("li", { hasText: "key: hello-world" });

async function enableHelloWorld(page: Page, wsSlug: string) {
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Hello World" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();
}

test.describe("Module contract — hello-world reference module", () => {
  test("owner enables the module, sees the generated menu, creates and reads a record", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("hello-owner");
    const wsSlug = `ws-hello-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: `Hello Org ${Date.now()}`,
      orgSlug: `hello-org-${Date.now()}`,
      wsName: "Hello Workspace",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}`);
    await expect(sidebar(page).getByText("Hello World")).toHaveCount(0);

    // Direct route before enabling: disabled state, no data.
    await page.goto(`/app/${wsSlug}/hello-world`);
    await expect(
      page.getByRole("heading", { name: "Módulo desabilitado" }),
    ).toBeVisible();

    await enableHelloWorld(page, wsSlug);

    // Generated navigation: group with two children and a settings entry.
    await page.goto(`/app/${wsSlug}`);
    await expect(sidebar(page).getByText("Hello World").first()).toBeVisible();
    await sidebar(page).getByRole("link", { name: "Saudação" }).click();
    await expect(page.getByTestId("hello-greeting")).toHaveText(
      "Hello, World!",
    );
    await expect(page.getByText("Padrão do módulo")).toBeVisible();

    await sidebar(page).getByRole("link", { name: "Registros" }).click();
    await expect(
      page.getByRole("heading", { name: "Registros de exemplo" }),
    ).toBeVisible();
    await page.getByLabel("Título do registro").fill("Primeiro registro E2E");
    await page.getByRole("button", { name: "Criar registro" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Registro criado." }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Primeiro registro E2E" }).click();
    await expect(
      page.getByRole("heading", { name: "Primeiro registro E2E" }),
    ).toBeVisible();
    await expect(page.getByText("Você", { exact: true })).toBeVisible();

    // Workspace settings through the shared host.
    await page.goto(`/app/${wsSlug}/settings/modules/hello-world`);
    await page.getByLabel("Saudação do workspace").fill("Olá, E2E!");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Configuração salva." }),
    ).toBeVisible();

    await page.goto(`/app/${wsSlug}/hello-world`);
    await expect(page.getByTestId("hello-greeting")).toHaveText("Olá, E2E!");
    await expect(page.getByText("Definida neste workspace")).toBeVisible();

    // Unknown ids and unknown modules fail closed.
    await page.goto(
      `/app/${wsSlug}/hello-world/records/00000000-0000-4000-8000-000000000000`,
    );
    await expect(
      page.getByRole("heading", { name: "Primeiro registro E2E" }),
    ).toHaveCount(0);
    const unknown = await page.goto(
      `/app/${wsSlug}/settings/modules/nao-existe`,
    );
    expect(unknown?.status()).toBe(404);
  });

  test("viewer cannot enable or create, and another workspace does not see the module", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const owner = uniqueEmail("hello-owner2");
    const viewer = uniqueEmail("hello-viewer");
    const outsider = uniqueEmail("hello-outsider");
    const wsSlug = `ws-hello-shared-${stamp}`;
    const otherSlug = `ws-hello-other-${stamp}`;
    for (const email of [owner, viewer, outsider])
      await createIdentity(request, email);
    const orgName = `Hello Shared ${stamp}`;
    await seedWorkspace(request, {
      email: owner,
      orgName,
      orgSlug: `hs-${stamp}`,
      wsName: "Shared",
      wsSlug,
      role: "owner",
    });
    await seedWorkspace(request, {
      email: viewer,
      orgName,
      orgSlug: `hs-${stamp}`,
      wsName: "Shared",
      wsSlug,
      role: "viewer",
    });
    await seedWorkspace(request, {
      email: outsider,
      orgName: `Hello Other ${stamp}`,
      orgSlug: `ho-${stamp}`,
      wsName: "Other",
      wsSlug: otherSlug,
      role: "owner",
    });

    await signIn(page, owner);
    await enableHelloWorld(page, wsSlug);
    await page.context().clearCookies();

    await signIn(page, viewer);
    await page.goto(`/app/${wsSlug}/settings/modules`);
    await expect(
      page.getByText("Somente proprietários e administradores"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Habilitar|Desabilitar/ }),
    ).toHaveCount(0);

    await page.goto(`/app/${wsSlug}/hello-world/records`);
    await expect(
      page.getByText("Seu papel permite apenas consultar os registros."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Criar registro" }),
    ).toHaveCount(0);

    await page.goto(`/app/${wsSlug}/settings/modules/hello-world`);
    await expect(page.getByLabel("Saudação do workspace")).toBeDisabled();
    await page.context().clearCookies();

    await signIn(page, outsider);
    await page.goto(`/app/${otherSlug}`);
    await expect(sidebar(page).getByText("Hello World")).toHaveCount(0);
    await page.goto(`/app/${otherSlug}/hello-world/records`);
    await expect(
      page.getByRole("heading", { name: "Módulo desabilitado" }),
    ).toBeVisible();
  });

  test("platform admin sets the global policy and maintenance blocks the module", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("hello-admin");
    const wsSlug = `ws-hello-admin-${Date.now()}`;
    await createIdentity(request, email);
    await makePlatformAdmin(request, email);
    await seedWorkspace(request, {
      email,
      orgName: `Hello Admin Org ${Date.now()}`,
      orgSlug: `hao-${Date.now()}`,
      wsName: "Admin WS",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto("/app/account/security");
    await page.getByTestId("start-mfa-enrolment").click();
    const secret = (
      await page.getByTestId("totp-secret").textContent()
    )?.trim();
    await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
    await page.getByRole("button", { name: "Confirmar ativação" }).click();
    await expect(page.getByTestId("mfa-factors")).toBeVisible();

    await enableHelloWorld(page, wsSlug);

    // Global default greeting is inherited by a workspace without override.
    await page.goto("/platform/modules");
    await expect(
      page.getByRole("heading", { name: "Módulos da Plataforma" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Política global de Hello World" })
      .click();
    await page.getByLabel("Saudação padrão global").fill("Olá da plataforma!");
    await page.getByRole("button", { name: "Salvar política" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Política global salva." }),
    ).toBeVisible();

    await page.goto(`/app/${wsSlug}/hello-world`);
    await expect(page.getByTestId("hello-greeting")).toHaveText(
      "Olá da plataforma!",
    );
    await expect(page.getByText("Herdada da política global")).toBeVisible();

    // Maintenance blocks the module pages; admin settings stay reachable.
    await page.goto("/platform/modules");
    await page
      .getByLabel("Disponibilidade de Hello World")
      .selectOption("maintenance");
    await helloRow(page).getByRole("button", { name: "Aplicar" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Disponibilidade atualizada." }),
    ).toBeVisible();

    await page.goto(`/app/${wsSlug}/hello-world`);
    await expect(
      page.getByRole("heading", { name: "Módulo em manutenção" }),
    ).toBeVisible();
    await page.goto("/platform/settings/modules/hello-world");
    await expect(page.getByLabel("Saudação padrão global")).toBeVisible();

    // Restore global state for the rest of the suite.
    await page.goto("/platform/modules");
    await page
      .getByLabel("Disponibilidade de Hello World")
      .selectOption("enabled");
    await helloRow(page).getByRole("button", { name: "Aplicar" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Disponibilidade atualizada." }),
    ).toBeVisible();
    await page.goto("/platform/settings/modules/hello-world");
    await page.getByLabel("Saudação padrão global").fill("");
    await page.getByRole("button", { name: "Salvar política" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Política global salva." }),
    ).toBeVisible();
  });
});
