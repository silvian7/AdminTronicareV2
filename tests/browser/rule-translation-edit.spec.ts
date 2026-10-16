import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const numericTag = {
  revision: 7,
  messages: [
    { lang: 3, text: "TAG-EN", origin: "legacy" },
    { lang: 5, text: "TAG-FR" },
    { lang: 12, text: "TAG-NL" },
  ],
};

const numericLabel = {
  source: { system: "synthetic", revision: 2 },
  messages: [
    { lang: 3, text: "Synthetic numeric translation rule", approved: true },
    { lang: 5, text: "Regle synthetique", origin: "legacy" },
    { lang: 12, text: "Synthetische regel" },
  ],
};

const mixedLabel = {
  source: { system: "synthetic", revision: 2 },
  messages: [
    { lang: 3, text: "Synthetic mixed translation rule", approved: true },
    { lang: 5, text: 42, origin: "legacy" },
    { lang: 12, text: { invalid: true } },
    { lang: 1033, text: "Unknown numeric language", marker: "keep" },
    { lang: 2, text: "Another unknown language" },
    null,
    { text: "Missing language" },
    { lang: null, text: "Null language" },
    { lang: { unexpected: 3 }, text: "Object language" },
    { lang: "de", text: "Unexposed language", extra: [1, 2] },
  ],
};

async function mockRuleTranslations(page: Page, label: unknown = numericLabel) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic translations administrator",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [{ entity: "rules", rights: "ru" }],
  };
  const rule: RecordData = {
    id: "41",
    m_nIDRule: "41",
    m_nIDRuleType: "0",
    m_nIDAsset: "0",
    m_nIDSensor: "0",
    m_sTag: JSON.stringify(numericTag),
    m_sLabel: JSON.stringify(label),
    m_nResetDelayMs: "45000",
    m_bEnabled: true,
  };
  const mutations: {
    method: string;
    path: string;
    body: Record<string, unknown>;
    csrf?: string;
  }[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-rule-translations-csrf",
        expiresAt: Date.now() + 60 * 60_000,
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({
        method: request.method(),
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      if (path === "/api/resources/rules/41" && request.method() === "PUT") {
        Object.assign(rule, body);
        return reply({ data: rule });
      }
      return reply({ message: "Synthetic operation unavailable." }, 405);
    }
    if (path === "/api/resources/rules/41") return reply({ data: rule });
    if (path === "/api/resources/rules")
      return reply({ data: [rule], total: 1 });
    // All references, selectors and tabs are synthetic, including empty ones.
    return reply({ data: [], total: 0 });
  });
  return { mutations, pageErrors, rule };
}

async function openRuleEditor(page: Page) {
  await page.goto("/rules/41");
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41\/edit$/);
  await expect(page.getByLabel("m_sTag (en)", { exact: true })).toBeVisible({
    timeout: 7000,
  });
}

async function translation(
  page: Page,
  field: "m_sTag" | "m_sLabel",
  language: "en" | "fr" | "nl",
) {
  const formItem = page
    .locator(".ant-form-item")
    .filter({ has: page.locator(`[id="${field}"]`) });
  const name = { en: "English", fr: "French", nl: "Dutch" }[language];
  await formItem.getByRole("tab", { name, exact: true }).click();
  const input = page.getByLabel(`${field} (${language})`, { exact: true });
  await expect(input).toBeVisible();
  return input;
}

test("rule detail opens an editor for numeric platform language codes", async ({
  page,
}, testInfo) => {
  const mock = await mockRuleTranslations(page);
  await openRuleEditor(page);
  for (const [language, tag, label] of [
    ["en", "TAG-EN", "Synthetic numeric translation rule"],
    ["fr", "TAG-FR", "Regle synthetique"],
    ["nl", "TAG-NL", "Synthetische regel"],
  ] as const) {
    await expect(await translation(page, "m_sTag", language)).toHaveValue(tag);
    await expect(await translation(page, "m_sLabel", language)).toHaveValue(
      label,
    );
    await page
      .locator(".ant-card")
      .filter({ has: page.getByLabel(`m_sTag (${language})`, { exact: true }) })
      .screenshot({
        path: testInfo.outputPath(`rule-numeric-translations-${language}.png`),
        animations: "disabled",
      });
  }
  await page.screenshot({
    path: testInfo.outputPath("rule-numeric-translations-edit.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(mock.pageErrors).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

test("malformed message entries and numeric text do not crash rule editing", async ({
  page,
}) => {
  const mock = await mockRuleTranslations(page, mixedLabel);
  await openRuleEditor(page);
  await expect(await translation(page, "m_sLabel", "en")).toHaveValue(
    "Synthetic mixed translation rule",
  );
  await expect(await translation(page, "m_sLabel", "fr")).toHaveValue("");
  await expect(await translation(page, "m_sLabel", "nl")).toHaveValue("");
  await expect(
    page.getByText("Unexpected Application Error!", { exact: true }),
  ).toHaveCount(0);
  expect(mock.pageErrors).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

test("editing known translations preserves language codes and all unrelated JSON metadata", async ({
  page,
}) => {
  const mock = await mockRuleTranslations(page, mixedLabel);
  await openRuleEditor(page);
  await (await translation(page, "m_sTag", "en")).fill("TAG-EDITED");
  await (await translation(page, "m_sLabel", "fr")).fill("Regle modifiee");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  expect(mock.mutations).toHaveLength(1);
  expect(mock.mutations[0]).toMatchObject({
    method: "PUT",
    path: "/api/resources/rules/41",
    csrf: "synthetic-rule-translations-csrf",
  });
  const body = mock.mutations[0].body;
  expect(Object.keys(body).sort()).toEqual(["m_sLabel", "m_sTag"]);
  const expectedTag = structuredClone(numericTag);
  expectedTag.messages[0].text = "TAG-EDITED";
  const expectedLabel = structuredClone(mixedLabel);
  expectedLabel.messages[1]!.text = "Regle modifiee";
  expect(JSON.parse(body.m_sTag as string)).toEqual(expectedTag);
  expect(JSON.parse(body.m_sLabel as string)).toEqual(expectedLabel);
  expect(mock.pageErrors).toEqual([]);
});

test("saving an unrelated field preserves raw translation JSON without resubmitting it", async ({
  page,
}) => {
  const mock = await mockRuleTranslations(page, mixedLabel);
  const originalTag = mock.rule.m_sTag;
  const originalLabel = mock.rule.m_sLabel;
  await openRuleEditor(page);
  await page.getByLabel("Reset delay (seconds)", { exact: true }).fill("60");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: "/api/resources/rules/41",
      body: { m_nResetDelayMs: "60000" },
      csrf: "synthetic-rule-translations-csrf",
    },
  ]);
  expect(mock.rule.m_sTag).toBe(originalTag);
  expect(mock.rule.m_sLabel).toBe(originalLabel);
  expect(mock.pageErrors).toEqual([]);
});
