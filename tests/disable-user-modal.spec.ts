import { expect, test } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";

const employee = {
  ...createDemoData().users[0],
  display_name: "jatuporn subin",
  access_enabled: true,
};

for (const width of [1440, 390, 320]) {
  test(`disable confirmation follows the reference and remains usable at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript((user) => {
      localStorage.setItem("bayview-demo-users", JSON.stringify([user]));
    }, employee);
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto("/users");
    await page
      .getByRole("button", { name: "Edit jatuporn subin", exact: true })
      .click();
    const disable = page.getByRole("button", {
      name: "Disable user",
      exact: true,
    });
    await disable.click();
    const modal = page.getByRole("dialog", {
      name: "Disable this user?",
      exact: true,
    });
    await expect(modal).toBeVisible();
    await expect(modal.locator(".employee-confirm-name")).toHaveText(
      "jatuporn subin",
    );
    await expect(modal.getByRole("heading", { level: 4 })).toHaveText([
      "Access removed",
      "LINE & email reset",
      "Question history kept",
    ]);
    await expect(modal.locator(".employee-disable-warning")).toHaveCSS(
      "background-color",
      "rgb(255, 244, 244)",
    );
    await expect(modal).toContainText(
      "Existing invite codes will no longer work.",
    );
    await expect(modal).toContainText(
      "Their profile and question history will remain stored.",
    );
    await expect(modal.locator(".employee-disable-note")).toContainText(
      "after access is enabled",
    );
    const confirm = modal.getByRole("button", {
      name: "Disable user",
      exact: true,
    });
    await expect(confirm).toHaveCSS("color", "rgb(255, 255, 255)");
    expect(
      await modal.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await confirm.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/disable-confirmation-${width}.png`,
    });
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(disable).toBeFocused();
    await expect(page.locator(".employee-table .employee-access")).toHaveText(
      "Enabled",
    );
    await disable.click();
    await modal
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(modal).not.toBeVisible();
    await disable.click();
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
    await disable.click();
    await confirm.click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator(".employee-table .employee-access")).toHaveText(
      "Disabled",
    );
  });
}
