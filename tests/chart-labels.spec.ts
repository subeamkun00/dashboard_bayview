import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`every non-zero chart point has a value label at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const chart = page.locator(".questions-chart");
    const periods = page.getByRole("group", {
      name: "Chart period",
      exact: true,
    });
    for (const period of ["Daily", "Weekly", "Monthly"]) {
      await periods.getByRole("button", { name: period, exact: true }).click();
      await expect(chart).toHaveAttribute(
        "aria-label",
        new RegExp(period.toLowerCase()),
      );
      const description = (await chart.getAttribute("aria-label")) || "";
      const expected = [...description.matchAll(/, (\d+)(?=;|$)/g)]
        .map((match) => Number(match[1]))
        .filter((value) => value > 0)
        .map((value) => value.toLocaleString("en-US"));
      expect(expected.length).toBeGreaterThan(0);
      await expect(chart.locator(".chart-value-label")).toHaveText(expected);
      if (period === "Daily") {
        await expect(chart.locator(".recharts-line-dots circle")).toHaveCount(
          expected.length,
        );
      }
    }
  });
}
