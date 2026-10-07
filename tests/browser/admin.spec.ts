import { test, expect, type Page } from "@playwright/test";
import { resources } from "../../shared/resources";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Login", { exact: true }).fill("fixture-admin");
  await page.locator('input[type="password"]').fill("fixture-password");
  await page.getByRole("button", { name: /Sign in$/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText("Test Administrator", { exact: true }),
  ).toBeAttached();
}
test("all resource lists and details render without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  for (const resource of resources) {
    await page.goto(`/${resource.name}`);
    await expect(
      page.getByRole("heading", { name: resource.label, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ant-table-row").first()).toBeVisible();
    await page
      .getByRole("button", { name: "View", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("tab", { name: "Details", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ant-descriptions")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test("asset create, edit, view-only assignments and delete", async ({
  page,
}) => {
  await login(page);
  await page.goto("/assets/new");
  await page.getByLabel("Label", { exact: true }).fill("Browser QA asset");
  await page.getByRole("button", { name: /Save asset$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Browser QA asset", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Assignments", exact: true }).click();
  await expect(
    page.getByText("User and group assignments are view-only.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /assign|membership/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Edit$/ }).click();
  await page.getByLabel("Label", { exact: true }).fill("Updated QA asset");
  await page.getByRole("button", { name: /Save asset$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Updated QA asset", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Delete$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page).toHaveURL(/\/assets(?:\?|$)/);
});
test("equipment forms expose canonical fields and persist edits", async ({
  page,
}) => {
  await login(page);
  await page.goto("/devices/1/edit");
  const label = `Updated QA device ${Date.now()}`;
  await page.getByLabel("Label", { exact: true }).fill(label);
  await page.screenshot({
    path: "test-results/device-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Save device$/ }).click();
  await expect(
    page.getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
});
test("mobile navigation remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.screenshot({
    path: "test-results/mobile-overview.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("menuitem", { name: "Assets", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Assets", exact: true }),
  ).toBeVisible();
});
test("internal navigation offers to keep unsaved edits", async ({ page }) => {
  await login(page);
  await page.goto("/assets/1/edit");
  await page.getByLabel("Label", { exact: true }).fill("Unsaved QA value");
  await page.getByRole("button", { name: /Back$/ }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(
    "Unsaved QA value",
  );
  await page.getByRole("button", { name: /Back$/ }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/1$/);
});
test("sensor history loads the documented readings", async ({ page }) => {
  await login(page);
  await page.goto("/sensor-history?idsensor=1");
  await page.getByRole("button", { name: /Load history$/ }).click();
  await expect(
    page.getByRole("cell", { name: "2026-09-16 10:30:00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "21.5", exact: true }),
  ).toBeVisible();
});
