/**
 * ============================================================================
 * File: e2e/partner-console.spec.ts
 * Module: End-to-End Tests for partners (ADR 0012, P4a)
 *
 * Maintenance Rationale:
 * - The platform owner creates a partner, activates a domain and invites its
 *   owner from /platform/partners.
 * - The invited owner signs in on the partner domain (a `*.localhost` host,
 *   which the browser resolves to loopback), accepts the invitation, opens
 *   the partner console at /admin and saves the partner brand.
 * - The platform host keeps its own brand: brands never cross hosts.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
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

test("platform creates a partner whose owner runs the console on the partner domain", async ({
  page,
  request,
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const slug = `agencia-${stamp}`;
  const host = `${slug}.localhost`;
  const ownerEmail = uniqueEmail("partner-owner");

  // Platform owner.
  const platformEmail = uniqueEmail("platform-owner");
  await createIdentity(request, platformEmail);
  await makePlatformAdmin(request, platformEmail);
  await signIn(page, platformEmail);
  await enrolMfa(page);

  await page.goto("/platform/partners");
  const create = page.getByTestId("create-partner");
  await create.getByLabel("Nome").fill("Agência E2E");
  await create.getByLabel("Identificador").fill(slug);
  await create.getByRole("button", { name: "Criar parceiro" }).click();
  await page.waitForURL(/\/platform\/partners\/[0-9a-f-]{36}$/);

  const domain = page.getByTestId("add-domain");
  await domain.getByLabel("Domínio ou nome do subdomínio").fill(host);
  await domain.getByRole("button", { name: "Cadastrar domínio" }).click();
  await expect(domain.getByRole("status")).toContainText("pendente");
  await page.reload();
  await page.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByText("Domínio ativado.")).toBeVisible();

  const invite = page.getByTestId("invite-partner-member");
  await invite.getByLabel("E-mail").fill(ownerEmail);
  await invite.getByRole("button", { name: "Gerar convite" }).click();
  const inviteUrl = (
    await invite.getByTestId("partner-invite-url").textContent()
  )?.trim();
  expect(inviteUrl).toMatch(
    new RegExp(`^http://${host}:3000/partner-invite/[0-9a-f]{64}$`),
  );

  // Partner owner, on the partner domain.
  const partnerContext = await browser.newContext({
    baseURL: `http://${host}:3000`,
  });
  const owner = await partnerContext.newPage();
  await createIdentity(request, ownerEmail);
  await signIn(owner, ownerEmail);
  await enrolMfa(owner);

  await owner.goto(inviteUrl!);
  await expect(
    owner.getByRole("heading", { name: "Entrar em Agência E2E" }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Aceitar convite" }).click();
  await owner.waitForURL(/\/admin$/);
  await expect(owner.getByTestId("partner-console")).toBeVisible();
  await expect(
    owner.getByRole("heading", { name: "Agência E2E" }),
  ).toBeVisible();

  // The owner sees the members page with themself as owner.
  await owner.goto("/admin/members");
  await expect(owner.getByTestId("partner-member-list")).toContainText(
    `${ownerEmail.toLowerCase()} (você)`,
  );

  // Partner brand, served only on the partner domain.
  await owner.goto("/admin/brand");
  await owner.getByLabel("Nome exibido").fill("Marca Agência E2E");
  await owner.getByLabel("Cor primária (#rrggbb, opcional)").fill("#6a1b9a");
  await owner.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(
    owner.getByTestId("brand-form").getByRole("status"),
  ).toContainText("Marca salva");
  await owner.reload();
  await expect(owner.getByTestId("brand-current-name")).toHaveText(
    "Marca Agência E2E",
  );
  await expect(owner.locator("header").first()).toContainText(
    "Marca Agência E2E",
  );

  // The platform host keeps the platform brand, and /platform does not exist
  // on the partner domain.
  await page.goto("/platform/brand");
  await expect(page.getByTestId("brand-current-name")).not.toHaveText(
    "Marca Agência E2E",
  );
  // Fetched from the page: the browser resolves *.localhost, Node does not.
  const platformStatus = await owner.evaluate(async () => {
    const response = await fetch("/platform", { redirect: "manual" });
    return response.status;
  });
  expect(platformStatus).toBe(404);

  await partnerContext.close();
});
