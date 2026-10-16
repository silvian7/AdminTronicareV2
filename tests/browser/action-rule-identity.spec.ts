import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const ruleId = "9223372036854775807";
const actionLabel = "Synthetic action rule identity";
const ruleTag = "SYNTHETIC-LINKED-RULE-TAG";
const ruleLabel = "Synthetic descriptive linked rule label";
const translated = (text: string) =>
  JSON.stringify({
    messages: [
      { lang: "fr", text: "SYNTHETIC-REGLE-FRANCAISE" },
      { lang: "en", text },
    ],
  });

async function mockActionRule(
  page: Page,
  options: {
    canReadRules?: boolean;
    status?: number;
    mismatchedId?: boolean;
    reference?: unknown;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic action rule reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "actions", rights: "r" },
      ...(options.canReadRules === false
        ? []
        : [{ entity: "rules", rights: "r" }]),
    ],
  };
  const action: RecordData = {
    id: "41",
    m_nIDAction: "41",
    m_nIDRule: "reference" in options ? options.reference : ruleId,
    m_nIDActionType: "0",
    m_nIDAsset: "0",
    m_sLabel: actionLabel,
  };
  const rule = {
    id: options.mismatchedId ? "42" : ruleId,
    m_nIDRule: options.mismatchedId ? "42" : ruleId,
    m_sTag: translated(ruleTag),
    m_sLabel: translated(ruleLabel),
  };
  const reads: URL[] = [];
  const mutations: string[] = [];
  let status = options.status ?? 200;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, responseStatus = 200) =>
      route.fulfill({
        status: responseStatus,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return reply({ message: "Synthetic read-only operation." }, 405);
    }
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-action-rule-csrf",
        expiresAt: Date.now() + 60 * 60_000,
      });
    if (path === "/api/resources/actions/41") return reply({ data: action });
    if (path.startsWith("/api/resources/rules/")) {
      reads.push(url);
      if (path !== `/api/resources/rules/${ruleId}`)
        return reply({ message: "Synthetic exact rule ID required." }, 404);
      return status === 200
        ? reply({ data: rule })
        : reply({ message: "Synthetic linked rule unavailable." }, status);
    }
    // Every API request, including unrelated reference collections, is synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    mutations,
    rename: () => {
      rule.m_sTag = "RENAMED-SYNTHETIC-LINKED-RULE";
      rule.m_sLabel = "Renamed synthetic linked rule label";
    },
    deny: () => {
      status = 403;
    },
  };
}

function ruleField(page: Page) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Rule$/ })
    .locator("xpath=following-sibling::*[1]");
}

async function openAction(page: Page) {
  await page.goto("/actions/41");
  await expect(
    page.getByRole("heading", { name: actionLabel, exact: true }),
  ).toBeVisible();
}

test("Action Rule shows the translated tag, label and exact ID with links to the corresponding rule", async ({
  page,
}, testInfo) => {
  const mock = await mockActionRule(page);
  await openAction(page);
  const field = ruleField(page);
  for (const name of [ruleTag, ruleLabel])
    await expect(
      field.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", `/rules/${ruleId}`);
  await expect(field.getByText(`#${ruleId}`, { exact: true })).toBeVisible();
  expect(mock.reads.map((url) => url.pathname)).toEqual([
    `/api/resources/rules/${ruleId}`,
  ]);
  expect(mock.mutations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("action-rule-identity.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("missing rule read permission preserves the ID without fetching or linking rule metadata", async ({
  page,
}) => {
  const mock = await mockActionRule(page, { canReadRules: false });
  await openAction(page);
  const field = ruleField(page);
  await expect(field).toHaveText(`#${ruleId}`);
  await expect(field.getByRole("link")).toHaveCount(0);
  expect(mock.reads).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

for (const failure of ["missing", "mismatched"])
  test(`${failure} rule metadata cannot replace the requested rule ID`, async ({
    page,
  }) => {
    const mock = await mockActionRule(page, {
      status: failure === "missing" ? 404 : 200,
      mismatchedId: failure === "mismatched",
    });
    const resolved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/resources/rules/${ruleId}`,
    );
    await openAction(page);
    await resolved;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const field = ruleField(page);
    await expect(field).toHaveText(`#${ruleId}`);
    await expect(field.getByRole("link")).toHaveCount(0);
    expect(mock.reads).toHaveLength(1);
    expect(mock.mutations).toEqual([]);
  });

for (const reference of [undefined, "0"])
  test(`${reference === undefined ? "missing" : "zero"} rule references do not trigger record lookups`, async ({
    page,
  }) => {
    const mock = await mockActionRule(page, { reference });
    await openAction(page);
    await expect(ruleField(page)).toHaveText(
      reference === undefined ? "—" : "#0",
    );
    await expect(ruleField(page).getByRole("link")).toHaveCount(0);
    expect(mock.reads).toEqual([]);
    expect(mock.mutations).toEqual([]);
  });

test("Action Refresh updates rule identity and removes cached tag and label after denied reads", async ({
  page,
}) => {
  const mock = await mockActionRule(page);
  await openAction(page);
  const field = ruleField(page);
  await expect(field).toContainText(ruleTag);
  await expect(field).toContainText(ruleLabel);
  mock.rename();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(field).toContainText("RENAMED-SYNTHETIC-LINKED-RULE");
  await expect(field).toContainText("Renamed synthetic linked rule label");
  await expect(field).not.toContainText(ruleTag);
  await expect(field).not.toContainText(ruleLabel);
  mock.deny();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(field).toHaveText(`#${ruleId}`);
  await expect(field.getByRole("link")).toHaveCount(0);
  expect(mock.reads).toHaveLength(3);
  expect(mock.mutations).toEqual([]);
});
