import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  for (const { route, table, columns } of [
    {
      route: "/users",
      table: ".employee-card .employee-table",
      columns: [
        "Team member",
        "Department",
        "Position",
        "Questions",
        "Access",
        "Actions",
      ],
    },
    {
      route: "/chat-logs",
      table: ".questions-list-card .conversation-table",
      columns: [
        "User",
        "Question & AI response",
        "Date & time",
        "Status",
        "Details",
      ],
    },
  ]) {
    test(`${route} column headers match the reference at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(route);
      const headers = page.locator(`${table} thead th`);
      await expect(headers).toHaveText(columns);
      await expect(headers.first()).toHaveCSS(
        "background-color",
        "rgb(224, 241, 235)",
      );
      await expect(headers.first()).toHaveCSS("color", "rgb(6, 78, 59)");
      await expect(headers.first()).toHaveCSS("font-weight", "700");
      await expect(headers.first()).toHaveCSS("font-size", "18.75px");
      await expect(headers.first()).toHaveCSS("border-top-width", "2px");
      await expect(headers.first()).toHaveCSS(
        "border-top-color",
        "rgb(25, 147, 107)",
      );
      await expect(headers.first()).toHaveCSS(
        "border-top-left-radius",
        "12.5px",
      );
      await expect(headers.last()).toHaveCSS(
        "border-top-right-radius",
        "12.5px",
      );
      await expect(headers.first()).toHaveCSS("border-right-width", "1px");
      const labelsFit = await headers.evaluateAll((cells) =>
        cells.every((cell) => {
          if (cell.querySelector(".sr-only")) return true;
          const range = document.createRange();
          range.selectNodeContents(cell);
          const label = range.getBoundingClientRect();
          const column = cell.getBoundingClientRect();
          return label.left >= column.left && label.right <= column.right;
        }),
      );
      expect(labelsFit).toBe(true);
      await expect(page.locator(`${table} tbody tr`).first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/table-header-${route.slice(1)}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}

test("management table header styling does not change other pages", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.locator(".recent-card .conversation-table thead th").first(),
  ).toHaveCSS("font-weight", "500");
  await page.goto("/documents");
  await expect(
    page.locator(".department-document-table thead th").first(),
  ).toHaveCSS("font-weight", "500");
});
