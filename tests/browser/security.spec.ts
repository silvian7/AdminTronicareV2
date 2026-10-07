import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { resources, type Identity } from "../../shared/resources";

const privateLabel = "Synthetic private asset for account A";
const privateRecord = {
  id: "1",
  m_nIDAsset: "1",
  m_nIDOrganization: "7",
  m_sLabel: privateLabel,
};

async function syntheticAccounts(
  surface: Page | BrowserContext,
  secondCanRead: boolean,
) {
  let current: "A" | "B" | null = null;
  let denyCurrentRecord = false;
  let expireNextRecord = false;
  const identities: Record<"A" | "B", Identity> = {
    A: {
      id: "100",
      name: "Synthetic A",
      organizationId: "7",
      userTypeId: "90",
      level: 90,
      mustChangePassword: false,
      permissions: resources.map((resource) => ({
        entity: resource.name,
        rights: "crud",
      })),
    },
    B: {
      id: "101",
      name: "Synthetic B",
      organizationId: "7",
      userTypeId: "30",
      level: 30,
      mustChangePassword: false,
      permissions: secondCanRead ? [{ entity: "assets", rights: "ru" }] : [],
    },
  };
  const session = () =>
    current && {
      identity: identities[current],
      csrf: `synthetic-${current}`,
      expiresAt: Date.now() + 60000,
    };
  await surface.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session/login") {
      current = route.request().postDataJSON().login === "A" ? "A" : "B";
      return reply(session());
    }
    if (path === "/api/session/logout") {
      current = null;
      return reply({ success: true });
    }
    if (path === "/api/session")
      return current
        ? reply(session())
        : reply({ message: "Sign in to continue." }, 401);
    if (!current) return reply({ message: "Sign in to continue." }, 401);
    if (path === "/api/resources/assets/1") {
      if (expireNextRecord) {
        expireNextRecord = false;
        current = null;
        return reply({ message: "The synthetic session expired." }, 401);
      }
      return current === "A" && !denyCurrentRecord
        ? reply({ data: privateRecord })
        : reply({ message: "This record is outside your scope." }, 403);
    }
    if (path === "/api/resources/assets") {
      if (current === "B" && !secondCanRead)
        return reply({ message: "Access unavailable." }, 403);
      return reply({
        data: current === "A" ? [privateRecord] : [],
        total: current === "A" ? 1 : 0,
      });
    }
    return reply({ data: [], total: 0 });
  });
  return {
    denyRecord: () => {
      denyCurrentRecord = true;
    },
    expireRecord: () => {
      expireNextRecord = true;
    },
  };
}

async function signIn(page: Page, login: "A" | "B") {
  await page.getByLabel("Login", { exact: true }).fill(login);
  await page.locator('input[type="password"]').fill("synthetic-password");
  await page.getByRole("button", { name: /Sign in$/ }).click();
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toContainText(`Synthetic ${login}`);
}

async function signOutFromAccount(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByText("My account", { exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByText("Sign out", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
}

async function watchForLeak(page: Page) {
  await page.evaluate((label) => {
    const state = { leaked: false };
    const observer = new MutationObserver(() => {
      if (
        document.body.innerText.includes("Synthetic B") &&
        document.body.innerText.includes(label)
      )
        state.leaked = true;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    Object.assign(window, { securityObservation: state });
  }, privateLabel);
}

async function assertNoLeak(page: Page) {
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { securityObservation: { leaked: boolean } })
          .securityObservation.leaked,
    ),
  ).toBe(false);
}

for (const secondCanRead of [false, true]) {
  test(`browser Back cannot expose a previous account's record (${secondCanRead ? "same resource rights, different visibility" : "no resource permission"})`, async ({
    page,
  }) => {
    await syntheticAccounts(page, secondCanRead);
    await page.goto("/login");
    await signIn(page, "A");
    await page.getByRole("link", { name: privateLabel, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: privateLabel, exact: true }),
    ).toBeVisible();
    await signOutFromAccount(page);
    await watchForLeak(page);
    await signIn(page, "B");
    // Keep the earlier detail route in history, as in the assessed reproduction.
    for (
      let back = 0;
      back < 3 && !new URL(page.url()).pathname.endsWith("/assets/1");
      back++
    )
      await page.goBack();
    await expect(page).toHaveURL(/\/assets\/1$/);
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toContainText("Synthetic B");
    await expect(
      page.getByText(
        secondCanRead
          ? "This record is outside your scope."
          : "Access unavailable",
        { exact: true },
      ),
    ).toBeVisible();
    await assertNoLeak(page);
    // A direct editor route also must not load the previous account's form values.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByText("My account", { exact: true }).click();
    await page.evaluate(() => {
      window.history.pushState({}, "", "/assets/1/edit");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(
      page.getByText(
        secondCanRead
          ? "This record is outside your scope."
          : "Changes are unavailable",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Label", { exact: true })).toHaveCount(0);
    await assertNoLeak(page);
  });
}

test("a scope-denied refetch removes cached detail data", async ({ page }) => {
  const accounts = await syntheticAccounts(page, true);
  await page.goto("/login");
  await signIn(page, "A");
  await page.getByRole("link", { name: privateLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  accounts.denyRecord();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    page.getByText("This record is outside your scope.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  await expect(page.locator(".ant-descriptions")).toHaveCount(0);
});

test("session expiry removes private records before another account signs in", async ({
  page,
}) => {
  const accounts = await syntheticAccounts(page, true);
  await page.goto("/login");
  await signIn(page, "A");
  await page.getByRole("link", { name: privateLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  accounts.expireRecord();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  await watchForLeak(page);
  await signIn(page, "B");
  await assertNoLeak(page);
});

test("shared-cookie tabs revoke cached records on another tab's logout and login", async ({
  page,
  context,
}) => {
  await syntheticAccounts(context, true);
  await page.goto("/login");
  await signIn(page, "A");
  await page.getByRole("link", { name: privateLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("button", { name: "Account menu" }),
  ).toContainText("Synthetic A");
  // Merely discovering the existing shared session must leave the first tab usable.
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  await signOutFromAccount(other);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  await signIn(other, "A");
  await other.getByRole("link", { name: privateLabel, exact: true }).click();
  await expect(
    other.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  await signIn(page, "B");
  await expect(
    other.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(other.getByText(privateLabel, { exact: true })).toHaveCount(0);
  const revision = await page.evaluate(() =>
    window.localStorage.getItem("tronicare-admin-session-revision"),
  );
  expect(revision).toMatch(/^[0-9a-f-]{36}$/);
  expect(revision).not.toContain("Synthetic");
  await other.close();
});

test("restoring a persisted document clears the protected session and cached records", async ({
  page,
}) => {
  await syntheticAccounts(page, true);
  await page.goto("/login");
  await signIn(page, "A");
  await page.getByRole("link", { name: privateLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  // Exercise the browser lifecycle event directly: intercepted network can disable real BFCache.
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  await watchForLeak(page);
  await signIn(page, "B");
  await assertNoLeak(page);
});
