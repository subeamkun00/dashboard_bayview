import { expect, test } from "@playwright/test";
import { answerAccuracy } from "../src/lib/answer-accuracy";
import { createDemoData } from "../src/lib/demo";
import { rangeStart } from "../src/lib/utils";
import type { Chat } from "../src/lib/types";

const now = new Date(2026, 9, 14, 12).getTime();
const record = (response_status: Chat["response_status"], timestamp = now) => ({
  response_status,
  created_at: new Date(timestamp).toISOString(),
});

test("accuracy uses only Success and Fallback within the selected range", () => {
  const data = [
    ...Array.from({ length: 8 }, () => record("success")),
    record("fallback"),
    record("fallback"),
    record("failed"),
    record("replied"),
    record("success", rangeStart(30, now) - 1),
    record("success", now + 1),
    { response_status: "success" as const, created_at: "invalid" },
  ];
  expect(answerAccuracy(data, 30, now)).toEqual({
    success: 8,
    fallback: 2,
    total: 10,
    percentage: 80,
  });
  expect(
    answerAccuracy([record("success", rangeStart(30, now))], 30, now)
      .percentage,
  ).toBe(100);
});

test("accuracy distinguishes no eligible data from all Fallback", () => {
  expect(answerAccuracy([], 7, now).percentage).toBeNull();
  expect(
    answerAccuracy([record("failed"), record("replied")], 7, now).percentage,
  ).toBeNull();
  expect(answerAccuracy([record("fallback")], 7, now).percentage).toBe(0);
  expect(answerAccuracy([record("success")], 7, now).percentage).toBe(100);
  expect(
    answerAccuracy(
      [record("success"), record("success"), record("fallback")],
      7,
      now,
    ).percentage,
  ).toBeCloseTo(66.6667, 4);
});

test("changing the date range updates the percentage", () => {
  const data = [record("fallback"), record("success", rangeStart(30, now))];
  expect(answerAccuracy(data, 7, now).percentage).toBe(0);
  expect(answerAccuracy(data, 30, now).percentage).toBe(50);
});

test("Overview replaces only Users today and updates accuracy for all date ranges", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".stat-top")).toHaveText([
    "Total users",
    "Total questions",
    "Questions today",
    "Accuracy",
  ]);
  const card = page.locator(".accuracy-card");
  const demo = createDemoData();
  const testNow = Date.now();
  for (const days of [30, 7, 60]) {
    await page.getByLabel("Date range").selectOption(String(days));
    const result = answerAccuracy(demo.chats, days, testNow);
    const text =
      result.percentage === null
        ? "—"
        : `${result.percentage.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    await expect(card.locator(".stat-middle")).toHaveText(text);
    await expect(card).toContainText(`Last ${days} days`);
    await expect(card).toContainText(
      `${result.success.toLocaleString("en-US")} Success · ${result.fallback.toLocaleString("en-US")} Fallback`,
    );
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(card).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/overview-accuracy-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("accuracy ignores admin contact requests and command logs", () => {
  const data = [
    record("success"),
    record("fallback"),
    { ...record("fallback"), category: "Contact" },
    { ...record("success"), category: "SOP Guide" },
    { ...record("success"), category: "Login" },
    { ...record("success"), category: "General" },
  ];
  expect(answerAccuracy(data, 30, now)).toEqual({
    success: 2,
    fallback: 1,
    total: 3,
    percentage: (2 / 3) * 100,
  });
});
