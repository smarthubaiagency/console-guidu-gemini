/**
 * Configurações › Canais (A5a, ADR 0011): the owner connects the Chatwoot
 * double of the rig, sees the inbox, receives a webhook event without an
 * agent, checks and removes the connection. A viewer gets no access.
 */

import { expect, test } from "@playwright/test";

import { FAKE_CHATWOOT_TOKEN } from "./support/fake-chatwoot";
import {
  createIdentity,
  seedGuid,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";

const CHATWOOT_URL = `http://127.0.0.1:${RIG.chatwootPort}`;

test("owner connects Chatwoot, receives an event, checks and removes it", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("channels-owner");
  const wsSlug = `ws-channels-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Loja Canais",
    orgSlug: `org-channels-${Date.now()}`,
    wsName: "Loja",
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/channels`);

  await expect(page.getByRole("heading", { name: "Canais" })).toBeVisible();
  await expect(page.getByTestId("channels-empty")).toBeVisible();

  const form = page.getByTestId("create-chatwoot");
  await form.getByLabel("Nome").fill("Atendimento");
  await form.getByLabel("Endereço do Chatwoot").fill(CHATWOOT_URL);
  await form.getByLabel("ID da conta").fill("1");
  await form.getByLabel("Token de acesso").fill(FAKE_CHATWOOT_TOKEN);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(statusBanner(page)).toContainText("Chatwoot conectado.");

  const card = page.getByTestId("channel-connection");
  await expect(card).toContainText("Atendimento");
  await expect(card.getByTestId("channel-health")).toHaveText("Funcionando");
  await expect(card.getByTestId("channel-inboxes")).toContainText(
    "WhatsApp Loja",
  );
  await expect(card).not.toContainText(FAKE_CHATWOOT_TOKEN);

  // Chatwoot calls the webhook of the bot it was given.
  const bots = (await (await request.get(`${CHATWOOT_URL}/__bots`)).json()) as {
    bots: { outgoingUrl: string }[];
  };
  const outgoingUrl = bots.bots.at(-1)!.outgoingUrl;
  const event = {
    event: "message_created",
    id: 1,
    content: "Olá",
    message_type: "incoming",
    private: false,
    sender: { id: 9, name: "Maria", type: "contact" },
    conversation: { id: 55, inbox_id: 3, status: "pending" },
    inbox: { id: 3 },
  };
  const received = await request.post(outgoingUrl, { data: event });
  expect(received.status()).toBe(200);
  expect((await request.post(outgoingUrl, { data: event })).status()).toBe(200);
  expect(
    (
      await request.post(outgoingUrl.replace(/[^/]+$/, "x".repeat(43)), {
        data: event,
      })
    ).status(),
  ).toBe(404);

  await page.reload();
  await expect(card).toContainText("1 evento sem agente");

  await card.getByTestId("check-channel").click();
  await expect(statusBanner(page)).toContainText("Conexão funcionando.");

  await card.getByTestId("delete-channel").click();
  const question = statusBanner(page);
  await expect(question).toHaveAttribute("role", "alertdialog");
  await question.getByRole("checkbox").check();
  await question.getByTestId("smart-status-action").click();
  await expect(statusBanner(page)).toContainText("Conexão removida.");
  await expect(page.getByTestId("channels-empty")).toBeVisible();
  expect((await request.post(outgoingUrl, { data: event })).status()).toBe(404);
});

test("viewer has no access to the channels", async ({ page, request }) => {
  const email = uniqueEmail("channels-viewer");
  const wsSlug = `ws-channels-viewer-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Loja Leitura",
    orgSlug: `org-channels-viewer-${Date.now()}`,
    wsName: "Loja Leitura",
    wsSlug,
    role: "viewer",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/channels`);
  await expect(
    page.getByText("Você não tem acesso aos canais deste workspace."),
  ).toBeVisible();
  await expect(page.getByTestId("create-chatwoot")).toHaveCount(0);
});

test.describe("GUIDS on a Chatwoot inbox (A5b)", () => {
  test.skip(
    process.env.GUIDU_MODULE_AI_AGENTS_ENABLED !== "true",
    "Module is frozen by default (C04); runs only when GUIDU_MODULE_AI_AGENTS_ENABLED is true",
  );

  test("owner adjusts the service of an inbox and puts a GUIDS on it", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("channels-guid");
    const wsSlug = `ws-channels-guid-${Date.now()}`;
    await createIdentity(request, email);
    const workspace = await seedWorkspace(request, {
      email,
      orgName: "Loja GUIDS",
      orgSlug: `org-channels-guid-${Date.now()}`,
      wsName: "Loja GUIDS",
      wsSlug,
      role: "owner",
    });
    const { agentId } = await seedGuid(request, {
      ...workspace,
      agentName: "Anna",
      ready: true,
    });
    await signIn(page, email);

    await page.goto(`/app/${wsSlug}/settings/channels`);
    const form = page.getByTestId("create-chatwoot");
    await form.getByLabel("Nome").fill("Atendimento");
    await form.getByLabel("Endereço do Chatwoot").fill(CHATWOOT_URL);
    await form.getByLabel("ID da conta").fill("1");
    await form.getByLabel("Token de acesso").fill(FAKE_CHATWOOT_TOKEN);
    await form.getByRole("button", { name: "Conectar" }).click();
    await expect(statusBanner(page)).toContainText("Chatwoot conectado.");

    // The inbox gets its own grouping window; the defaults stay.
    const service = page.getByTestId("channel-service");
    await service.getByTestId("channel-service-scope").selectOption("3");
    await service
      .getByLabel("Espera para juntar mensagens (segundos)")
      .fill("8");
    await expect(service.getByLabel("Resposta em áudio")).toHaveValue("mirror");
    await service.getByRole("button", { name: "Salvar atendimento" }).click();
    await expect(statusBanner(page)).toContainText("Atendimento salvo.");
    await expect(
      service.getByTestId("channel-service-scope").locator("option"),
    ).toContainText([
      "Todas as inboxes (padrão)",
      "WhatsApp Loja (ajuste próprio)",
    ]);

    await page.goto(`/app/${wsSlug}/ai-agents?edit=${agentId}`);
    const channels = page.getByTestId("guid-channels");
    const inbox = channels.getByTestId("guid-inbox");
    await expect(inbox).toContainText("WhatsApp Loja");
    await expect(inbox.getByTestId("guid-inbox-state")).toHaveText("Livre");
    await inbox.getByTestId("bind-inbox").click();
    await expect(statusBanner(page)).toContainText(
      "O agente passou a atender a inbox.",
    );
    await expect(inbox.getByTestId("guid-inbox-state")).toHaveText(
      "Este agente",
    );

    // The connection shows who answers the inbox and its service (A5c).
    await page.goto(`/app/${wsSlug}/settings/channels`);
    await expect(page.getByTestId("channel-inboxes")).toContainText(
      "WhatsApp Loja · Channel::Api · Anna",
    );
    await expect(page.getByTestId("channel-activity")).toContainText(
      "nenhuma mensagem enviada",
    );

    await page.goto(`/app/${wsSlug}/ai-agents?edit=${agentId}`);
    await inbox.getByTestId("unbind-inbox").click();
    await expect(statusBanner(page)).toContainText(
      "O agente parou de atender a inbox.",
    );
    await expect(inbox.getByTestId("guid-inbox-state")).toHaveText("Livre");
  });
});
