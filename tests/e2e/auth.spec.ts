import { expect, test } from "@playwright/test";

test("an unauthenticated visitor is redirected to Clerk sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});
