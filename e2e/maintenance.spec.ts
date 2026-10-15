/**
 * ============================================================================
 * File: e2e/maintenance.spec.ts
 * Module: End-to-End Tests for Operações › Manutenção (CF5c)
 *
 * Maintenance Rationale:
 * - A platform owner turns full maintenance on in the Manutenção tab: a
 *   workspace member is sent to the maintenance page with the message, the
 *   public API answers 503 with Retry-After, and /platform stays open.
 * - In read-only the workspace opens with the strip, a save is refused in
 *   the SmartStatusBanner and the API refuses writes but not reads.
 * - "Encerrar agora" opens everything again.
 * - Every spec shares the database: afterEach turns the window off straight
 *   in the database, even when a step failed, and waits until the app sees
 *   it (each process caches the window for 5 seconds).
 * ============================================================================
 */

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  createIdentity,
  maintenanceOff,
  makePlatformAdmin,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

const WORKSPACES_API = "/api/v1/me/workspaces";
const contactsApi = (workspaceId: string) =>
  `/api/v1/workspaces/${workspaceId}/crm/contacts`;

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

/** A write of the public API, as an anonymous client: 503 only in a window. */
function writeStatus(
  request: APIRequestContext,
  workspaceId: string,
): Promise<number> {
  return request
    .post(contactsApi(workspaceId), { data: { name: "CF5c" } })
    .then((response) => response.status());
}

let workspaceId = "00000000-0000-4000-8000-000000000000";

test.afterEach(async ({ request }) => {
  await maintenanceOff(request);
  await expect
    .poll(() => writeStatus(request, workspaceId), { timeout: 20_000 })
    .not.toBe(503);
});

test("a platform owner closes the platform for maintenance and read-only", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const wsSlug = `ws-cf5c-${stamp}`;
  const ownerEmail = uniqueEmail("maintenance-owner");
  const memberEmail = uniqueEmail("maintenance-member");
  await createIdentity(request, ownerEmail);
  await makePlatformAdmin(request, ownerEmail);
  await createIdentity(request, memberEmail);
  const seeded = await seedWorkspace(request, {
    email: memberEmail,
    orgName: `Empresa CF5c ${stamp}`,
    orgSlug: `org-cf5c-${stamp}`,
    wsName: "Workspace CF5c",
    wsSlug,
    role: "owner",
  });
  workspaceId = seeded.workspaceId;

  await signIn(page, ownerEmail);
  await enrolMfa(page);

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, memberEmail);
  await member.goto(`/app/${wsSlug}`);
  await expect(member).toHaveURL(new RegExp(`/app/${wsSlug}$`));

  // The Manutenção tab, next to Saúde e filas.
  await page.goto("/platform/operations");
  await page
    .getByTestId("operations-tabs")
    .getByRole("link", { name: "Manutenção" })
    .click();
  await expect(page).toHaveURL(/\/platform\/operations\/maintenance$/);
  await expect(
    page.getByTestId("maintenance-phase").locator("dd"),
  ).toContainText("Desligada");

  // Full maintenance, now, with a message.
  const form = page.getByTestId("maintenance-form");
  await page.waitForLoadState("networkidle");
  await form.getByLabel("Ligar a janela").check();
  await form.getByLabel("Modo").selectOption("maintenance");
  await form.getByLabel("Português (Brasil)").fill("Voltamos às 23h.");
  await form.getByRole("button", { name: "Salvar manutenção" }).click();
  await expect(statusBanner(page)).toContainText("Manutenção salva.");
  await expect(
    page.getByTestId("maintenance-phase").locator("dd"),
  ).toContainText("Em andamento");

  // /platform stays open, with the strip.
  await page.goto("/platform");
  await expect(page.getByTestId("maintenance-strip")).toHaveAttribute(
    "data-mode",
    "maintenance",
  );

  // /app goes to the maintenance page, with the message.
  await expect(async () => {
    await member.goto(`/app/${wsSlug}`);
    await expect(member).toHaveURL(/\/maintenance$/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(member.getByTestId("maintenance-page")).toBeVisible();
  await expect(member.getByTestId("maintenance-message")).toHaveText(
    "Voltamos às 23h.",
  );

  // The public API answers 503 with Retry-After, reads included.
  const closed = await request.get(WORKSPACES_API);
  expect(closed.status()).toBe(503);
  expect(Number(closed.headers()["retry-after"])).toBeGreaterThan(0);
  expect(
    ((await closed.json()) as { error: { code: string } }).error.code,
  ).toBe("maintenance");
  // Health checks stay open.
  expect((await request.get("/api/health/live")).status()).toBe(200);

  // Read-only: the workspace opens with the strip, saves are refused.
  await page.goto("/platform/operations/maintenance");
  await page.waitForLoadState("networkidle");
  await form.getByLabel("Modo").selectOption("read_only");
  await form.getByRole("button", { name: "Salvar manutenção" }).click();
  await expect(statusBanner(page)).toContainText("Manutenção salva.");

  await expect(async () => {
    await member.goto(`/app/${wsSlug}/settings/security`);
    await expect(member).toHaveURL(/\/settings\/security$/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(member.getByTestId("maintenance-strip")).toHaveAttribute(
    "data-mode",
    "read_only",
  );
  await member.waitForLoadState("networkidle");
  const card = member.getByTestId("security-mfa");
  await card
    .getByLabel("Exigir MFA de todos os membros deste workspace")
    .check();
  await card.getByRole("button", { name: "Salvar MFA" }).click();
  await expect(statusBanner(member)).toContainText("somente leitura");

  // The API reads (here: 401, the anonymous client gets to the
  // authentication) but refuses writes with 503.
  expect((await request.get(WORKSPACES_API)).status()).toBe(401);
  const refused = await request.post(contactsApi(workspaceId), {
    data: { name: "CF5c" },
  });
  expect(refused.status()).toBe(503);
  expect(refused.headers()["retry-after"]).toBeTruthy();
  expect(
    ((await refused.json()) as { error: { code: string } }).error.code,
  ).toBe("read_only");

  // End now: everything opens again.
  await page.goto("/platform/operations/maintenance");
  await page.waitForLoadState("networkidle");
  await page
    .getByTestId("maintenance-end")
    .getByRole("button", { name: "Encerrar agora" })
    .click();
  await expect(statusBanner(page)).toContainText("Manutenção encerrada.");
  await expect(
    page.getByTestId("maintenance-phase").locator("dd"),
  ).toContainText("Desligada");
  await expect
    .poll(() => writeStatus(request, workspaceId), { timeout: 20_000 })
    .not.toBe(503);
  await member.goto(`/app/${wsSlug}`);
  await expect(member).toHaveURL(new RegExp(`/app/${wsSlug}$`));
  await expect(member.getByTestId("maintenance-strip")).toHaveCount(0);
  await memberContext.close();
});
