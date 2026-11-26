import { test, expect, type Page } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";
import {
  CATALOG_POSITIONS,
  frontendEmployeeOptions,
  validateEmployeeCreation,
  type EmployeeCreationInput,
} from "../src/lib/employee-creation";

const users = createDemoData()
  .users.slice(0, 3)
  .map((user, index) => ({ ...user, employee_id: `000${7 + index}` }));
async function seed(page: Page, role = "admin") {
  await page.addInitScript(
    ({ users, role }) => {
      if (localStorage.getItem("add-employee-seeded")) return;
      localStorage.setItem("bayview-demo-users", JSON.stringify(users));
      localStorage.setItem(
        "bayview-demo-profile",
        JSON.stringify({
          id: "demo-admin",
          email: "admin@bayview.com",
          role,
          display_name: "Preview Admin",
          created_at: "",
        }),
      );
      localStorage.setItem("add-employee-seeded", "yes");
    },
    { users, role },
  );
  await page.goto("/users");
}
async function open(page: Page) {
  await page
    .locator(".employee-card-heading")
    .getByRole("button", { name: "Add Employee", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Add Employee", exact: true });
}

test("Add Employee aligns with the count and opens a centered, keyboard-accessible modal", async ({
  page,
}) => {
  await seed(page);
  const button = page
    .locator(".employee-card-heading")
    .getByRole("button", { name: "Add Employee" });
  const count = await page.locator(".employee-card-heading h2").boundingBox();
  const bounds = await button.boundingBox();
  expect(bounds!.x).toBeGreaterThan(count!.x + count!.width);
  expect(
    Math.abs(bounds!.y + bounds!.height / 2 - count!.y - count!.height / 2),
  ).toBeLessThan(2);
  await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  const modal = await open(page);
  await expect(modal).toContainText("Enter employee information.");
  await expect(modal).toContainText("Frontend preview only");
  await expect(modal.getByLabel(/^First name/)).toBeFocused();
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await expect(modal.getByLabel(/^Position/)).toBeDisabled();
  await expect(
    modal.getByRole("button", { name: "Add Employee", exact: true }),
  ).toBeDisabled();
  const modalBounds = await modal.boundingBox();
  expect(modalBounds!.width).toBeCloseTo(700, 0);
  expect(Math.abs(modalBounds!.x + modalBounds!.width / 2 - 720)).toBeLessThan(
    2,
  );
  const first = await modal.getByLabel(/^First name/).boundingBox();
  const last = await modal.getByLabel(/^Last name/).boundingBox();
  expect(first!.y).toBeCloseTo(last!.y, 0);
  await page.screenshot({
    path: "test-results/add-employee-desktop.png",
    animations: "disabled",
  });
  await page.keyboard.press("Shift+Tab");
  await expect(
    modal.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    modal.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(page.locator(".employee-card-heading h2")).toHaveText("3 users");
});

test("form rejects numbers, symbols, blank names and duplicate employee IDs; Thai names are accepted; positions follow department", async ({
  page,
}) => {
  await seed(page);
  const modal = await open(page);
  const first = modal.getByLabel(/^First name/);
  const last = modal.getByLabel(/^Last name/);
  const submit = modal.getByRole("button", {
    name: "Add Employee",
    exact: true,
  });
  for (const invalid of ["Somchai7", "Som@chai", "Somchai\tA", "-Somchai"]) {
    await first.fill(invalid);
    await expect(
      modal.getByText(
        "Use letters, spaces, hyphens, apostrophes or periods only (no numbers or symbols).",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(submit).toBeDisabled();
  }
  for (const valid of ["สมชาย", "Som-chai", "O'Neil", "Émile"]) {
    await first.fill(valid);
    await expect(
      modal.getByText(
        "Use letters, spaces, hyphens, apostrophes or periods only (no numbers or symbols).",
        { exact: true },
      ),
    ).toHaveCount(0);
  }
  await first.fill("   ");
  await first.blur();
  await expect(modal.getByText("First name is required.")).toBeVisible();
  await first.fill("  Somchai  ");
  await first.blur();
  await expect(first).toHaveValue("Somchai");
  await last.fill(" Inlin ");
  await last.blur();
  await expect(last).toHaveValue("Inlin");
  await modal.getByLabel(/^Employee ID/).fill("0007");
  await modal.getByLabel(/^Phone number/).fill("0812345678");
  await expect(
    modal.getByText("This employee ID already exists."),
  ).toBeVisible();
  await modal.getByLabel(/^Department/).selectOption("Front Office Department");
  const position = modal.getByLabel(/^Position/);
  await expect(position).toBeEnabled();
  await expect(position.locator("option")).toHaveText([
    "Select position",
    ...CATALOG_POSITIONS.filter(
      ([department]) => department === "Front Office Department",
    ).map(([, position]) => position),
  ]);
  await position.selectOption({ label: "Guest Service Agent" });
  await expect(submit).toBeDisabled();
  await modal.getByLabel(/^Employee ID/).fill("0010");
  await modal.getByLabel(/^Phone number/).fill("0812345678");
  await expect(submit).toBeEnabled();
  await modal.getByLabel(/^Department/).selectOption("Housekeeping Department");
  await expect(position).toHaveValue("");
  await expect(position.locator("option")).toHaveText([
    "Select position",
    ...CATALOG_POSITIONS.filter(
      ([department]) => department === "Housekeeping Department",
    ).map(([, position]) => position),
  ]);
  await expect(submit).toBeDisabled();
  await modal.getByLabel(/^Department/).selectOption("IT");
  await expect(position.locator("option")).toHaveText([
    "Select position",
    "IT support",
  ]);
  await expect(submit).toBeDisabled();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".employee-card-heading h2")).toHaveText("3 users");
  await open(page);
  await expect(first).toHaveValue("");
});

test("frontend creation preserves leading zeros, starts disabled, updates list/count, and never writes to the backend", async ({
  page,
}) => {
  await seed(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
      writes.push(request.url());
  });
  const modal = await open(page);
  await modal.getByLabel(/^First name/).fill("  Somchai  ");
  await modal.getByLabel(/^Last name/).fill(" Inlin ");
  await modal.getByLabel(/^Employee ID/).fill(" 0010 ");
  await modal.getByLabel(/^Phone number/).fill("0812345678");
  await modal.getByLabel(/^Department/).selectOption("Front Office Department");
  await modal
    .getByLabel(/^Position/)
    .selectOption({ label: "Guest Service Agent" });
  await modal
    .getByRole("button", { name: "Add Employee", exact: true })
    .click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator(".employee-card-heading h2")).toHaveText("4 users");
  await expect(
    page.getByRole("status").filter({ hasText: "Employee added successfully" }),
  ).toBeVisible();
  const newRow = page.getByRole("row").filter({ hasText: "Somchai Inlin" });
  await expect(newRow).toContainText("Guest Service Agent");
  await expect(newRow).toContainText("Disabled");
  await expect(newRow).toContainText("Frontend preview");
  await expect(newRow.getByRole("link")).toHaveCount(0);
  await newRow.getByRole("button", { name: "Edit Somchai Inlin" }).click();
  const editor = page.getByRole("region", { name: "Edit user" });
  await editor
    .getByLabel("Employee department")
    .selectOption("Housekeeping Department");
  await editor.getByLabel("Employee position").selectOption("Room Attendant");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(newRow).toContainText("Room Attendant");
  await editor.getByRole("button", { name: "Close edit user" }).click();
  await open(page);
  await modal.getByLabel(/^Employee ID/).fill("0010");
  await modal.getByLabel(/^Phone number/).fill("0812345678");
  await expect(
    modal.getByText("This employee ID already exists."),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bayview-demo-users") || "[]"),
  );
  expect(stored).toHaveLength(3);
  expect(
    stored.some((user: { employee_id: string }) => user.employee_id === "0010"),
  ).toBe(false);
  await page.reload();
  await expect(page.locator(".employee-card-heading h2")).toHaveText("3 users");
  await expect(
    page.getByRole("row").filter({ hasText: "Somchai Inlin" }),
  ).toHaveCount(0);
});

test("mobile modal stacks names, scrolls internally, keeps footer visible and closes without saving", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 667 });
  const modal = await open(page);
  const first = await modal.getByLabel(/^First name/).boundingBox();
  const last = await modal.getByLabel(/^Last name/).boundingBox();
  expect(last!.y).toBeGreaterThan(first!.y + first!.height);
  expect(last!.x).toBeCloseTo(first!.x, 0);
  const modalBounds = await modal.boundingBox();
  expect(modalBounds!.y).toBeGreaterThanOrEqual(0);
  expect(modalBounds!.y + modalBounds!.height).toBeLessThanOrEqual(667);
  expect(
    await modal.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const footer = await modal.locator(".employee-create-footer").boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(
    modalBounds!.y + modalBounds!.height,
  );
  await page.screenshot({
    path: "test-results/add-employee-mobile.png",
    animations: "disabled",
  });
  await modal.getByLabel(/^Employee ID/).fill("1234");
  await modal.getByLabel(/^Phone number/).fill("0812345678");
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(modal).not.toBeVisible();
  await expect(
    page
      .locator(".employee-card-heading")
      .getByRole("button", { name: "Add Employee" }),
  ).toBeFocused();
  await expect(page.locator(".employee-card-heading h2")).toHaveText("3 users");
});

test("non-admins cannot open employee creation", async ({ page }) => {
  await seed(page, "hr");
  await expect(
    page
      .locator(".employee-card-heading")
      .getByRole("button", { name: "Add Employee" }),
  ).toBeDisabled();
});

test("frontend validation checks trimming, Thai and English names, string IDs and department compatibility", () => {
  const options = frontendEmployeeOptions(users);
  const input: EmployeeCreationInput = {
    first_name: " Somchai ",
    last_name: "In lin",
    employee_id: "0001",
    phone: "081-234-5678",
    department_id: "Front Office Department",
    position_id: options.positions.find(
      ({ department_id }) => department_id === "Front Office Department",
    )!.id,
  };
  expect(validateEmployeeCreation(input, options)).toEqual({});
  for (const invalid of ["", " ", "Abc1", "A@B", "A\nB", "-Abc", "123"]) {
    expect(
      validateEmployeeCreation({ ...input, first_name: invalid }, options)
        .first_name,
    ).toBeTruthy();
  }
  for (const valid of ["สมชาย", "สมหญิง ใจดี", "A-B", "O'Neil", "Ábc"]) {
    expect(
      validateEmployeeCreation({ ...input, first_name: valid }, options)
        .first_name,
    ).toBeUndefined();
  }
  expect(
    validateEmployeeCreation(
      { ...input, employee_id: 1 as unknown as string },
      options,
    ).employee_id,
  ).toBeTruthy();
  expect(
    validateEmployeeCreation(
      { ...input, department_id: "Housekeeping Department" },
      options,
    ).position_id,
  ).toContain("belonging");
  expect(
    validateEmployeeCreation(
      { ...input, department_id: "Nonexistent" },
      options,
    ).department_id,
  ).toBeTruthy();
});

test("position options always include the organization-chart positions of every department", () => {
  const options = frontendEmployeeOptions(
    users.map((user) => ({ ...user, position: null })),
  );
  const pairs = options.positions.map(
    ({ name, department_id }) => `${department_id}|${name}`,
  );
  for (const [department, name] of CATALOG_POSITIONS)
    expect(pairs).toContain(`${department}|${name}`);
  expect(
    options.departments.some(({ name }) => name === "Front Office Department"),
  ).toBe(true);
  expect(options.departments.some(({ name }) => name === "IT")).toBe(true);
});
