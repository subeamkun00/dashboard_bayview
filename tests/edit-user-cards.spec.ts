import { expect, test, type Page } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";

const base = createDemoData().users[0];
const users = [
  {
    ...base,
    id: "pending-enabled",
    display_name: "Pending Enabled",
    access_enabled: true,
    line_user_id: null,
    claimed_at: null,
  },
  {
    ...base,
    id: "pending-disabled",
    display_name: "Pending Disabled",
    access_enabled: false,
    line_user_id: null,
    claimed_at: null,
  },
  {
    ...base,
    id: "linked-enabled",
    display_name: "Linked Enabled",
    access_enabled: true,
    email: "verified.employee.with.a.long.address@example.invalid",
  },
  {
    ...base,
    id: "linked-disabled",
    display_name: "Linked Disabled",
    access_enabled: false,
  },
  {
    ...base,
    id: "line-without-claim",
    display_name: "LINE Without Signup",
    access_enabled: true,
    claimed_at: null,
  },
];
async function seed(page: Page) {
  await page.addInitScript(
    (records) =>
      localStorage.setItem("bayview-demo-users", JSON.stringify(records)),
    users,
  );
}

test("account cards separate access from LINE status without changing table badges", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  for (const user of users) {
    await page
      .getByRole("button", { name: `Edit ${user.display_name}`, exact: true })
      .click();
    const editor = page.getByRole("region", { name: "Edit user", exact: true });
    await expect(
      editor.getByRole("heading", { name: "Account status", exact: true }),
    ).toBeVisible();
    await expect(editor.getByTestId("editor-access-status")).toHaveText(
      user.access_enabled ? "Enabled" : "Disabled",
    );
    const verified = Boolean(user.line_user_id && user.claimed_at);
    await expect(editor.getByTestId("editor-line-status")).toHaveText(
      verified ? "Verified" : "Unverified",
    );
    await expect(editor.locator(".employee-account-card")).toHaveCount(1);
    await expect(
      editor.getByRole("heading", { name: "LINE sign-up", exact: true }),
    ).toHaveCount(0);
    await expect(editor.locator(".employee-registration-status")).toHaveCount(
      0,
    );
    if (verified && user.email) {
      const email = editor.getByTestId("editor-line-email");
      await expect(email).toHaveText(user.email);
      await expect(email.locator("xpath=ancestor::dt")).toContainText(
        "LINE account",
      );
      const headingBox = await editor
        .locator(".employee-line-heading")
        .boundingBox();
      const emailBox = await email.boundingBox();
      expect(emailBox!.y).toBeGreaterThanOrEqual(
        headingBox!.y + headingBox!.height,
      );
    } else {
      await expect(editor.getByTestId("editor-line-email")).toHaveCount(0);
    }
    await expect(editor.locator(".employee-invite-row")).toHaveCount(
      user.line_user_id ? 0 : 1,
    );
    await expect(
      editor.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", {
        name: user.access_enabled ? "Disable user" : "Enable user",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      editor.getByRole("button", {
        name: user.line_user_id ? "Reset link" : "Generate invite code",
        exact: true,
      }),
    ).toBeEnabled();
    await editor.getByRole("button", { name: "Close edit user" }).click();
  }
  await expect(
    page.locator(".employee-table .employee-access.unverified"),
  ).toHaveCount(2);
});

test("Reset link keeps its confirmation and leaves LINE details intact when cancelled", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  await page
    .getByRole("button", { name: "Edit Linked Enabled", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "Edit user", exact: true });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(
      "unlinks the employee's LINE account and email",
    );
    await dialog.dismiss();
  });
  await editor.getByRole("button", { name: "Reset link", exact: true }).click();
  await expect(editor.getByTestId("editor-line-status")).toHaveText("Verified");
  await expect(editor.getByTestId("editor-line-email")).toHaveText(
    users[2].email!,
  );
  await expect(editor.getByRole("alert")).toHaveCount(0);
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await editor.getByRole("button", { name: "Reset link", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Invite codes need a connected Supabase project.",
  );
  await expect(editor.getByTestId("editor-line-status")).toHaveText("Verified");
});

test("reference cards preserve access confirmation, invite errors, tooltips and draft fields", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/users");
  await page
    .getByRole("button", { name: "Edit Pending Enabled", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "Edit user", exact: true });
  await expect(
    editor.locator(".employee-access-action.disable svg path").first(),
  ).toHaveCSS("color", "rgb(185, 28, 28)");
  await expect(
    editor.locator(".employee-invite-action svg path").first(),
  ).toHaveCSS("color", "rgb(8, 99, 71)");
  await editor
    .getByRole("button", { name: "About access", exact: true })
    .focus();
  await expect(
    editor.getByRole("tooltip").filter({ hasText: "Controls this employee" }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "Disable this user?" });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor.getByTestId("editor-access-status")).toHaveText(
    "Enabled",
  );
  await editor
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  await confirm
    .getByRole("button", { name: "Disable user", exact: true })
    .click();
  await expect(editor.getByTestId("editor-access-status")).toHaveText(
    "Disabled",
  );
  await expect(editor.getByTestId("editor-line-status")).toHaveText(
    "Unverified",
  );
  await editor
    .getByRole("button", { name: "Enable user", exact: true })
    .click();
  await expect(editor.getByTestId("editor-access-status")).toHaveText(
    "Enabled",
  );
  await editor
    .getByRole("button", { name: "Generate invite code", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText(
    "Invite codes need a connected Supabase project.",
  );
  await expect(
    editor.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
});

for (const width of [320, 390, 768, 1440, 1920]) {
  test(`reference account cards fit ${width}px with the existing sticky footer`, async ({
    page,
  }) => {
    await seed(page);
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/users");
    await page
      .getByRole("button", { name: "Edit Linked Enabled", exact: true })
      .click();
    const editor = page.getByRole(width <= 1375 ? "dialog" : "region", {
      name: "Edit user",
      exact: true,
    });
    await editor
      .locator(".employee-account-card")
      .first()
      .scrollIntoViewIfNeeded();
    const scrollFits = await editor
      .locator(".employee-editor-scroll")
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(scrollFits).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const footer = await editor
      .locator(".employee-editor-footer")
      .boundingBox();
    if (width <= 1375) {
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(1081);
    } else {
      const tableCard = await page.locator(".employee-card").boundingBox();
      expect(
        Math.abs(footer!.y + footer!.height - tableCard!.y - tableCard!.height),
      ).toBeLessThanOrEqual(1);
    }
    const action = await editor
      .locator(".employee-access-action")
      .boundingBox();
    const card = await editor
      .locator(".employee-account-card")
      .first()
      .boundingBox();
    expect(action!.width).toBeGreaterThan(card!.width * 0.75);
    await editor.locator(".employee-editor-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.screenshot({
      path: `test-results/edit-user-cards-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  });
}
