import { expect, test } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";

const demo = createDemoData();
const pending = demo.chats.filter(
  (chat) => chat.response_status === "fallback",
);

for (const width of [1920, 1440, 1280, 390]) {
  test(`pending replies appear in a yellow right-aligned toolbar bubble at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/chat-logs");
    const toolbar = page.locator(".questions-toolbar");
    const bubble = toolbar.locator(".pending-replies-bubble");
    const sort = page.getByLabel("Sort conversations", { exact: true });
    await expect(bubble).toBeVisible();
    await expect(bubble.locator(".pending-replies-reset")).toHaveText(
      "Show all",
    );
    await expect(bubble.locator("strong")).toHaveText(
      pending.length.toLocaleString("en-US"),
    );
    await expect(bubble).toHaveCSS("background-color", "rgb(255, 245, 223)");
    await expect(bubble).toHaveCSS("border-radius", "999px");
    await expect(page.locator(".waiting-banner")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width >= 1280) {
      const bubbleBox = (await bubble.boundingBox())!;
      const sortBox = (await sort.boundingBox())!;
      expect(
        Math.abs(
          bubbleBox.y + bubbleBox.height / 2 - sortBox.y - sortBox.height / 2,
        ),
      ).toBeLessThan(2);
      expect(bubbleBox.x).toBeGreaterThanOrEqual(sortBox.x + sortBox.width);
    }
    await page.screenshot({
      path: `test-results/pending-replies-bubble-${width}.png`,
      animations: "disabled",
    });
    await bubble.click();
    await expect(bubble).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(".questions-list-card .card-header h2"),
    ).toHaveText(`${pending.length.toLocaleString("en-US")} Questions`);
    await expect(bubble.locator(".pending-replies-reset")).toHaveText(
      "Hide all",
    );
    await bubble.click();
    await expect(bubble).toHaveAttribute("aria-pressed", "false");
    await expect(bubble.locator(".pending-replies-reset")).toHaveText(
      "Show all",
    );
    await expect(
      page.locator(".questions-list-card .card-header h2"),
    ).toHaveText(`${demo.chats.length.toLocaleString("en-US")} Questions`);
    await sort.selectOption("oldest");
    const search = page.getByPlaceholder("Search questions or responses...");
    await search.fill("annual leave");
    await bubble.click();
    await expect(sort).toHaveValue("oldest");
    await expect(search).toHaveValue("annual leave");
    await expect(bubble.locator("strong")).toHaveText(
      pending.length.toLocaleString("en-US"),
    );
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(
      page.getByLabel("Response status", { exact: true }),
    ).toHaveValue("fallback");
  });
}
