/**
 * ============================================================================
 * File: e2e/security-headers.spec.ts
 * Module: End-to-End Tests for the HTTP security headers (F6a)
 *
 * Maintenance Rationale:
 * - Every page of /app, /admin and /platform answers with a CSP that carries
 *   a fresh nonce and blocks framing, plus the fixed headers of
 *   next.config.ts; the API gets the fixed headers too.
 * - Signing out works on a partner domain and stays on it.
 * - The pages work under the CSP: the browser reports no CSP violation and
 *   the theme script (which needs the nonce) runs.
 * ============================================================================
 */

import { expect, test, type Page, type Response } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedPartner,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { signOutFromShell } from "./support/sidebar";
import { totpCode } from "./support/totp";
import { RIG } from "./support/rig";

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

/** Collects the CSP violations the browser reports on the page. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

function expectSecurityHeaders(response: Response | null): string {
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  return csp;
}

async function visit(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  const csp = expectSecurityHeaders(response);
  await page.waitForLoadState("networkidle");
  // next-themes writes data-theme from an inline script that needs the nonce.
  await expect(page.locator("html")).toHaveAttribute("data-theme", /.+/);
  return csp;
}

test("pages of /app, /admin and /platform run under the CSP", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);

  // /app and /platform, on the platform host.
  const email = uniqueEmail("csp");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `CSP ${stamp}`,
    orgSlug: `csp-${stamp}`,
    wsName: "CSP",
    wsSlug: `csp-${stamp}`,
  });
  const violations = watchCsp(page);
  await signIn(page, email);
  await enrolMfa(page);
  const first = await visit(page, `/app/csp-${stamp}`);
  const second = await visit(page, "/platform");
  // A fresh nonce on every request.
  expect(first).not.toBe(second);
  expect(violations).toEqual([]);

  // /admin, on a partner host.
  const host = `csp-${stamp}.localhost`;
  const ownerEmail = uniqueEmail("csp-partner");
  await createIdentity(request, ownerEmail);
  await seedPartner(request, {
    slug: `csp-${stamp}`,
    name: "Agência CSP",
    host,
    memberEmail: ownerEmail,
    role: "partner_owner",
  });
  const partnerContext = await browser.newContext({
    baseURL: `http://${host}:${RIG.appPort}`,
  });
  const owner = await partnerContext.newPage();
  const partnerViolations = watchCsp(owner);
  await signIn(owner, ownerEmail);
  await enrolMfa(owner);
  await visit(owner, "/admin");
  expect(partnerViolations).toEqual([]);
  // Signing out works on the partner domain and stays on it.
  await signOutFromShell(owner);
  await expect(owner).toHaveURL(
    new RegExp(`^http://${host}:${RIG.appPort}/login\\?notice=signed-out$`),
  );
  await partnerContext.close();
});

test("the API answers with the fixed security headers", async ({ request }) => {
  const response = await request.get("/api/health/live");
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
});
