import { expect, test } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";

const users = createDemoData()
  .users.slice(0, 12)
  .map((user, index) => ({
    ...user,
    id: `height-user-${index}`,
    display_name: `Employee ${String(index).padStart(2, "0")}`,
    nickname: "Team",
  }));

for (const width of [1376, 1440, 1920]) {
  test(`desktop editor follows table height across pagination, search and resize at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(
      (records) =>
        localStorage.setItem("bayview-demo-users", JSON.stringify(records)),
      users,
    );
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/users");
    await page.getByLabel("Sort users").selectOption("name");
    await page
      .getByRole("button", { name: "Edit Employee 00", exact: true })
      .click();
    const editor = page.getByRole("region", { name: "Edit user", exact: true });
    async function expectAligned() {
      await expect
        .poll(async () => {
          const table = await page.locator(".employee-card").boundingBox();
          const panel = await editor.boundingBox();
          return Math.max(
            Math.abs(table!.y - panel!.y),
            Math.abs(table!.height - panel!.height),
          );
        })
        .toBeLessThanOrEqual(1);
    }
    await expectAligned();
    const fullHeight = (await editor.boundingBox())!.height;
    await page
      .getByRole("navigation", { name: "User pagination", exact: true })
      .getByRole("button", { name: "Next" })
      .click();
    await expect(page.locator(".employee-table tbody tr")).toHaveCount(4);
    await expectAligned();
    expect((await editor.boundingBox())!.height).toBeLessThan(fullHeight);
    await page
      .getByPlaceholder("Search name or nickname...")
      .fill("Employee 00");
    await expect(page.locator(".employee-table tbody tr")).toHaveCount(1);
    await expectAligned();
    const scrollArea = editor.locator(".employee-editor-scroll");
    const scrollable = await scrollArea.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    );
    expect(scrollable).toBe(true);
    const headerBefore = await editor
      .locator(".employee-editor-header")
      .boundingBox();
    const footerBefore = await editor
      .locator(".employee-editor-footer")
      .boundingBox();
    await scrollArea.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const headerAfter = await editor
      .locator(".employee-editor-header")
      .boundingBox();
    const footerAfter = await editor
      .locator(".employee-editor-footer")
      .boundingBox();
    expect(headerAfter!.y).toBeCloseTo(headerBefore!.y);
    expect(footerAfter!.y).toBeCloseTo(footerBefore!.y);
    await page.getByPlaceholder("Search name or nickname...").fill("");
    await expectAligned();
    await page.setViewportSize({ width: width + 80, height: 900 });
    await expectAligned();
    await page.screenshot({
      path: `test-results/editor-aligned-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = page.getByRole("dialog", { name: "Edit user", exact: true });
    await expect(drawer).toBeVisible();
    expect((await drawer.boundingBox())!.height).toBe(844);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await drawer.getByRole("button", { name: "Close edit user" }).click();
    await expect(drawer).not.toBeVisible();
  });
}
