import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`document groups start collapsed and reset after navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/documents");
    const toggles = page.locator(".department-toggle");
    const hr = toggles.filter({ hasText: "Human Resources" });
    const it = toggles.filter({ hasText: /^IT/ });
    async function expectCollapsed() {
      await expect(toggles).toHaveCount(10);
      await expect(
        page.locator('.department-toggle[aria-expanded="true"]'),
      ).toHaveCount(0);
      await expect(page.locator(".department-panel:visible")).toHaveCount(0);
    }
    async function navigate(name: string) {
      if (width < 1000)
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page.getByRole("link", { name, exact: true }).click();
    }
    await expectCollapsed();
    await hr.click();
    await expect(hr).toHaveAttribute("aria-expanded", "true");
    await it.click();
    await expect(it).toHaveAttribute("aria-expanded", "true");
    await hr.click();
    await expect(hr).toHaveAttribute("aria-expanded", "false");
    await expect(it).toHaveAttribute("aria-expanded", "true");
    await navigate("Users");
    await expect(page).toHaveURL(/\/users$/);
    await navigate("SOP Documents");
    await expectCollapsed();
    await hr.click();
    await expect(hr).toHaveAttribute("aria-expanded", "true");
    await page.goBack();
    await expect(page).toHaveURL(/\/users$/);
    await page.goForward();
    await expectCollapsed();
    const search = page.getByPlaceholder("Search departments or documents...");
    await search.fill("Human Resources");
    await expect(hr).toHaveAttribute("aria-expanded", "true");
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await expectCollapsed();
    await hr.click();
    await page.reload();
    await expectCollapsed();
  });
}
