/**
 * ============================================================================
 * File: e2e/design-maps.spec.ts
 * Module: End-to-End Tests for the maps component of the agent GMN (GB1b)
 *
 * Maintenance Rationale:
 * - Plataforma › Padrões de interface › Saúde no Maps shows the component the
 *   automation page plugs in, with a sample measurement of the fake
 *   provider: score with its math, SoLV, the 7×7 heat map, the competitors
 *   and one segmented tab per keyword. Nothing reads or writes data.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { expandSidebarGroup, sidebar } from "./support/sidebar";
import { totpCode } from "./support/totp";

test("the maps component shows the score, the heat map and the competitors", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail("maps-demo");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  await page.goto("/platform");
  await expandSidebarGroup(page, "Padrões de interface");
  await sidebar(page).getByRole("link", { name: "Saúde no Maps" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Saúde no Maps (demonstração)",
      level: 1,
    }),
  ).toBeVisible();

  const panel = page.getByTestId("maps-health");
  await expect(panel.getByTestId("maps-score")).toContainText("de 100");
  await expect(panel.getByTestId("maps-breakdown")).toContainText(
    "Visibilidade no mapa",
  );
  await expect(panel.getByTestId("maps-breakdown")).toContainText(
    "Ficha completa",
  );

  // The 7×7 grid: 49 squares, the middle one is the unit, in the top 3.
  const heatmap = panel.getByTestId("maps-heatmap").first();
  await expect(heatmap.getByRole("gridcell")).toHaveCount(49);
  await expect(heatmap.locator('[data-center="true"]')).toHaveAttribute(
    "data-band",
    "top3",
  );
  await expect(
    heatmap.getByRole("gridcell", { name: /Linha 4, coluna 4: posição/ }),
  ).toBeVisible();

  await expect(panel.getByTestId("maps-competitors").first()).toContainText(
    "Concorrente",
  );
  await expect(panel.getByText("Referência").first()).toBeVisible();

  // One tab per keyword.
  await page.waitForLoadState("networkidle");
  await panel.getByRole("tab", { name: "dentista perto de mim" }).click();
  await expect(
    panel.getByRole("tab", { name: "dentista perto de mim" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByText("Os mais fortes da grade para “dentista perto de mim”."),
  ).toBeVisible();
});
