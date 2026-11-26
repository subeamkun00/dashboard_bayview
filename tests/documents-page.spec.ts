import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDemoData } from "../src/lib/demo";
import {
  documentUpdatedAt,
  validateDocumentFile,
  documentMaxFileSize,
} from "../src/lib/documents";
import type { Document } from "../src/lib/types";

const base = createDemoData().documents[0];
const expectedDepartments = [
  "Admin replies",
  "Executive Office Department",
  "Accounting Department",
  "Front Office Department",
  "Housekeeping Department",
  "Food & Beverage Department",
  "Main Kitchen Department",
  "Engineering Department",
  "Human Resources Department",
  "IT",
];
const sampleDocuments: Document[] = [
  {
    ...base,
    id: "hr-guide",
    document_name: "Employee guide",
    original_filename: "Employee guide.pdf",
    department: "Human Resources",
    uploaded_by: "demo-admin",
    uploaded_by_name: "Old profile name",
    uploaded_at: "2026-09-17T02:30:00Z",
  },
  {
    ...base,
    id: "front-guide",
    document_name: "Guest welcome.pdf",
    original_filename: "Guest welcome.pdf",
    department: "Front Office",
    uploaded_by: null,
    uploaded_by_name: null,
  },
  {
    ...base,
    id: "custom-guide",
    document_name: "Night duty.docx",
    original_filename: "Night duty.docx",
    department: "Night Audit",
    uploaded_by: "missing-user",
    uploaded_by_name: "Taylor Reed",
  },
];
async function seed(page: Page, documents: Document[] = sampleDocuments) {
  await page.addInitScript((records) => {
    if (!localStorage.getItem("documents-test-seeded")) {
      localStorage.setItem("bayview-demo-documents", JSON.stringify(records));
      localStorage.setItem("documents-test-seeded", "yes");
    }
  }, documents);
}
function section(page: Page, name: string) {
  return page.locator(".department-section").filter({
    has: page.getByRole("heading", {
      name: new RegExp(`^${name} \\d+ documents?$`),
    }),
  });
}

test("document metadata uses the latest known timestamp and the configured file limit", () => {
  expect(
    documentUpdatedAt({
      ...base,
      updated_at: "2026-09-19T00:00:00Z",
      last_processed_at: "2026-09-20T00:00:00Z",
      uploaded_at: "2026-09-17T00:00:00Z",
    }),
  ).toBe("2026-09-20T00:00:00Z");
  expect(
    documentUpdatedAt({
      ...base,
      updated_at: "invalid",
      uploaded_at: "2026-09-17T00:00:00Z",
    }),
  ).toBe("2026-09-17T00:00:00Z");
  expect(validateDocumentFile(new File([""], "empty.txt"))).toContain("1 byte");
  expect(
    validateDocumentFile(
      new File([new Uint8Array(documentMaxFileSize + 1)], "too-large.pdf"),
    ),
  ).toContain("20 MB");
});

test("department accordions preserve configuration, show real counts and search filenames", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/documents");
  await expect(page.locator(".department-section")).toHaveCount(10);
  await expect(page.locator(".department-heading-text strong")).toHaveText(
    expectedDepartments,
  );
  await expect(
    page.getByRole("heading", { name: "SOP Documents", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload file", exact: true }),
  ).toHaveCount(1);
  await expect(
    section(page, "Human Resources Department").getByRole("button", {
      name: /^Human Resources/,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    section(page, "Front Office Department").getByRole("button", {
      name: /^Front Office/,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(section(page, "Night Audit")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Documents to organize" }),
  ).toBeVisible();
  await section(page, "Human Resources Department")
    .getByRole("button", { name: /^Human Resources/ })
    .click();
  await expect(page.getByRole("columnheader")).toHaveText([
    "Filename",
    "Access",
    "Type",
    "Uploaded by",
    "Updated",
    "Actions",
  ]);
  await expect(
    section(page, "Human Resources Department").getByRole("row").nth(1),
  ).toContainText("Alex Morgan");
  await expect(
    section(page, "Human Resources Department").getByRole("row").nth(1),
  ).not.toContainText("Old profile name");
  await expect(
    page.getByRole("columnheader", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("main .badge").filter({ hasText: "Ready" }),
  ).toHaveCount(0);
  await section(page, "Front Office Department")
    .getByRole("button", { name: /^Front Office/ })
    .click();
  await expect(
    section(page, "Human Resources Department").getByRole("table"),
  ).toBeVisible();
  await expect(
    section(page, "Front Office Department").getByRole("row").nth(1),
  ).toContainText("Unknown user");
  const search = page.getByPlaceholder("Search departments or documents...");
  await search.fill("Night duty");
  await expect(page.locator(".department-section")).toHaveCount(0);
  await expect(page.getByRole("row").nth(1)).toContainText("Taylor Reed");
  await expect(
    page.getByText("Current department: Night Audit", { exact: true }),
  ).toBeVisible();
  await search.fill("Engineering");
  await expect(
    page.getByText("No documents in this department yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload file", exact: true }),
  ).toHaveCount(1);
  await search.fill("nothing-matches-this-filename");
  await expect(
    page.getByRole("heading", { name: "No matching departments or documents" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(
    section(page, "Front Office Department").getByRole("table"),
  ).toBeVisible();
  await section(page, "Front Office Department")
    .getByRole("button", { name: /^Front Office/ })
    .click();
  await page.screenshot({
    path: "test-results/documents-departments-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("document upload requires department and file, preserves originals and updates department counts", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/documents");
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload document" });
  await expect(
    dialog.getByText("TXT recommended", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("PDF and DOCX also supported · Up to 20 MB", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Department", { exact: true }).getByRole("option"),
  ).toHaveText(["Select a department", ...expectedDepartments.slice(1)]);
  const upload = dialog.getByRole("button", { name: "Upload", exact: true });
  const fileInput = dialog.getByLabel("Document file", { exact: true });
  await expect(upload).toBeDisabled();
  await fileInput.setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("invalid"),
  });
  await expect(dialog.getByRole("alert")).toContainText("PDF, DOCX, or TXT");
  const originalContents = "Welcome guests and confirm the reservation.";
  await fileInput.setInputFiles({
    name: "Guest arrival guide.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(originalContents),
  });
  await expect(upload).toBeDisabled();
  await dialog
    .getByLabel("Department", { exact: true })
    .selectOption("Front Office Department");
  await expect(upload).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Remove Guest arrival guide.txt" })
    .click();
  await expect(upload).toBeDisabled();
  await fileInput.setInputFiles({
    name: "Guest arrival guide.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(originalContents),
  });
  await upload.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    section(page, "Front Office Department").getByRole("button", {
      name: /^Front Office/,
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    section(page, "Front Office Department").getByRole("heading"),
  ).toContainText("2 documents");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Guest arrival guide.txt" });
  await expect(row).toContainText("Alex Morgan");
  await expect(row).not.toContainText("Failed");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bayview-demo-documents") || "[]").find(
      (record: Document) =>
        record.original_filename === "Guest arrival guide.txt",
    ),
  );
  expect(saved).toMatchObject({
    department: "Front Office Department",
    uploaded_by: "demo-admin",
    document_type: "Other",
    processing_status: "failed",
  });
  expect(Date.parse(saved.uploaded_at)).not.toBeNaN();
  await page.reload();
  await page
    .getByPlaceholder("Search departments or documents...")
    .fill("Guest arrival guide.txt");
  const actions = row.getByRole("button", {
    name: "Actions for Guest arrival guide.txt",
    exact: true,
  });
  await actions.click();
  await page.getByRole("menuitem", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Document preview" });
  await expect(preview.locator("pre")).toHaveText(originalContents);
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await actions.click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("Guest arrival guide.txt");
  expect(await readFile((await download.path())!, "utf8")).toBe(
    originalContents,
  );
  await row
    .getByRole("button", { name: "Guest arrival guide.txt", exact: true })
    .click();
  const details = page.getByRole("dialog", { name: "Document details" });
  await details.getByText("Knowledge base details", { exact: true }).click();
  await expect(details).toContainText("Demo upload saved locally");
  await details.getByRole("button", { name: "Reprocess", exact: true }).click();
  await expect(details.getByRole("alert")).toContainText(
    "Demo mode does not run the RAG workflow",
  );
  await details.getByRole("button", { name: "Close dialog" }).click();
  await actions.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete document?" });
  await expect(confirmation).toContainText("Guest arrival guide.txt");
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(row).toBeVisible();
  await actions.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(row).not.toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(
    section(page, "Front Office Department").getByRole("heading"),
  ).toContainText("1 document");
});

test("department pagination shows at most ten documents and resets with search", async ({
  page,
}) => {
  const records = Array.from({ length: 26 }, (_, index) => ({
    ...base,
    id: `guide-${index}`,
    document_name: `Guide ${String(index + 1).padStart(2, "0")}.pdf`,
    original_filename: `Guide ${String(index + 1).padStart(2, "0")}.pdf`,
    department: "Human Resources",
    uploaded_at: new Date(Date.UTC(2026, 8, 26 - index)).toISOString(),
  }));
  await seed(page, records);
  await page.goto("/documents");
  await section(page, "Human Resources Department")
    .getByRole("button", { name: /^Human Resources/ })
    .click();
  const pagination = page.getByRole("navigation", {
    name: "Human Resources Department document pagination",
  });
  const rows = page.locator(".department-document-table tbody tr");
  await expect(pagination).toContainText("Showing 1–10 of 26 results");
  await expect(rows).toHaveCount(10);
  await expect(
    pagination.getByRole("button", { name: "Previous" }),
  ).toBeDisabled();
  const bounds = await pagination.boundingBox();
  const tableBounds = await page.getByRole("table").boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(tableBounds!.y + 1);
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(pagination).toContainText("Showing 11–20 of 26 results");
  await expect(rows.first()).toContainText("Guide 11.pdf");
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(pagination).toContainText("Showing 21–26 of 26 results");
  await expect(rows).toHaveCount(6);
  await expect(pagination.getByRole("button", { name: "Next" })).toBeDisabled();
  await page
    .getByPlaceholder("Search departments or documents...")
    .fill("Guide 01");
  await expect(rows).toHaveCount(1);
  await expect(
    section(page, "Human Resources Department").getByRole("heading"),
  ).toContainText("26 documents");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(pagination).toContainText("Showing 1–10 of 26 results");
});

test("empty departments remain visible and the document layout fits phone and tablet", async ({
  page,
}) => {
  await seed(page, []);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/documents");
  await section(page, "Human Resources Department")
    .getByRole("button", { name: /^Human Resources/ })
    .click();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(section(page, "Human Resources Department")).toBeVisible();
    await expect(
      page.getByText("No documents in this department yet."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Upload file", exact: true }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload document" });
  await expect(dialog.getByLabel("Department", { exact: true })).toBeFocused();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/documents-upload-mobile.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload file", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: "test-results/documents-departments-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("document upload preserves its file and department after a recoverable failure", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/documents");
  await page.evaluate(() => {
    const original = IDBFactory.prototype.open;
    let failOnce = true;
    IDBFactory.prototype.open = function (
      ...args: Parameters<IDBFactory["open"]>
    ) {
      if (failOnce && args[0] === "bayview-demo-files") {
        failOnce = false;
        throw new Error("Temporary file storage failure");
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload document" });
  await dialog
    .getByLabel("Department", { exact: true })
    .selectOption("Front Office Department");
  await dialog.getByLabel("Document file", { exact: true }).setInputFiles({
    name: "Retry guide.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Guide contents"),
  });
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Temporary file storage failure",
  );
  await expect(dialog.getByLabel("Department", { exact: true })).toHaveValue(
    "Front Office Department",
  );
  await expect(
    dialog.getByRole("list", { name: "Selected files" }),
  ).toContainText("Retry guide.txt");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Retry guide.txt" }),
  ).toHaveCount(1);
});
