/**
 * PROVA DE CONCEITO (IN1). O atendente no navegador: entra no console,
 * abre /app/<workspace>/inbox, espera a conversa transferida pelo agente,
 * assume, responde e tira as capturas da prova.
 *
 *   pnpm tsx scripts/local/inbox-poc-browser.ts conversa
 *   pnpm tsx scripts/local/inbox-poc-browser.ts lista
 *   pnpm tsx scripts/local/inbox-poc-browser.ts sem-flag   # app sem GUIDU_INBOX_POC
 */
import { chromium, type Page } from "@playwright/test";

const APP = process.env.POC_APP_URL ?? "http://localhost:3400";
const WS = process.env.POC_WORKSPACE ?? "loja-poc";
const EMAIL = process.env.POC_EMAIL ?? "ana@loja-poc.test";
const OUT = process.env.POC_SHOTS ?? "docs/modules/inbox/prova-de-conceito";

async function login(page: Page): Promise<void> {
  await page.goto(`${APP}/login`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill("senha-de-teste-12345");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
}

async function openInbox(page: Page, mode: "classic" | "sliding"): Promise<string> {
  await page.goto(`${APP}/app/${WS}/inbox${mode === "sliding" ? "?sync=sliding" : ""}`);
  await page.getByTestId("first-list").filter({ hasText: " ms" }).waitFor({ timeout: 120000 });
  return (await page.getByTestId("first-list").textContent()) ?? "";
}

async function conversa(): Promise<void> {
  const browser = await chromium.launch({ executablePath: process.env.POC_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, locale: "pt-BR" });
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(`HTTP ${response.status()} ${response.url().slice(0, 160)}`);
  });
  await login(page);
  console.log("primeira lista:", await openInbox(page, "classic"));
  console.log("usuário Matrix:", await page.getByTestId("me").textContent());
  // Espera uma conversa nova que o agente transferiu ("open").
  const known = await page.locator("[data-room-id]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-room-id")),
  );
  const handle = await page.waitForFunction(
    (ids) =>
      [...document.querySelectorAll("[data-room-id]")].find(
        (node) => !ids.includes(node.getAttribute("data-room-id")) && node.textContent?.includes("open"),
      )?.getAttribute("data-room-id"),
    known,
    { timeout: 120000 },
  );
  const roomId = (await handle.jsonValue()) as string;
  console.log("conversa transferida:", roomId);
  await page.locator(`[data-room-id="${roomId}"]`).click();
  await page.getByTestId("timeline").getByText("Quero falar com um atendente").waitFor();
  await page.screenshot({ path: `${OUT}/01-transferida.png` });
  await page.getByRole("button", { name: "Assumir" }).click();
  await page.getByTestId("status").filter({ hasText: "open" }).waitFor();
  await page.getByLabel("Mensagem").fill("Olá! Aqui é a Ana. Sim, abrimos no sábado das 9h às 13h.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByTestId("timeline").getByText("Obrigado, Ana!").waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${OUT}/02-atendente-respondeu.png` });
  console.log("timeline e estado ok");
  await browser.close();
}

async function lista(): Promise<void> {
  const browser = await chromium.launch({ executablePath: process.env.POC_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, locale: "pt-BR" });
  await login(page);
  for (const mode of ["classic", "sliding"] as const) {
    for (let i = 0; i < 3; i++) {
      const text = await openInbox(page, mode);
      const rooms = await page.locator("header").getByText(/^salas:/).textContent();
      console.log(`${mode} rodada ${i + 1}: ${text}; ${rooms}`);
    }
    await page.screenshot({ path: `${OUT}/03-lista-${mode}.png` });
  }
  // Sliding Sync: abre a conversa mais recente com o consumidor e responde.
  await page.locator("[data-room-id]").filter({ hasText: "Conversa" }).first().click();
  await page.getByTestId("timeline").getByText("Quero falar com um atendente").waitFor({ timeout: 30000 });
  await page.getByLabel("Mensagem").fill("Resposta enviada com Sliding Sync.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByTestId("timeline").getByText("Resposta enviada com Sliding Sync.").waitFor();
  await page.screenshot({ path: `${OUT}/04-sliding-sala.png` });
  console.log("sliding: sala aberta por assinatura e envio ok");
  await browser.close();
}

async function semFlag(): Promise<void> {
  const browser = await chromium.launch({ executablePath: process.env.POC_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ locale: "pt-BR" });
  await login(page);
  const response = await page.goto(`${APP}/app/${WS}/inbox`);
  console.log(`sem a flag, /app/${WS}/inbox (com sessão): HTTP ${response?.status()}`);
  const session = await page.request.post(`${APP}/api/matrix/poc/session`, { data: { workspaceSlug: WS } });
  console.log(`sem a flag, POST /api/matrix/poc/session (com sessão): HTTP ${session.status()}`);
  await browser.close();
}

const command = process.argv[2];
(command === "lista" ? lista() : command === "sem-flag" ? semFlag() : conversa()).then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
