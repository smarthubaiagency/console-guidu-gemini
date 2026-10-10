/**
 * ============================================================================
 * File: e2e/privacy.spec.ts
 * Module: End-to-End Tests for workspace export and deletion (F3e, AC12)
 *
 * Maintenance Rationale:
 * - The owner, with MFA verified, asks for an export in "Dados e
 *   privacidade"; the real worker builds it and the short link downloads a
 *   JSON file with the workspace data.
 * - The owner schedules the deletion confirming the slug; the workspace
 *   closes at once and /app offers the cancel, which brings it back.
 * ============================================================================
 */

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("the owner exports the workspace, schedules its deletion and cancels it", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("privacy-owner");
  const wsSlug = `privacidade-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Privacidade ${stamp}`,
    orgSlug: `privacidade-org-${stamp}`,
    wsName: `Workspace Privacidade ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await enrolMfa(page);

  // Export (AC12).
  await page.goto(`/app/${wsSlug}/settings/data`);
  const exportsSection = page.getByTestId("workspace-exports");
  await page
    .getByTestId("request-export")
    .getByRole("button", { name: "Gerar exportação" })
    .click();
  await expect(
    page.getByTestId("request-export").getByRole("status"),
  ).toContainText("Exportação pedida.");
  expect(await runJobs(request)).toBe(0);
  await page.reload();
  await expect(exportsSection.getByTestId("export-status").first()).toHaveText(
    "Pronta",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportsSection.getByRole("link", { name: "Baixar" }).first().click(),
  ]);
  const content = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(content.format).toBe("guidu.workspace-export");
  expect(content.workspace.slug).toBe(wsSlug);

  // Deletion with a 30-day grace period, then cancel.
  const deletion = page.getByTestId("request-deletion");
  await deletion.getByLabel(`Digite ${wsSlug} para confirmar`).fill(wsSlug);
  await deletion.getByRole("button", { name: "Agendar exclusão" }).click();
  await page.waitForURL(/\/app\?exclusao=agendada/);
  const scheduled = page.getByTestId("scheduled-deletions");
  await expect(scheduled).toContainText(`Workspace Privacidade ${stamp}`);

  // The workspace is closed while scheduled.
  const closed = await page.goto(`/app/${wsSlug}`);
  expect(closed?.status()).toBe(404);

  await page.goto("/app");
  await page
    .getByTestId(`cancel-deletion-${wsSlug}`)
    .getByRole("button", { name: "Cancelar exclusão" })
    .click();
  // The page refreshes without the scheduled list; the workspace is back.
  await expect(page.getByTestId("scheduled-deletions")).toBeHidden();
  const back = await page.goto(`/app/${wsSlug}`);
  expect(back?.status()).toBe(200);
});
