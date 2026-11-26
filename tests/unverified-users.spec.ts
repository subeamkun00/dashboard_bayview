import { expect, test, type Page } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";
import {
  assistantAccess,
  employeeAccessStatus,
  hasCompletedLineSignup,
} from "../src/lib/users";
import type { Employee } from "../src/lib/types";

const example = createDemoData().users[0];
const pending: Employee[] = Array.from({ length: 18 }, (_, index) => ({
  ...example,
  id: `pending-${index}`,
  display_name: `Pending employee ${String(index).padStart(2, "0")}`,
  nickname: "Pending",
  line_user_id: index % 2 ? null : example.line_user_id,
  claimed_at: null,
  access_enabled: index % 2 === 0,
  status: index % 2 ? "inactive" : "active",
}));
const verifiedEnabled = {
  ...example,
  id: "verified-enabled",
  display_name: "Verified Enabled",
  access_enabled: true,
};
const verifiedDisabled = {
  ...example,
  id: "verified-disabled",
  display_name: "Verified Disabled",
  access_enabled: false,
};
const records = [...pending, verifiedEnabled, verifiedDisabled];

async function seed(page: Page) {
  await page.addInitScript((users) => {
    if (localStorage.getItem("unverified-test-seeded")) return;
    localStorage.setItem("bayview-demo-users", JSON.stringify(users));
    localStorage.setItem("unverified-test-seeded", "yes");
  }, records);
}

test("LINE sign-up requires the existing claim timestamp and linked LINE identity", () => {
  for (const claimed_at of [undefined, null, "", " ", "invalid"]) {
    expect(hasCompletedLineSignup({ ...example, claimed_at })).toBe(false);
    expect(
      employeeAccessStatus({ ...example, claimed_at, access_enabled: true }),
    ).toBe("unverified");
    expect(
      employeeAccessStatus({ ...example, claimed_at, access_enabled: false }),
    ).toBe("disabled");
  }
  for (const line_user_id of [null, "", " "]) {
    expect(hasCompletedLineSignup({ ...example, line_user_id })).toBe(false);
  }
  expect(hasCompletedLineSignup(example)).toBe(true);
  expect(employeeAccessStatus(verifiedEnabled)).toBe("enabled");
  expect(employeeAccessStatus(verifiedDisabled)).toBe("disabled");
});

test("verification is independent of activity and never changes the access decision", () => {
  const unverified = { ...example, claimed_at: null, access_enabled: false };
  const snapshot = { ...unverified };
  expect(employeeAccessStatus(unverified)).toBe("disabled");
  expect(unverified).toEqual(snapshot);
  expect(assistantAccess(unverified)).toBe(false);
  expect(
    employeeAccessStatus({ ...unverified, claimed_at: example.claimed_at }),
  ).toBe("disabled");
  expect(employeeAccessStatus({ ...verifiedEnabled, status: "inactive" })).toBe(
    "enabled",
  );
  expect(employeeAccessStatus({ ...verifiedDisabled, status: "active" })).toBe(
    "disabled",
  );
});

test("Unverified badge and access filters preserve search, pagination and total user count", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  const filter = page.getByLabel("User access", { exact: true });
  const rows = page.locator(".employee-table tbody tr");
  const pagination = page.getByRole("navigation", {
    name: "User pagination",
    exact: true,
  });
  await expect(page.locator(".employee-card-heading h2")).toHaveText(
    "20 users",
  );
  await expect(filter.getByRole("option")).toHaveText([
    "All access",
    "Enabled",
    "Disabled",
    "Unverified",
  ]);
  await filter.selectOption("unverified");
  await expect(rows).toHaveCount(8);
  await expect(
    page.locator(".employee-table .employee-access.unverified"),
  ).toHaveCount(8);
  await expect(pagination).toContainText("Showing 1–8 of 9 results");
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText("Showing 9–9 of 9 results");
  await filter.selectOption("enabled");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Verified Enabled");
  await expect(
    pagination.getByRole("button", { name: "Previous" }),
  ).toBeDisabled();
  await filter.selectOption("disabled");
  await expect(rows).toHaveCount(8);
  await expect(
    page.locator(".employee-table .employee-access.disabled"),
  ).toHaveCount(8);
  await expect(pagination).toContainText("Showing 1–8 of 10 results");
  await filter.selectOption("unverified");
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("Pending employee 10");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Unverified");
  await page.getByLabel("Sort users").selectOption("name");
  await expect(filter).toHaveValue("unverified");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".employee-card-heading h2")).toHaveText(
    "20 users",
  );
  await page.screenshot({
    path: "test-results/users-unverified-desktop.png",
    fullPage: true,
  });
});

test("unverified editor retains independent access and shows Disabled once sign-up completes", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("Pending employee 01");
  await page
    .getByRole("button", { name: "Edit Pending employee 01", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "Edit user" });
  await expect(editor.getByTestId("editor-line-status")).toHaveText(
    "Unverified",
  );
  await expect(editor.getByTestId("editor-access-status")).toHaveText(
    "Disabled",
  );
  await expect(
    editor.getByRole("button", { name: "Enable user", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const users = JSON.parse(
      localStorage.getItem("bayview-demo-users") || "[]",
    );
    const user = users.find((item: Employee) => item.id === "pending-1");
    user.claimed_at = new Date().toISOString();
    user.line_user_id = "Ucompleted-signup-demo";
    localStorage.setItem("bayview-demo-users", JSON.stringify(users));
  });
  await page.reload();
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("Pending employee 01");
  await expect(page.locator(".employee-table .employee-access")).toHaveText(
    "Disabled",
  );
  const accessEnabled = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("bayview-demo-users") || "[]").find(
        (item: Employee) => item.id === "pending-1",
      ).access_enabled,
  );
  expect(accessEnabled).toBe(false);
});

test("disabling an unverified user immediately shows Disabled and enabling requires sign-up again", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("Pending employee 00");
  const badge = page.locator(".employee-table .employee-access");
  await expect(badge).toHaveText("Unverified");
  await page
    .getByRole("button", { name: "Edit Pending employee 00", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "Edit user", exact: true });
  await editor
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Disable this user?" })
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  await expect(badge).toHaveText("Disabled");
  await expect(editor.getByTestId("editor-line-status")).toHaveText(
    "Unverified",
  );
  const disabled = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bayview-demo-users") || "[]").find(
      (user: Employee) => user.id === "pending-0",
    ),
  );
  expect(disabled).toMatchObject({
    access_enabled: false,
    line_user_id: null,
    claimed_at: null,
    email: null,
  });
  await editor
    .getByRole("button", { name: "Enable user", exact: true })
    .click();
  await expect(badge).toHaveText("Unverified");
  await page.reload();
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("Pending employee 00");
  await expect(badge).toHaveText("Unverified");
});

test("Unverified rows and editor fit mobile screens", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users");
  await page
    .getByLabel("User access", { exact: true })
    .selectOption("unverified");
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("Pending employee 00");
  await page
    .getByRole("button", { name: "Edit Pending employee 00", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit user", exact: true });
  await expect(editor.getByTestId("editor-line-status")).toHaveText(
    "Unverified",
  );
  await editor.getByTestId("editor-line-status").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/users-unverified-mobile.png",
    fullPage: true,
  });
});
