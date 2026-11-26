import { test, expect } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";
import { UI_SCALE, uiPixels, EMPLOYEE_DRAWER_QUERY } from "../src/lib/ui-scale";

test("125% sizing enlarges text, controls, icons and spacing without changing colors or columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/users");
  await expect(page.locator(".employee-card-heading h2")).toHaveText(
    "248 users",
  );
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await expect(page.locator("body")).toHaveCSS("font-size", "20px");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(247, 249, 248)",
  );
  await expect(page.locator(".sidebar")).toHaveCSS("width", "290px");
  await expect(page.locator(".page-heading h1")).toHaveCSS("font-size", "40px");
  await expect(page.locator(".employee-card-heading h2")).toHaveCSS(
    "font-size",
    "27.5px",
  );
  const add = page.locator(".employee-card-heading .employee-add-button");
  await expect(add).toHaveCSS("font-size", "16.25px");
  await expect(add).toHaveCSS("padding-top", "12.5px");
  await expect(add).toHaveCSS("padding-left", "16.25px");
  await expect(add).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(add).toHaveCSS("background-color", "rgb(33, 153, 104)");
  await expect(add.locator("svg")).toHaveCSS("width", "21.25px");
  await expect(add.locator("svg")).toHaveCSS("height", "21.25px");
  await expect(page.getByRole("columnheader")).toHaveText([
    "Team member",
    "Department",
    "Position",
    "Questions",
    "Access",
    "Actions",
  ]);
  await page.screenshot({
    path: "test-results/ui-resize-users-desktop.png",
    animations: "disabled",
  });
  await add.click();
  const modal = page.getByRole("dialog", { name: "Add Employee", exact: true });
  const bounds = await modal.boundingBox();
  expect(bounds!.width).toBeCloseTo(uiPixels(560), 0);
  expect(bounds!.x + bounds!.width / 2).toBeCloseTo(960, 0);
  await expect(modal.getByLabel(/^First name/)).toBeFocused();
  await page.screenshot({
    path: "test-results/ui-resize-add-employee.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  expect(UI_SCALE).toBe(1.25);
  expect(EMPLOYEE_DRAWER_QUERY).toBe("(max-width: 1375px)");
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`every page remains responsive at ${width}px and browser zoom 100%`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1080 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [route, title] of [
      ["/", "AI Workflow Automation"],
      ["/users", "User management"],
      ["/users/user-1", "User details"],
      ["/chat-logs", "Questions and Repiles"],
      ["/documents", "SOP Documents"],
      ["/settings", "Settings"],
      ["/login", "Login"],
    ]) {
      await page.goto(route);
      if (route === "/login")
        await expect(page.locator(".login-card h2")).toBeVisible();
      else {
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await expect(page.locator(".nav-count")).toHaveText("12,864");
      }
      await expect(page.locator("html")).toHaveCSS("font-size", "20px");
      const size = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(
        size.document,
        `${route} overflows at ${width}px`,
      ).toBeLessThanOrEqual(size.viewport);
      if (route === "/")
        await expect(
          page.locator(".questions-panel .chart-value-label").first(),
        ).toBeVisible();
      if ([390, 1920].includes(width))
        await page.screenshot({
          path: `test-results/ui-resize-${route.replaceAll("/", "-") || "overview"}-${width}.png`,
          animations: "disabled",
        });
    }
    expect(errors).toEqual([]);
  });
}

test("the enlarged employee editor remains responsive and preserves Department head controls", async ({
  page,
}) => {
  for (const width of [390, 1375, 1376, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/users");
    await page
      .locator(".employee-table tbody tr:not(.employee-skeleton)")
      .first()
      .getByRole("button", { name: /^Edit / })
      .click();
    const editor = page.getByRole(width <= 1375 ? "dialog" : "region", {
      name: "Edit user",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Employee department")).toBeFocused();
    const footer = await editor
      .locator(".employee-editor-footer")
      .boundingBox();
    if (width <= 1375) {
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(1080);
    } else {
      const tableCard = await page.locator(".employee-card").boundingBox();
      expect(
        Math.abs(footer!.y + footer!.height - tableCard!.y - tableCard!.height),
      ).toBeLessThanOrEqual(1);
    }
    const head = editor.getByRole("checkbox", { name: /Department head/ });
    await head.scrollIntoViewIfNeeded();
    await expect(head).toBeVisible();
    await expect(head).toHaveCSS("width", "16.25px");
    await page.keyboard.press("Escape");
    await expect(editor).not.toBeVisible();
  }
});

test("document permissions keep whole-hotel, department and position modes after resizing", async ({
  page,
}) => {
  const doc = {
    ...createDemoData().documents[0],
    id: "resize-document",
    document_name: "Staff guide.pdf",
    original_filename: "Staff guide.pdf",
    department: "Human Resources Department",
    position: null,
  };
  await page.addInitScript((document) => {
    if (!localStorage.getItem("resize-permission-seeded")) {
      localStorage.setItem(
        "bayview-demo-documents",
        JSON.stringify([document]),
      );
      localStorage.setItem("resize-permission-seeded", "yes");
    }
  }, doc);
  await page.goto("/documents");
  await page
    .getByRole("button", { name: /^Permissions for Staff guide/ })
    .click();
  let modal = page.getByRole("dialog", {
    name: "Document permissions",
    exact: true,
  });
  await expect(modal.getByRole("radio")).toHaveCount(3);
  await modal.getByRole("radio", { name: /One position/ }).check();
  await modal
    .getByLabel("Position", { exact: true })
    .selectOption("Hotel Driver");
  await modal.getByRole("button", { name: "Save permissions" }).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByRole("button", { name: /^Permissions for Staff guide/ })
    .click();
  await expect(modal.getByLabel("Position", { exact: true })).toHaveValue(
    "Hotel Driver",
  );
  await modal.getByRole("radio", { name: /One department/ }).check();
  await expect(modal.getByLabel("Position", { exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "Save permissions" }).click();
  await page
    .getByRole("button", { name: /^Permissions for Staff guide/ })
    .click();
  await expect(
    modal.getByRole("radio", { name: /One department/ }),
  ).toBeChecked();
  await modal.getByRole("radio", { name: /Whole hotel/ }).check();
  await modal.getByRole("button", { name: "Save permissions" }).click();
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem("bayview-demo-documents") || "[]")[0],
  );
  expect(stored).toMatchObject({
    id: doc.id,
    department: "All departments",
    position: null,
  });
  const group = page
    .locator(".department-section")
    .filter({ has: page.getByRole("heading", { name: /^Whole hotel/ }) });
  await group.getByRole("button", { name: /^Whole hotel/ }).click();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await group
      .getByRole("button", { name: /^Permissions for Staff guide/ })
      .click();
    modal = page.getByRole("dialog", {
      name: "Document permissions",
      exact: true,
    });
    const bounds = await modal.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await expect(
      modal.getByRole("radio", { name: /Whole hotel/ }),
    ).toBeChecked();
    await page.screenshot({
      path: `test-results/ui-resize-permissions-${width}.png`,
      animations: "disabled",
    });
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("Department head can still be changed independently of identity and question history", async ({
  page,
}) => {
  await page.goto("/users");
  const row = page
    .locator(".employee-table tbody tr:not(.employee-skeleton)")
    .first();
  const href = await row.getByRole("link").getAttribute("href");
  const id = href!.split("/").at(-1)!;
  const before = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("bayview-demo-users") || "[]").find(
        (user: { id: string }) => user.id === id,
      ),
    id,
  );
  await row.getByRole("button", { name: /^Edit / }).click();
  const editor = page.getByRole("region", { name: "Edit user", exact: true });
  const head = editor.getByRole("checkbox", { name: /Department head/ });
  await head.check();
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(row.locator(".head-badge")).toHaveText("Head");
  const after = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("bayview-demo-users") || "[]").find(
        (user: { id: string }) => user.id === id,
      ),
    id,
  );
  expect(after).toMatchObject({
    id: before.id,
    line_user_id: before.line_user_id,
    department: before.department,
    position: before.position,
    first_seen: before.first_seen,
    is_department_head: true,
  });
});
