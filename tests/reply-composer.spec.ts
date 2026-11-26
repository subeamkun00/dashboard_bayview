import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`reply composer matches the reference and preserves reply controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/chats/"))
        sent.push(request.url());
    });
    await page.goto("/chat-logs?status=fallback");
    await page.locator(".question-cell").first().click();
    const dialog = page.getByRole("dialog", { name: "Conversation details" });
    const composer = dialog.getByRole("region", {
      name: "Replies to this employee",
      exact: true,
    });
    await expect(
      composer.getByRole("heading", { name: "Replies to this employee" }),
    ).toBeVisible();
    await expect(composer).toHaveCSS("background-color", "rgb(247, 250, 247)");
    const text = composer.getByLabel("Reply message", { exact: true });
    const send = composer.getByRole("button", {
      name: "Send reply",
      exact: true,
    });
    const reuse = composer.getByRole("checkbox", {
      name: "Use this answer when the same question is asked again",
    });
    const scope = composer.getByLabel(
      "Who the assistant may use this answer for",
    );
    const count = composer.getByLabel("Reply character count");
    await expect(text).toHaveAttribute(
      "placeholder",
      "Type your answer here...",
    );
    await expect(send).toBeDisabled();
    await expect(send).toHaveCSS("background-color", "rgb(160, 201, 178)");
    await expect(count).toHaveText("0/2000");
    await expect(reuse).toBeChecked();
    await expect(scope).toHaveValue("department");
    await scope.selectOption("hotel");
    await reuse.uncheck();
    await expect(scope).toHaveCount(0);
    await reuse.check();
    await expect(scope).toHaveValue("hotel");
    await composer.getByLabel("Reply attachments").setInputFiles({
      name: "guide.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo attachment"),
    });
    await expect(
      composer.getByRole("list", { name: "Files to send" }),
    ).toContainText("guide.pdf");
    await expect(send).toBeEnabled();
    await composer.getByRole("button", { name: "Remove guide.pdf" }).click();
    await expect(send).toBeDisabled();
    await text.fill("Please contact the front office for assistance.");
    await expect(count).toHaveText(
      `${"Please contact the front office for assistance.".length}/2000`,
    );
    await expect(send).toBeEnabled();
    await expect(send).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(composer).toContainText("Up to 5 files, 20 MB in total.");
    expect(
      await composer.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    if (width >= 1440) {
      const labelBox = (await reuse.locator("..").boundingBox())!;
      const scopeBox = (await scope.boundingBox())!;
      expect(
        Math.abs(
          labelBox.y + labelBox.height / 2 - scopeBox.y - scopeBox.height / 2,
        ),
      ).toBeLessThan(5);
    }
    await composer.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/reply-composer-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await send.click();
    await expect(dialog.locator(".admin-message .chat-text")).toHaveText(
      "Please contact the front office for assistance.",
    );
    await expect(text).toHaveValue("");
    await expect(send).toBeDisabled();
    expect(sent).toEqual([]);
  });
}
