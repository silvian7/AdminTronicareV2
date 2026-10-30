import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const ruleId = "9223372036854775807";
const secondRuleId = "9223372036854775806";
const ruleLabel = "Synthetic counted action rule";
const secondRuleLabel = "Synthetic other counted action rule";

function action(id: string, parent = ruleId): RecordData {
  return {
    id,
    m_nIDAction: id,
    m_nIDRule: parent,
    m_nIDActionType: "0",
    m_nIDAsset: "0",
    m_sLabel: `Synthetic counted action ${id}`,
    m_bEnabled: true,
  };
}

async function mockRuleActions(
  page: Page,
  options: {
    canReadActions?: boolean;
    rows?: RecordData[];
    total?: number;
    limited?: boolean;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic rule action counter",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "rules", rights: "r" },
      ...(options.canReadActions === false
        ? []
        : [{ entity: "actions", rights: "r" }]),
    ],
  };
  const rules: RecordData[] = [
    {
      id: ruleId,
      m_nIDRule: ruleId,
      m_nIDSensor: "0",
      m_nIDRuleType: "0",
      m_nIDAsset: "0",
      m_sLabel: ruleLabel,
    },
    {
      id: secondRuleId,
      m_nIDRule: secondRuleId,
      m_nIDSensor: "0",
      m_nIDRuleType: "0",
      m_nIDAsset: "0",
      m_sLabel: secondRuleLabel,
    },
  ];
  const rows = options.rows ?? [action("101"), action("102"), action("103")];
  const collections: Record<
    string,
    { rows: RecordData[]; total: number; limited: boolean; status?: number }
  > = {
    [ruleId]: {
      rows,
      total: options.total ?? rows.length,
      limited: options.limited ?? false,
    },
    [secondRuleId]: {
      rows: [action("201", secondRuleId)],
      total: 1,
      limited: false,
    },
  };
  const holds = new Map<
    string,
    { entered: () => void; released: Promise<void> }
  >();
  const reads: URL[] = [];
  const mutations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
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
        csrf: "synthetic-rule-action-count-csrf",
        expiresAt: Date.now() + 60 * 60_000,
      });
    if (path === "/api/resources/rules")
      return reply({ data: rules, total: rules.length });
    const rule = rules.find((row) => path === `/api/resources/rules/${row.id}`);
    if (rule) return reply({ data: rule });
    if (path === "/api/resources/actions") {
      reads.push(url);
      const parent = url.searchParams.get("idrule") ?? "";
      const collection = collections[parent];
      if (!collection)
        return reply({ message: "Synthetic exact rule filter required." }, 400);
      const hold = holds.get(parent);
      if (hold) {
        holds.delete(parent);
        hold.entered();
        await hold.released;
      }
      if (collection.status)
        return reply(
          { message: "Synthetic rule actions unavailable." },
          collection.status,
        );
      return reply({
        data: collection.rows,
        total: collection.total,
        limited: collection.limited,
      });
    }
    // Every API call stays synthetic, including references and shell panels.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    mutations,
    replace: (rows: RecordData[]) => {
      collections[ruleId] = { rows, total: rows.length, limited: false };
    },
    fail: () => {
      collections[ruleId].status = 503;
    },
    hold: (id: string) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.set(id, { entered: enter, released });
      return { entered, release };
    },
  };
}

async function openRule(page: Page) {
  await page.goto(`/rules/${ruleId}`);
  await expect(
    page.getByRole("heading", { name: ruleLabel, exact: true }),
  ).toBeVisible();
}

function actionTab(page: Page, label: string) {
  return page.getByRole("tab", { name: label, exact: true });
}

async function settleBrowserWork(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("the Actions tab shows its count before opening and shares the exact scoped collection with the list", async ({
  page,
}, testInfo) => {
  const mock = await mockRuleActions(page);
  await openRule(page);
  await expect(actionTab(page, "Actions (3)")).toBeVisible();
  await expect(actionTab(page, "Details")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(mock.reads).toHaveLength(1);
  await page.screenshot({
    path: testInfo.outputPath("rule-actions-count.png"),
    fullPage: true,
    animations: "disabled",
  });
  await actionTab(page, "Actions (3)").click();
  for (const id of ["101", "102", "103"])
    await expect(
      page.getByRole("link", {
        name: `Synthetic counted action ${id}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/actions/${id}`);
  await settleBrowserWork(page);
  expect(mock.reads).toHaveLength(1);
  expect(mock.reads[0].searchParams.get("idrule")).toBe(ruleId);
  expect(mock.reads[0].searchParams.get("_organization")).toBe("7");
  expect(mock.reads[0].searchParams.get("_pageSize")).toBe("10000");
  expect(mock.mutations).toEqual([]);
});

test("a successful empty collection displays Actions (0)", async ({ page }) => {
  const mock = await mockRuleActions(page, { rows: [] });
  await openRule(page);
  await expect(actionTab(page, "Actions (0)")).toBeVisible();
  await actionTab(page, "Actions (0)").click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator(".ant-table-tbody .ant-table-row")).toHaveCount(0);
  expect(mock.reads).toHaveLength(1);
});

test("a limited count uses the reported total rather than the displayed row count", async ({
  page,
}) => {
  const mock = await mockRuleActions(page, { total: 23, limited: true });
  await openRule(page);
  await expect(actionTab(page, "Actions (23+)")).toBeVisible();
  await actionTab(page, "Actions (23+)").click();
  await expect(page.locator(".ant-table-tbody .ant-table-row")).toHaveCount(3);
  await expect(
    page.getByText("This collection is limited by the service.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(mock.reads).toHaveLength(1);
});

test("Refresh updates both the count and the action rows while either tab is active", async ({
  page,
}) => {
  const mock = await mockRuleActions(page);
  await openRule(page);
  await expect(actionTab(page, "Actions (3)")).toBeVisible();
  mock.replace([action("101"), action("104")]);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(actionTab(page, "Actions (2)")).toBeVisible();
  await expect(actionTab(page, "Details")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await actionTab(page, "Actions (2)").click();
  await expect(page.locator(".ant-table-tbody .ant-table-row")).toHaveCount(2);
  await expect(
    page.getByRole("link", {
      name: "Synthetic counted action 104",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Synthetic counted action 102",
      exact: true,
    }),
  ).toHaveCount(0);
  mock.replace([]);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(actionTab(page, "Actions (0)")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".ant-table-tbody .ant-table-row")).toHaveCount(0);
  expect(mock.reads).toHaveLength(3);
  expect(mock.mutations).toEqual([]);
});

test("missing action read permission leaves an uncounted tab and makes no action request", async ({
  page,
}) => {
  const mock = await mockRuleActions(page, { canReadActions: false });
  await openRule(page);
  await expect(actionTab(page, "Actions")).toBeVisible();
  await actionTab(page, "Actions").click();
  await expect(
    page.getByText("You do not have access to these records.", { exact: true }),
  ).toBeVisible();
  expect(mock.reads).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

test("a failed refresh removes the old count without reporting a false zero and retry restores it", async ({
  page,
}) => {
  const mock = await mockRuleActions(page);
  await openRule(page);
  await expect(actionTab(page, "Actions (3)")).toBeVisible();
  mock.fail();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(actionTab(page, "Actions")).toBeVisible();
  await expect(actionTab(page, "Actions (0)")).toHaveCount(0);
  await expect(actionTab(page, "Actions (3)")).toHaveCount(0);
  await actionTab(page, "Actions").click();
  await expect(
    page.getByText("Synthetic rule actions unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  mock.replace([]);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(actionTab(page, "Actions (0)")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  expect(mock.mutations).toEqual([]);
});

test("navigating to another rule hides the previous count until the new exact rule query finishes", async ({
  page,
}) => {
  const mock = await mockRuleActions(page);
  await openRule(page);
  await expect(actionTab(page, "Actions (3)")).toBeVisible();
  const held = mock.hold(secondRuleId);
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await page.locator(`tr[data-row-key="${secondRuleId}"]`).focus();
  await page.locator(`tr[data-row-key="${secondRuleId}"]`).press("Enter");
  await expect(
    page.getByRole("heading", { name: secondRuleLabel, exact: true }),
  ).toBeVisible();
  await held.entered;
  await expect(actionTab(page, "Actions")).toBeVisible();
  await expect(actionTab(page, "Actions (3)")).toHaveCount(0);
  held.release();
  await expect(actionTab(page, "Actions (1)")).toBeVisible();
  await actionTab(page, "Actions (1)").click();
  await expect(
    page.getByRole("link", {
      name: "Synthetic counted action 201",
      exact: true,
    }),
  ).toBeVisible();
  expect(mock.reads.map((url) => url.searchParams.get("idrule"))).toEqual([
    ruleId,
    secondRuleId,
  ]);
  expect(mock.mutations).toEqual([]);
});
