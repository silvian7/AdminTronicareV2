import { expect, test } from "@playwright/test";

test("failed one-time sign-in retains the form and a persistent error", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/session/login")
      await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "The synthetic code is invalid." }),
    });
  });
  await page.goto("/login");
  await page.getByText("One-time code", { exact: true }).click();
  await page.getByLabel("Login", { exact: true }).fill("synthetic-account");
  const credential = page.locator("#password");
  await credential.fill("INVALID-CODE");
  await page.getByRole("button", { name: /Sign in$/ }).click();

  await expect(page.getByRole("radio", { name: "One-time code" })).toBeChecked();
  await expect(page.locator(".ant-alert")).toContainText(
    "The synthetic code is invalid.",
  );
  await expect(page.getByLabel("Login", { exact: true })).toHaveValue(
    "synthetic-account",
  );
  await expect(credential).toHaveValue("INVALID-CODE");
  await expect(page).toHaveURL(/\/login$/);
});
