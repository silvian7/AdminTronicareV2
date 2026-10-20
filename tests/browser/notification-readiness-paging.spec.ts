import { expect, test } from "@playwright/test";

test("registration reads follow only the currently visible user page", async ({
  page,
}) => {
  const ids = ["9223372036854775807", "41", "42", "43"];
  const batches: string[][] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/session")
      return reply({
        csrf: "synthetic-paging",
        expiresAt: Date.now() + 60000,
        identity: {
          id: "100",
          name: "Synthetic paging reader",
          organizationId: "7",
          userTypeId: "30",
          level: 30,
          mustChangePassword: false,
          permissions: [{ entity: "users", rights: "r" }],
        },
      });
    if (url.pathname === "/api/resources/users") {
      const size = Number(url.searchParams.get("_pageSize"));
      const start = (Number(url.searchParams.get("_page")) - 1) * size;
      return reply({
        data: ids
          .slice(start, start + size)
          .map((id) => ({
            id,
            m_nIDuser: id,
            m_nIDOrganization: "7",
            m_nIDUserType: "20",
            m_sFirst_name: `Synthetic${id}`,
            m_sLast_name: "Caregiver",
          })),
        total: ids.length,
      });
    }
    if (url.pathname === "/api/users/notification-readiness") {
      const requested = url.searchParams.get("ids")!.split(",");
      batches.push(requested);
      return reply({
        data: requested.map((userId) => ({
          userId,
          state: "available",
          registeredDeviceCount: 1,
          notificationReadiness: "registered",
          lastRegistrationAt: null,
        })),
      });
    }
    return reply({ data: [], total: 0 });
  });
  await page.goto("/users?currentPage=1&pageSize=2");
  await expect(page.getByText("Registered (1)", { exact: true })).toHaveCount(
    2,
  );
  expect(batches).toHaveLength(1);
  expect(new Set(batches[0])).toEqual(new Set(ids.slice(0, 2)));
  await page.locator(".ant-pagination-item-2").click();
  await expect(page.getByText("Synthetic42", { exact: true })).toBeVisible();
  await expect(page.getByText("Registered (1)", { exact: true })).toHaveCount(
    2,
  );
  expect(batches).toHaveLength(2);
  expect(new Set(batches[1])).toEqual(new Set(ids.slice(2)));
});
