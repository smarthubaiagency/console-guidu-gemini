/**
 * ============================================================================
 * File: e2e/inbox-guids.spec.ts
 * Module: End-to-End Tests for the GUIDS in the room of the Inbox (IN6)
 *
 * Maintenance Rationale:
 * - Runs only with a local Synapse (MATRIX_E2E_ENV_FILE, job e2e-inbox)
 *   and the AI agents module on (GUIDU_MODULE_AI_AGENTS_ENABLED).
 * - The owner chooses the GUIDS of the Inbox in Configurações › Módulos ›
 *   Inbox; the worker puts the agent's user in the rooms. A consumer calls
 *   the store and writes; the Attendant sees the GUIDS card ("Com o
 *   GUIDS"), takes the conversation and gives it back ("Devolver ao
 *   GUIDS"), which leaves it pending again.
 * - The rig has no model: the GUIDS's answer and its handoff are covered by
 *   tests/core/inbox-guids.test.ts (mock model, local Synapse). Here the
 *   seeded GUIDS has no key, so its turn stops before any model call.
 * ============================================================================
 */

import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedGuid,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { matrixE2eEnv, MatrixConsumers } from "./support/matrix";
import { statusBanner } from "./support/status";

const env = matrixE2eEnv();

/** Opens a closed section of the "Contato" tab (accordion, IN4c). */
async function openSection(section: Locator): Promise<void> {
  const trigger = section.locator('[data-slot="accordion-trigger"]');
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

test.skip(!env, "sem Synapse local (MATRIX_E2E_ENV_FILE)");
test.skip(
  process.env.GUIDU_MODULE_AI_AGENTS_ENABLED !== "true",
  "módulo Agentes de IA desligado (GUIDU_MODULE_AI_AGENTS_ENABLED)",
);

/** The worker of the rig, with the window closed (see e2e/inbox.spec.ts). */
async function jobs(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto("about:blank");
  await runJobs(request);
}

test("the owner chooses the GUIDS; the Attendant sees it, takes the conversation and gives it back", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const consumers = new MatrixConsumers(env!);
  const stamp = Date.now().toString(36);
  const owner = uniqueEmail("in6-owner");
  const attendant = uniqueEmail("in6-attendant");
  const wsSlug = `in6-${stamp}`;
  const orgName = `IN6 ${stamp}`;
  for (const email of [owner, attendant]) await createIdentity(request, email);
  let ids = { organizationId: "", workspaceId: "" };
  for (const [email, role, orgRole] of [
    [owner, "owner", "owner"],
    [attendant, "attendant", "member"],
  ] as const) {
    ids = await seedWorkspace(request, {
      email,
      orgName,
      orgSlug: `in6-org-${stamp}`,
      wsName: `Loja IN6 ${stamp}`,
      wsSlug,
      role,
      orgRole,
    });
  }
  await seedGuid(request, { ...ids, agentName: "Lia", ready: true });

  // The owner turns the Inbox on and chooses Lia.
  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Inbox" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();
  await page.goto(`/app/${wsSlug}/settings/modules/inbox`);
  const settings = page.getByTestId("inbox-settings");
  await expect(settings).toBeVisible();
  await settings.getByLabel("GUIDS que atende").selectOption({ label: "Lia" });
  await settings.getByRole("button", { name: "Salvar" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Configurações do Inbox salvas." }),
  ).toBeVisible();

  // The worker registers the address of the store and the agent's user.
  await page.goto(`/app/${wsSlug}/inbox`);
  await jobs(page, request);
  await page.goto(`/app/${wsSlug}/inbox`);
  const address = (
    await page.getByTestId("inbox-address").textContent()
  )?.trim();
  expect(address).toMatch(/^@_guidu_w_[a-z2-7]{16}:/);

  // The consumer calls the store and writes in the room the core opens.
  const maria = await consumers.create("Maria Cliente");
  await consumers.callStore(maria, address!);
  await jobs(page, request);
  let roomId = "";
  await expect
    .poll(
      async () => {
        roomId = (await consumers.invites(maria))[0] ?? "";
        if (!roomId) await jobs(page, request);
        return roomId;
      },
      { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
    )
    .not.toBe("");
  await consumers.join(maria, roomId);
  await consumers.send(maria, roomId, "Oi, vocês abrem sábado?");
  await jobs(page, request);

  // The Attendant opens it: pending, with the GUIDS.
  await page.context().clearCookies();
  await signIn(page, attendant);
  await page.goto(`/app/${wsSlug}/inbox?view=unassigned`);
  const list = page.getByTestId("inbox-list");
  await list.getByRole("button", { name: /Maria Cliente/ }).click();
  const card = page.getByTestId("inbox-guids");
  await openSection(card);
  await expect(card).toContainText("Lia", { timeout: 30_000 });
  await expect(card).toContainText("Com o GUIDS");
  await expect(card.getByTestId("inbox-guids-return")).toHaveCount(0);

  // Takes it: with the team; then gives it back to the GUIDS.
  const context = page.getByTestId("inbox-context");
  await context.getByRole("button", { name: "Atribuir a mim" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Conversa assumida." }),
  ).toBeVisible();
  await expect(card).toContainText("Com a equipe", { timeout: 30_000 });
  await card.getByTestId("inbox-guids-return").click();
  await expect(
    statusBanner(page).filter({ hasText: "Conversa devolvida ao GUIDS." }),
  ).toBeVisible();
  await expect(context).toContainText("Pendente", { timeout: 30_000 });
  await expect(card).toContainText("Com o GUIDS", { timeout: 30_000 });
});
