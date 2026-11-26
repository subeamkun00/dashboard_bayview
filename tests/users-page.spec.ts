import { test, expect, type Page } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";

const records = createDemoData()
  .users.slice(0, 3)
  .map((user, index) => ({
    ...user,
    access_enabled: index !== 1,
    status: index === 2 ? ("inactive" as const) : ("active" as const),
  }));
async function seed(page: Page) {
  await page.addInitScript((users) => {
    if (!localStorage.getItem("users-test-seeded")) {
      localStorage.setItem("bayview-demo-users", JSON.stringify(users));
      localStorage.setItem("users-test-seeded", "yes");
    }
  }, records);
}
function row(page: Page, index = 0) {
  return page.getByRole("row").filter({ hasText: records[index].display_name });
}

test("employee table has only requested columns and filters actual access independently of activity", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  await expect(
    page.getByRole("heading", { name: "User management", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader")).toHaveText([
    "Team member",
    "Department",
    "Position",
    "Questions",
    "Access",
    "Actions",
  ]);
  const heading = page.locator(".employee-card-heading");
  await expect(heading.locator("h2")).toHaveText("3 users");
  await expect(heading.locator("h2")).toHaveCSS("font-size", "27.5px");
  await expect(page.locator(".employee-table tbody tr")).toHaveCount(3);
  await expect(row(page, 2)).toContainText("Enabled");
  await expect(row(page, 1)).toContainText("Disabled");
  await expect(page.locator(".employee-table").getByRole("button")).toHaveCount(
    3,
  );
  await expect(
    page.getByRole("button", { name: "Disable user", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("User access", { exact: true })
    .selectOption("disabled");
  await expect(page.locator(".employee-table tbody tr")).toHaveCount(1);
  await page.getByLabel("User access", { exact: true }).selectOption("enabled");
  await expect(page.locator(".employee-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByPlaceholder("Search name or nickname...").fill("May");
  await expect(row(page, 2)).toBeVisible();
  await expect(page.locator(".employee-table tbody tr")).toHaveCount(1);
  await expect(heading.locator("h2")).toHaveText("3 users");
  await page
    .getByPlaceholder("Search name or nickname...")
    .fill("does-not-exist");
  await expect(
    page.getByRole("heading", { name: "No users found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .last()
    .click();
  await page
    .getByLabel("User department", { exact: true })
    .selectOption("Housekeeping");
  await expect(page.locator(".employee-table tbody tr")).toHaveCount(1);
});
test("desktop editor saves department and position, confirms discard and preserves stable identity", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  const before = await page.locator(".employee-card").boundingBox();
  await row(page)
    .getByRole("button", {
      name: `Edit ${records[0].display_name}`,
      exact: true,
    })
    .click();
  const editor = page.getByRole("region", { name: "Edit user", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Employee department")).toBeFocused();
  const after = await page.locator(".employee-card").boundingBox();
  expect(after!.width).toBeLessThan(before!.width);
  await expect(row(page)).toHaveClass(/employee-selected/);
  await page.screenshot({
    path: "test-results/users-edit-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await editor
    .getByLabel("Employee department")
    .selectOption("Housekeeping Department");
  await editor.getByLabel("Employee position").selectOption("Room Attendant");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor.getByLabel("Employee department")).toHaveValue(
    "Housekeeping Department",
  );
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(row(page)).toContainText("Housekeeping");
  await expect(row(page)).toContainText("Room Attendant");
  await expect(
    editor.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await editor.getByLabel("Employee department").selectOption("IT");
  await editor.getByRole("button", { name: "Close edit user" }).click();
  await discard.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor).not.toBeVisible();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("bayview-demo-users") || "[]")[0],
  );
  expect(saved).toMatchObject({
    id: records[0].id,
    line_user_id: records[0].line_user_id,
    first_seen: records[0].first_seen,
    last_seen: records[0].last_seen,
    department: "Housekeeping Department",
    position: "Room Attendant",
  });
  await page.reload();
  await expect(row(page)).toContainText("Room Attendant");
});
test("disabling and re-enabling preserve history and do not save draft profile changes", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  const questionCount = await row(page).locator("td").nth(3).innerText();
  await row(page)
    .getByRole("button", { name: `Edit ${records[0].display_name}` })
    .click();
  const editor = page.getByRole("region", { name: "Edit user" });
  await editor.getByLabel("Employee department").selectOption("IT");
  await editor
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Disable this user?" });
  await expect(confirmation).toContainText(records[0].display_name);
  await expect(confirmation).toContainText(
    "question history will remain stored",
  );
  await expect(confirmation).toContainText(
    "LINE and email links will be reset",
  );
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(row(page)).toContainText("Enabled");
  await editor
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  await expect(row(page)).toContainText("Disabled");
  await expect(
    editor.getByRole("button", { name: "Enable user", exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel("Employee department")).toHaveValue("IT");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bayview-demo-users") || "[]"),
  );
  expect(stored).toHaveLength(3);
  expect(stored[0]).toMatchObject({
    id: records[0].id,
    department: records[0].department,
    status: records[0].status,
    access_enabled: false,
    auth_user_id: null,
    line_user_id: null,
    claimed_at: null,
    line_id: null,
    email: null,
  });
  await editor
    .getByRole("button", { name: "Enable user", exact: true })
    .click();
  await expect(row(page)).toContainText("Unverified");
  await expect(row(page).locator("td").nth(3)).toHaveText(questionCount);
  await expect(editor.getByTestId("editor-line-status")).toHaveText(
    "Unverified",
  );
  await expect(
    editor.getByRole("button", { name: "Generate invite code", exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel("Employee department")).toHaveValue("IT");
});
test("mobile editor is a keyboard-operable drawer with visible footer and retained data", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users");
  await row(page)
    .getByRole("button", { name: `Edit ${records[0].display_name}` })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit user", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Employee department")).toBeFocused();
  await expect(
    editor.getByRole("button", { name: "Save changes" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await editor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/users-edit-mobile.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await expect(
    row(page).getByRole("button", { name: `Edit ${records[0].display_name}` }),
  ).toBeFocused();
});
test("employee pagination stays synchronized and resets after search, filter or sorting changes", async ({
  page,
}) => {
  await page.goto("/users");
  const top = page.getByRole("navigation", {
    name: "User pagination",
    exact: true,
  });
  const bottom = page.getByRole("navigation", {
    name: "User pagination bottom",
    exact: true,
  });
  await top.getByRole("button", { name: "Next" }).click();
  await expect(bottom).toContainText("Showing 9–16 of 248 results");
  await bottom.getByRole("button", { name: "Previous" }).click();
  await expect(top).toContainText("Showing 1–8 of 248 results");
  for (const change of [
    async () => page.getByLabel("Sort users").selectOption("name"),
    async () =>
      page.getByLabel("User access", { exact: true }).selectOption("enabled"),
    async () => page.getByPlaceholder("Search name or nickname...").fill("Nat"),
  ]) {
    await top.getByRole("button", { name: "Next" }).click();
    await change();
    await expect(top.locator(".page-number")).toContainText("1 /");
  }
});
