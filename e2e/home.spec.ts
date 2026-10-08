import { expect, test } from "@playwright/test";
test("shows the configurable application name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "GUIDU" })).toBeVisible();
});
