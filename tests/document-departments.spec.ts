import { test, expect } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";

test("documents retain old and unassigned records without adding department groups or changing stored values", async ({
  page,
}) => {
  const base = createDemoData().documents[0];
  const documents = [
    "HR",
    "Finance",
    "Training",
    "Sales & Marketing",
    "Bell Boy",
    "All departments",
    null,
  ].map((department, index) => ({
    ...base,
    id: `old-department-${index}`,
    document_name: `Previous guide ${index}.pdf`,
    original_filename: `Previous guide ${index}.pdf`,
    department,
  }));
  await page.addInitScript(
    (records) =>
      localStorage.setItem("bayview-demo-documents", JSON.stringify(records)),
    documents,
  );
  await page.goto("/documents");
  await expect(page.locator(".department-section")).toHaveCount(10);
  await expect(
    page.getByRole("heading", { name: "Documents to organize", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".legacy-documents-card")).toContainText(
    "6 documents use a previous or unassigned department",
  );
  await page
    .getByRole("button", { name: "View documents", exact: true })
    .click();
  await expect(page.locator(".legacy-documents-card tbody tr")).toHaveCount(6);
  await expect(
    page.getByText("Current department: HR", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Current department: Finance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Current department: Not assigned", { exact: true }),
  ).toBeVisible();
  await page
    .getByPlaceholder("Search departments or documents...")
    .fill("Previous guide 0");
  await expect(
    page.getByRole("row").filter({ hasText: "Previous guide 0.pdf" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bayview-demo-documents") || "[]"),
  );
  expect(saved).toEqual(documents);
});
