import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chartData } from "../src/lib/utils";
import type { Chat } from "../src/lib/types";
import { formatMessageBlocks } from "../src/lib/format-message";
import { createDemoData } from "../src/lib/demo";

test("formats structured AI responses into readable sections and lists", () => {
  const blocks = formatMessageBlocks(
    "📋 ตำแหน่ง Assistant Front Office Manager 📌 วัตถุประสงค์ ▸ สนับสนุน Front Office Manager ⚙️ ขั้นตอนการทำงาน 1. ตรวจสอบ Room Status 2. จัดประชุมทีม 📊 KPI ▸ เวลา Check-in เฉลี่ยไม่เกิน 5 นาที",
  );

  expect(blocks).toEqual([
    {
      type: "section",
      marker: "📋",
      title: "ตำแหน่ง",
      content: "Assistant Front Office Manager",
    },
    { type: "section", marker: "📌", title: "วัตถุประสงค์", content: "" },
    { type: "bullet", content: "สนับสนุน Front Office Manager" },
    { type: "section", marker: "⚙️", title: "ขั้นตอนการทำงาน", content: "" },
    { type: "number", number: "1", content: "ตรวจสอบ Room Status" },
    { type: "number", number: "2", content: "จัดประชุมทีม" },
    { type: "section", marker: "📊", title: "KPI", content: "" },
    { type: "bullet", content: "เวลา Check-in เฉลี่ยไม่เกิน 5 นาที" },
  ]);
});

test("login uses the supplied Bayview artwork without the previous story content", async ({
  page,
}) => {
  await page.goto("/login");
  const artwork = page.getByRole("img", {
    name: "The Bayview Pattaya — A Sukosol Hotel",
  });
  await expect(artwork).toBeVisible();
  await expect(page.locator(".login-story > *")).toHaveCount(1);
  expect(
    await artwork.evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBe(3508);

  const formLogo = page.locator(".login-form-icon img");
  await expect(formLogo).toBeVisible();
  await expect(formLogo).toHaveAttribute("src", /logo_bayview_brown/);
  await expect(formLogo).toHaveCSS("width", "61.25px");
  await expect(formLogo).toHaveCSS("height", "61.25px");

  const heading = page.getByRole("heading", { name: "Welcome to Bayview." });
  await expect(heading).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(heading).toHaveCSS("font-size", "40px");
});

test("chart aggregation preserves totals and excludes out-of-range records", () => {
  const now = new Date(2026, 8, 17, 12).getTime();
  const dates = [
    new Date(2026, 8, 11, 10),
    new Date(2026, 8, 14, 10),
    new Date(2026, 8, 17, 10),
    new Date(2026, 8, 10, 23),
    new Date(2026, 8, 18, 10),
  ];
  const records: Chat[] = dates.map((date, i) => ({
    id: String(i),
    user_id: "user",
    question: "Question",
    ai_response: "Answer",
    source_document: "SOP",
    category: "Operations",
    response_status: "success",
    created_at: date.toISOString(),
  }));
  for (const period of ["Daily", "Weekly", "Monthly"] as const) {
    const points = chartData(records, period, 7, now);
    expect(points.reduce((sum, bucket) => sum + bucket.questions, 0)).toBe(3);
    expect(points[0].label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    expect(points[0].periodLabel).toContain(points[0].label);
  }
});

test("overview shows computed metrics and changes chart aggregation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI Workflow Automation" }),
  ).toBeVisible();
  await expect(page.locator(".stat-middle").nth(0)).toHaveText("248");
  await expect(page.locator(".stat-middle").nth(1)).toHaveText("12,864");
  const topUsers = page.locator(".top-users");
  await expect(
    topUsers.getByRole("heading", { name: "Top users by questions" }),
  ).toBeVisible();
  await expect(
    topUsers.getByRole("button", { name: "Last 7 days", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(topUsers.locator(".top-user-rank")).toHaveText([
    "1",
    "2",
    "3",
    "4",
  ]);
  const rankedTotals = (
    await topUsers.locator(".top-user-total strong").allTextContents()
  ).map((value) => Number(value.replaceAll(",", "")));
  expect(rankedTotals.every((value) => value > 0)).toBeTruthy();
  expect(rankedTotals).toEqual([...rankedTotals].sort((a, b) => b - a));
  await topUsers.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    topUsers.getByRole("button", { name: "Today", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await topUsers
    .getByRole("button", { name: "Last 7 days", exact: true })
    .click();
  await expect(page.locator(".chart-summary")).toContainText(
    "questions in the last 30 days",
  );
  await expect(page.locator(".questions-panel .recharts-line")).toHaveCount(1);
  const dailyValueLabels = page.locator(".questions-panel .chart-value-label");
  await expect(dailyValueLabels.first()).toBeVisible();
  expect(await dailyValueLabels.count()).toBeLessThan(30);
  expect(await dailyValueLabels.allTextContents()).not.toContain("0");
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Weekly", exact: true }),
  ).toHaveClass("selected");
  await expect(page.locator(".chart-summary")).toContainText(
    "questions in the last 5 weeks",
  );
  await expect(
    page.locator(".questions-panel .recharts-bar-rectangle"),
  ).toHaveCount(5);
  await expect(page.locator(".questions-panel .chart-value-label")).toHaveCount(
    5,
  );
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  const monthlyBars = page.locator(".questions-panel .recharts-bar-rectangle");
  await expect(monthlyBars.first()).toBeVisible();
  const monthCount = await monthlyBars.count();
  await expect(page.locator(".chart-summary")).toContainText(
    monthCount === 1
      ? "questions this month"
      : `questions in the last ${monthCount} months`,
  );
  await expect(page.locator(".questions-panel .chart-value-label")).toHaveCount(
    monthCount,
  );
  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await page.getByLabel("Date range").selectOption("7");
  await expect(page.getByText("questions in the last 7 days")).toBeVisible();
  await page.getByLabel("Date range").selectOption("30");
  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await expect(
    page
      .locator(".recent-card")
      .getByRole("columnheader", { name: "Source document" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
});

test("user table preserves conversation history navigation", async ({
  page,
}) => {
  await page.goto("/users");
  await page.getByPlaceholder("Search name or nickname...").fill("Nattapong");
  await expect(page.locator(".employee-table tbody tr").first()).toContainText(
    "Nattapong",
  );
  await page.locator(".employee-table .table-user").first().click();
  await expect(
    page.getByRole("heading", { name: "User details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Conversation history" }),
  ).toBeVisible();
  await expect(page.locator(".ai-message").first()).toBeVisible();
  await expect(
    page.locator(".conversation-history .chat-source").first(),
  ).toBeVisible();
});

test("conversation filters, details and CSV export", async ({ page }) => {
  await page.goto("/chat-logs");
  const exportButton = page.getByRole("button", {
    name: "Export CSV",
    exact: true,
  });
  await expect(exportButton).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(exportButton.locator("svg")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  const questionsHeading = page.locator(".questions-list-card .card-header h2");
  await expect(questionsHeading).toHaveText("12,864 Questions");
  await expect(questionsHeading).toHaveCSS("font-size", "30px");
  await expect(questionsHeading).toHaveCSS("font-weight", "700");
  await expect(page.locator(".questions-list-card .card-header p")).toHaveCount(
    0,
  );
  const pagination = page.getByRole("navigation", {
    name: "Chat log pagination",
    exact: true,
  });
  const bottomPagination = page.getByRole("navigation", {
    name: "Chat log pagination bottom",
    exact: true,
  });
  await expect(page.locator("main .pagination")).toHaveCount(2);
  await expect(pagination).toContainText("Showing 1–10 of 12,864 results");
  await expect(page.locator(".conversation-table tbody tr")).toHaveCount(10);
  await expect(
    pagination.getByRole("button", { name: "Previous" }),
  ).toBeDisabled();
  const paginationBounds = await pagination.boundingBox();
  const tableBounds = await page
    .locator(".conversation-table thead")
    .boundingBox();
  expect(paginationBounds!.y + paginationBounds!.height).toBeLessThanOrEqual(
    tableBounds!.y + 1,
  );
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(questionsHeading).toHaveText("12,864 Questions");
  await expect(pagination).toContainText("Showing 11–20 of 12,864 results");
  await expect(bottomPagination).toContainText(
    "Showing 11–20 of 12,864 results",
  );
  await bottomPagination.getByRole("button", { name: "Previous" }).click();
  await expect(pagination).toContainText("Showing 1–10 of 12,864 results");
  await expect(
    bottomPagination.getByRole("button", { name: "Previous" }),
  ).toBeDisabled();
  await pagination.getByRole("button", { name: "Next" }).click();
  const departmentFilter = page.getByLabel("Filter by department");
  await expect(departmentFilter).toHaveCount(0);
  await expect(page.getByLabel("Response status")).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.locator("#chat-log-filters")).toBeVisible();
  await expect(
    page.getByLabel("Conversation date", { exact: true }),
  ).toBeVisible();
  await expect(departmentFilter).toHaveValue("all");
  await expect(
    departmentFilter.getByRole("option", { name: "All departments" }),
  ).toBeAttached();
  await expect(page.getByLabel("Filter by user")).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Source document" }),
  ).toHaveCount(0);
  await page
    .getByPlaceholder("Search questions or responses...")
    .fill("annual leave");
  const filteredCount = createDemoData().chats.filter((chat) =>
    `${chat.question} ${chat.ai_response}`
      .toLowerCase()
      .includes("annual leave"),
  ).length;
  await expect(questionsHeading).toHaveText(
    `${filteredCount.toLocaleString("en-US")} Questions`,
  );
  await expect(pagination).toContainText("Showing 1–10 of");
  await expect(page.locator(".question-cell").first()).toContainText(
    "annual leave",
  );
  await page.locator(".question-cell").first().click();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Employee Handbook.pdf",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("bayview-chat-logs.csv");
  const csvPath = await download.path();
  expect(csvPath).not.toBeNull();
  const csvHeader = (await readFile(csvPath!, "utf8")).split("\r\n")[0];
  expect(csvHeader).not.toContain('"source"');
  await page
    .getByPlaceholder("Search questions or responses...")
    .fill("no-such-question-unique");
  await expect(
    page.getByRole("heading", { name: "No results found" }),
  ).toBeVisible();
  await expect(page.getByText("Source document", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Reset filters" }).click();
  await departmentFilter.selectOption("Front Office Department");
  const visibleDepartments = await page
    .locator(".conversation-table .table-user small")
    .allTextContents();
  expect(visibleDepartments.length).toBeGreaterThan(0);
  expect(visibleDepartments.every((name) => name === "Front Office")).toBe(
    true,
  );
  await departmentFilter.selectOption("all");
  await page.getByLabel("Response status").selectOption("failed");
  await expect(page.locator("tbody .badge").first()).toHaveText("Failed");
});

test("settings keep only Profile and Connections and persist profile changes", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.locator(".settings-tabs button")).toHaveText([
    "Profile",
    "Connections",
  ]);
  await expect(
    page.getByRole("button", { name: "System configuration", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "User roles", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".settings-profile .settings-aside")).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Your workspace, protected.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Administrator authentication", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Row-level data access policies", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Private document storage", { exact: true }),
  ).toHaveCount(0);
  const profileBounds = await page.locator(".settings-profile").boundingBox();
  const cardBounds = await page
    .locator(".settings-profile > .card")
    .boundingBox();
  expect(cardBounds!.width).toBeCloseTo(profileBounds!.width, 0);
  await page.getByLabel("Full name").fill("Jordan Taylor");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Jordan Taylor");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "System status" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("Jordan Taylor");
});

test("minimal header preserves profile, demo login and mobile navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Global search")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".topbar kbd")).toHaveCount(0);
  await page.getByRole("button", { name: "Admin profile menu" }).click();
  await expect(
    page.getByRole("link", { name: "Account settings" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "Account settings" }),
  ).not.toBeVisible();
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome to Bayview." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot your password?" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Enter demo workspace" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator(
      ".topbar .global-search, .topbar .notification-button, .topbar kbd",
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("link", { name: "SOP Documents", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^Questions and Repiles/ }).click();
  await expect(
    page.getByRole("heading", { name: "Questions and Repiles" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/chat-logs-mobile.png",
    fullPage: true,
  });
});

test("overview and chat logs fit phone and tablet viewports without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/chat-logs"]) {
      await page.goto(route);
      await page.locator("main h1").waitFor();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      if (width === 390 && route === "/")
        await page.screenshot({
          path: "test-results/overview-mobile.png",
          fullPage: true,
        });
    }
  }
  expect(errors).toEqual([]);
});

test("server routes reject unauthenticated operations", async ({ request }) => {
  for (const route of [
    "/api/dashboard",
    "/api/documents?id=123",
    "/api/settings",
    "/api/health",
  ]) {
    expect((await request.get(route)).status()).toBe(401);
  }
  expect(
    (
      await request.patch("/api/settings", {
        data: { action: "role", role: "admin", id: "123" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (await request.delete("/api/documents", { data: { id: "123" } })).status(),
  ).toBe(401);
});
