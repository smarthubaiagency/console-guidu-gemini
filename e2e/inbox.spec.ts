/**
 * ============================================================================
 * File: e2e/inbox.spec.ts
 * Module: End-to-End Tests for the Inbox window (IN4a)
 *
 * Maintenance Rationale:
 * - Runs only with a local Synapse (MATRIX_E2E_ENV_FILE, CI step of its
 *   own): a consumer calls the address of the store, the core opens the
 *   room, the Attendant takes the conversation, answers and resolves it,
 *   and the consumer gets the answer. The owner, not marked, reads only
 *   until the Team marks them as attendant (decision of 17/10/2026).
 * - The window has its own bar (sidebar-09, ADR 0014 revision of
 *   16/10/2026): views and one way back to the dashboard; helpers of
 *   e2e/support/sidebar.ts do not apply here.
 * - Synapse pushes the events to the app of the rig; the worker of the rig
 *   (runJobs) processes them and makes the rooms and the address.
 * ============================================================================
 */

import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { matrixE2eEnv, MatrixConsumers } from "./support/matrix";
import { statusBanner } from "./support/status";

const env = matrixE2eEnv();

/** The narrow bar of the Inbox (views and the dashboard). */
const bar = (page: Page) => page.getByTestId("inbox-views");

test.skip(!env, "sem Synapse local (MATRIX_E2E_ENV_FILE)");

/**
 * Runs the worker of the rig with the window closed: the list of the Inbox
 * asks the database every few seconds, and PGlite serves one session, so
 * the worker and the open page would collide there.
 */
async function jobs(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto("about:blank");
  await runJobs(request);
}

test("a consumer calls the store; the Attendant takes, answers and resolves; the owner reads", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const consumers = new MatrixConsumers(env!);
  const stamp = Date.now().toString(36);
  const owner = uniqueEmail("in4-owner");
  const attendant = uniqueEmail("in4-attendant");
  const wsSlug = `in4-${stamp}`;
  const orgName = `IN4 ${stamp}`;
  for (const email of [owner, attendant]) await createIdentity(request, email);
  for (const [email, role, orgRole] of [
    [owner, "owner", "owner"],
    [attendant, "attendant", "member"],
  ] as const) {
    await seedWorkspace(request, {
      email,
      orgName,
      orgSlug: `in4-org-${stamp}`,
      wsName: `Loja IN4 ${stamp}`,
      wsSlug,
      role,
      orgRole,
    });
  }

  // The owner turns the Inbox on and opens it: not marked, it reads only.
  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Inbox" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();
  await page.goto(`/app/${wsSlug}/inbox`);
  await expect(bar(page)).toBeVisible();
  await expect(
    bar(page).getByRole("button", { name: "Todas" }),
  ).toHaveAttribute("data-active", "true");
  // The worker registers the address of the store on the chat.
  await jobs(page, request);
  await page.goto(`/app/${wsSlug}/inbox`);
  const address = (
    await page.getByTestId("inbox-address").textContent()
  )?.trim();
  expect(address).toMatch(/^@_guidu_w_[a-z2-7]{16}:/);

  // The consumer calls the store and gets a room opened by the core.
  const maria = await consumers.create("Maria Cliente");
  await consumers.callStore(maria, address!);
  let roomId = "";
  await expect
    .poll(
      async () => {
        await jobs(page, request);
        roomId = (await consumers.invites(maria))[0] ?? "";
        return roomId;
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .not.toBe("");
  await consumers.join(maria, roomId);
  await consumers.send(maria, roomId, "Olá, quero um orçamento");

  // The owner sees the conversation, without the message box.
  await page.goto(`/app/${wsSlug}/inbox`);
  const list = page.getByTestId("inbox-list");
  await list.getByRole("button", { name: /Maria Cliente/ }).click();
  const conversation = page.getByTestId("inbox-conversation");
  await expect(conversation.getByText("Olá, quero um orçamento")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("inbox-read-only")).toBeVisible();
  await expect(conversation.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByTestId("inbox-context")).toContainText("Pendente");

  // The Attendant enters from the dashboard and finds it unassigned.
  await page.context().clearCookies();
  await signIn(page, attendant);
  await page.goto(`/app/${wsSlug}`);
  await page.getByRole("link", { name: "Abrir o Inbox" }).click();
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole("button", { name: "Não atribuídas" }).click();
  await list.getByRole("button", { name: /Maria Cliente/ }).click();
  await expect(conversation.getByText("Olá, quero um orçamento")).toBeVisible({
    timeout: 30_000,
  });

  // Takes it.
  const context = page.getByTestId("inbox-context");
  await context.getByRole("button", { name: "Assumir" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Conversa assumida." }),
  ).toBeVisible();
  await expect(page.getByTestId("inbox-assignee")).toHaveText("Você", {
    timeout: 30_000,
  });

  // Sees the consumer typing and answers.
  await consumers.typing(maria, roomId);
  await expect(page.getByTestId("inbox-presence")).toContainText(
    "Maria Cliente digitando",
    { timeout: 30_000 },
  );
  const box = conversation.getByRole("textbox", {
    name: "Escreva uma mensagem",
  });
  await expect(box).toBeEnabled({ timeout: 30_000 });
  await box.fill("Bom dia, Maria! Já te mando o orçamento.");
  await box.press("Enter");
  await expect
    .poll(() => consumers.messages(maria, roomId), { timeout: 30_000 })
    .toContain("Bom dia, Maria! Já te mando o orçamento.");

  // Resolves it.
  await context.getByRole("button", { name: "Resolver" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Conversa resolvida." }),
  ).toBeVisible();
  await expect(context).toContainText("Resolvida", { timeout: 30_000 });

  // On a phone: the list fills the screen, the conversation stacks over it
  // and the context opens in a sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/${wsSlug}/inbox?view=resolved`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return list.getByRole("button", { name: /Maria Cliente/ }).count();
      },
      { timeout: 60_000, intervals: [2_000, 3_000] },
    )
    .toBe(1);
  await list.getByRole("button", { name: /Maria Cliente/ }).click();
  await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: "Contexto da conversa" }).click();
  await expect(page.getByTestId("inbox-context")).toContainText("Resolvida");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Voltar para a lista" }).click();
  await expect(list).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  // The owner marks themselves as attendant in the Team and gets the box.
  await page.context().clearCookies();
  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/team`);
  const me = page.getByRole("row").filter({ hasText: "Você" });
  await me.getByRole("switch").click();
  await expect(
    statusBanner(page).filter({ hasText: "Atendente marcado." }),
  ).toBeVisible();
  await jobs(page, request);
  await page.goto(`/app/${wsSlug}/inbox?view=resolved`);
  await list.getByRole("button", { name: /Maria Cliente/ }).click();
  await expect(page.getByTestId("inbox-read-only")).toHaveCount(0);
  await expect(
    page.getByTestId("inbox-context").getByRole("button", { name: "Reabrir" }),
  ).toBeVisible();
});
