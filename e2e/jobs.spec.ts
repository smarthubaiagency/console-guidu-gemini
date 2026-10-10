/**
 * ============================================================================
 * File: e2e/jobs.spec.ts
 * Module: End-to-End Tests for background jobs (ADR 0002, F3a)
 *
 * Maintenance Rationale:
 * - A workspace owner asks for a hello-world record "em segundo plano"; the
 *   run appears in Execuções as queued, the real worker process (`pnpm
 *   worker`) runs it, and the page shows it done with the record created.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test("a background job is queued, run by the worker and shown in Execuções", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("jobs-owner");
  const wsSlug = `ws-jobs-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Jobs Org ${Date.now()}`,
    orgSlug: `jobs-org-${Date.now()}`,
    wsName: "Jobs Workspace",
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);

  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Hello World" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}/hello-world/records`);
  await page.getByLabel("Título do registro").fill("Criado pelo worker");
  await page.getByRole("button", { name: "Em segundo plano" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Acompanhe em Execuções",
  );

  await page.goto(`/app/${wsSlug}/executions`);
  const runs = page.getByTestId("job-runs");
  await expect(runs).toContainText(
    "Cria um registro de exemplo em segundo plano.",
  );
  await expect(runs.getByTestId("job-run-status")).toHaveText("Na fila");

  expect(await runJobs(request)).toBe(0);

  await page.reload();
  await expect(runs.getByTestId("job-run-status")).toHaveText("Concluída");
  await expect(runs).toContainText("tentativas 1/3");

  await page.goto(`/app/${wsSlug}/hello-world/records`);
  await expect(page.getByText("Criado pelo worker")).toBeVisible();
});
