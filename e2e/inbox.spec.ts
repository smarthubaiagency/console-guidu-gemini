/**
 * ============================================================================
 * File: e2e/inbox.spec.ts
 * Module: End-to-End Tests for the Inbox window (IN4a, layout of the IN4c)
 *
 * Maintenance Rationale:
 * - Runs only with a local Synapse (MATRIX_E2E_ENV_FILE, CI step of its
 *   own): a consumer calls the address of the store, the core opens the
 *   room, the Attendant takes the conversation, answers and resolves it,
 *   and the consumer gets the answer. The owner, not marked, reads only
 *   until the Team marks them as attendant (decision of 17/10/2026).
 * - The window has its own two headers (IN4c): the primary one folds the
 *   list and has the search, "Novo", colour mode, notices and the account;
 *   the secondary one folds the context panel and has the options menu
 *   with the way back to the dashboard. The views are a selector of the
 *   list; helpers of e2e/support/sidebar.ts do not apply here.
 * - Synapse pushes the events to the app of the rig; the worker of the rig
 *   (runJobs) processes them and makes the rooms and the address.
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
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { FAKE_GOOGLE_TRANSLATE_KEY } from "./support/fake-translate";
import { matrixE2eEnv, MatrixConsumers } from "./support/matrix";
import { statusBanner } from "./support/status";

const env = matrixE2eEnv();

/** The selector of the type of conversation (the view), IN4c. */
const viewSelect = (page: Page) => page.getByTestId("inbox-view-select");

async function chooseView(page: Page, name: string): Promise<void> {
  await viewSelect(page).click();
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  await expect(viewSelect(page)).toContainText(name);
}

test.skip(!env, "sem Synapse local (MATRIX_E2E_ENV_FILE)");

/** Opens a closed section of the "Contato" tab (accordion, IN4c). */
async function openSection(section: Locator): Promise<void> {
  const trigger = section.locator('[data-slot="accordion-trigger"]');
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

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

  // The owner turns the Inbox (and the CRM, IN4b) on and opens it: not
  // marked, it reads only.
  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/modules`);
  for (const name of ["Habilitar CRM", "Habilitar Inbox"]) {
    await page.getByRole("button", { name }).click();
    await expect(
      statusBanner(page).filter({ hasText: "Módulo habilitado." }),
    ).toBeVisible();
    await page.reload();
  }
  await page.goto(`/app/${wsSlug}/inbox`);
  await expect(page.getByTestId("inbox-top-bar")).toBeVisible();
  await expect(page.getByTestId("inbox-title-bar")).toContainText(
    `Central de Atendimento - Loja IN4 ${stamp}`,
  );
  await expect(viewSelect(page)).toContainText("Todas");
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
  // Synapse pushes the call to the app; the worker opens the room.
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

  // IN4b: the conversation made its contact in the CRM (job of the rig).
  await jobs(page, request);
  await page.goto(`/app/${wsSlug}/crm/contacts`);
  await expect(page.getByText("Maria Cliente").first()).toBeVisible();

  // IN4b: the owner (manager) keeps the label catalog.
  await page.goto(`/app/${wsSlug}/inbox?view=all`);
  await list.getByRole("button", { name: /Maria Cliente/ }).click();
  const labelsCard = page.getByTestId("inbox-labels");
  await openSection(labelsCard);
  await labelsCard
    .getByRole("textbox", { name: "Nova etiqueta" })
    .fill("Orçamento");
  await labelsCard.getByRole("button", { name: "Criar etiqueta" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Etiqueta criada." }),
  ).toBeVisible();
  // The contact card reads the CRM contact; the owner may link another.
  await expect(page.getByTestId("inbox-contact")).toContainText(
    "Maria Cliente",
  );
  await expect(
    page.getByTestId("inbox-contact").getByRole("button", {
      name: "Ligar a outro contato",
    }),
  ).toBeVisible();

  // The Attendant enters from the dashboard and finds it unassigned.
  await page.context().clearCookies();
  await signIn(page, attendant);
  await page.goto(`/app/${wsSlug}`);
  await page.getByRole("link", { name: "Abrir o Inbox" }).click();
  await expect(viewSelect(page)).toBeVisible();
  await chooseView(page, "Não atribuídas");
  // IN4b: the message is unread for the Attendant, in the list and the tab.
  const row = list.getByRole("button", { name: /Maria Cliente/ });
  await expect(row.getByTestId("inbox-unread")).toHaveText("1", {
    timeout: 30_000,
  });
  await expect(page).toHaveTitle(/^\(1\) /);
  await row.click();
  await expect(conversation.getByText("Olá, quero um orçamento")).toBeVisible({
    timeout: 30_000,
  });
  await expect(row.getByTestId("inbox-unread")).toHaveCount(0, {
    timeout: 30_000,
  });

  // IN4b: the Attendant labels the conversation and filters by it.
  await openSection(page.getByTestId("inbox-labels"));
  await page
    .getByTestId("inbox-labels")
    .getByRole("button", { name: "Orçamento" })
    .click();
  await expect(row).toContainText("Orçamento", { timeout: 15_000 });
  await list
    .getByRole("combobox", { name: "Filtrar por etiqueta" })
    .selectOption({ label: "Orçamento" });
  await expect(row).toBeVisible();

  // Takes it.
  const context = page.getByTestId("inbox-context");
  await context.getByRole("button", { name: "Atribuir a mim" }).click();
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

  // TR1: the consumer writes in Spanish; the conversation knows it (a mark
  // in the list, the chip in the header) and the Attendant corrects it.
  await consumers.send(
    maria,
    roomId,
    "¡Hola! ¿Tienen paseo en barco para mañana? Somos 6 personas.",
  );
  const chip = conversation.getByTestId("inbox-contact-locale");
  await expect(async () => {
    await jobs(page, request);
    await page.goto(
      `/app/${wsSlug}/inbox?view=mine&room=${encodeURIComponent(roomId)}`,
    );
    await expect(chip).toContainText("Espanhol", { timeout: 10_000 });
  }).toPass({ timeout: 120_000 });
  await expect(row.getByTestId("inbox-row-locale")).toHaveText("ES");
  await chip.click();
  await expect(
    page.getByText("Detectado pelas mensagens do contato"),
  ).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Inglês" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Idioma do contato: Inglês." }),
  ).toBeVisible();
  await expect(chip).toContainText("Inglês");
  await expect(row.getByTestId("inbox-row-locale")).toHaveText("EN");

  // Resolves it.
  await context.getByRole("button", { name: "Resolver" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Conversa resolvida." }),
  ).toBeVisible();
  await expect(context).toContainText("Resolvida", { timeout: 30_000 });

  // IN4c: the layout of the window. The context panel has two tabs, the
  // secondary header folds it, the primary one folds the list, and the
  // menus hold what comes later.
  const tabs = page.getByTestId("inbox-context-tabs");
  await tabs.getByRole("tab", { name: "Threads" }).click();
  await expect(page.getByTestId("inbox-threads")).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=threads/);
  await tabs.getByRole("tab", { name: "Contato" }).click();
  await expect(context).toBeVisible();
  await page.getByTestId("inbox-context-toggle").click();
  await expect(page.getByTestId("inbox-context-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(context).toBeHidden();
  await page.getByTestId("inbox-context-toggle").click();
  await expect(context).toBeVisible();
  await page.getByTestId("inbox-list-toggle").click();
  await expect(list).toBeHidden();
  await page.getByTestId("inbox-list-toggle").click();
  await expect(list).toBeVisible();
  await page.getByTestId("inbox-new").click();
  await expect(
    page.getByRole("menuitem", { name: "Nova thread" }),
  ).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");
  await page.getByTestId("inbox-options").click();
  await expect(
    page.getByRole("menuitem", { name: "Dashboard" }),
  ).toHaveAttribute("href", `/app/${wsSlug}`);
  await page.keyboard.press("Escape");

  // On a phone: the list fills the screen, the conversation stacks over it
  // and the context opens in a sheet.
  // The views come from the mirror, which the worker updates.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(async () => {
    await jobs(page, request);
    await page.goto(`/app/${wsSlug}/inbox?view=resolved`);
    await expect(
      list.getByRole("button", { name: /Maria Cliente/ }),
    ).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 120_000 });
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

test('TR2: with the translation on, a message in Spanish shows in Portuguese with "Ver original"', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const consumers = new MatrixConsumers(env!);
  const stamp = Date.now().toString(36);
  const owner = uniqueEmail("tr2-owner");
  const wsSlug = `tr2-${stamp}`;
  await createIdentity(request, owner);
  await seedWorkspace(request, {
    email: owner,
    orgName: `TR2 ${stamp}`,
    orgSlug: `tr2-org-${stamp}`,
    wsName: `Pousada TR2 ${stamp}`,
    wsSlug,
    role: "owner",
    orgRole: "owner",
  });
  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Inbox" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();

  // The block "Tradução": the switch stays off without an engine; the
  // Google key goes to the vault (masked), passes the test and turns it on.
  await page.goto(`/app/${wsSlug}/settings/modules/inbox`);
  const block = page.getByTestId("inbox-translation");
  await expect(block.getByTestId("inbox-translation-enabled")).toBeDisabled();
  await expect(block).toContainText("Idioma da equipe: Português");
  await block
    .getByTestId("inbox-translation-google-key")
    .fill(FAKE_GOOGLE_TRANSLATE_KEY);
  await block.getByRole("button", { name: "Salvar chave" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Chave do Google salva no cofre." }),
  ).toBeVisible();
  await expect(block).not.toContainText(FAKE_GOOGLE_TRANSLATE_KEY);
  await block.getByTestId("inbox-translation-google-test").click();
  await expect(
    statusBanner(page).filter({ hasText: "O motor traduziu o teste." }),
  ).toBeVisible();
  await block
    .getByTestId("inbox-translation-primary")
    .selectOption({ value: "google" });
  await block.getByTestId("inbox-translation-enabled").click();
  await block
    .getByRole("textbox", { name: "Glossário" })
    .fill("Geribá\ncheck-in = entrada");
  await block.getByTestId("inbox-translation-save").click();
  await expect(
    statusBanner(page).filter({ hasText: "Tradução salva." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("inbox-translation-enabled")).toHaveAttribute(
    "data-state",
    "checked",
  );

  // A consumer calls the store and writes in Spanish.
  await page.goto(`/app/${wsSlug}/inbox`);
  await jobs(page, request);
  await page.goto(`/app/${wsSlug}/inbox`);
  const address = (
    await page.getByTestId("inbox-address").textContent()
  )?.trim();
  expect(address).toMatch(/^@_guidu_w_[a-z2-7]{16}:/);
  const lucia = await consumers.create("Lucía Turista");
  await consumers.callStore(lucia, address!);
  await jobs(page, request);
  let roomId = "";
  await expect
    .poll(
      async () => {
        roomId = (await consumers.invites(lucia))[0] ?? "";
        if (!roomId) await jobs(page, request);
        return roomId;
      },
      { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
    )
    .not.toBe("");
  await consumers.join(lucia, roomId);
  const original = "Hola, ¿tienen habitación para dos personas esta noche?";
  await consumers.send(lucia, roomId, original);

  // The worker processes the message and translates it (rig's double).
  const conversation = page.getByTestId("inbox-conversation");
  const translated = conversation.getByTestId("inbox-translated-text");
  await expect(async () => {
    await jobs(page, request);
    await page.goto(
      `/app/${wsSlug}/inbox?view=all&room=${encodeURIComponent(roomId)}`,
    );
    await expect(translated).toHaveText(
      "Olá, vocês têm quarto para duas pessoas esta noite?",
      { timeout: 15_000 },
    );
  }).toPass({ timeout: 180_000 });
  await expect(conversation.getByTestId("inbox-translation-meta")).toHaveText(
    "Traduzido de espanhol · Google Translate",
  );
  await conversation.getByRole("button", { name: "Ver original" }).click();
  await expect(translated).toHaveText(original);
  await conversation.getByRole("button", { name: "Ver tradução" }).click();
  await expect(translated).toHaveText(
    "Olá, vocês têm quarto para duas pessoas esta noite?",
  );
});
