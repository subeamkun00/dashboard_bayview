import { expect, test } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";
import { documentDepartments } from "../src/lib/documents";
import { sameDepartment } from "../src/lib/organization";

test("Questions uses all nine SOP departments in the same order, excluding Admin replies", async ({
  page,
}) => {
  const data = createDemoData();
  const employees = data.users.slice(0, 2).map((user, index) => ({
    ...user,
    department: index === 0 ? "Front Office" : "Front Office Department",
  }));
  await page.addInitScript((users) => {
    localStorage.setItem("bayview-demo-users", JSON.stringify(users));
  }, employees);
  await page.goto("/documents");
  await expect(page.locator(".department-heading-text strong")).toHaveCount(10);
  const sopDepartments = (
    await page.locator(".department-heading-text strong").allTextContents()
  ).filter((name) => name !== "Admin replies");
  expect(sopDepartments).toEqual(documentDepartments);
  await page.goto("/chat-logs");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const department = page.getByLabel("Filter by department", { exact: true });
  await expect(department.getByRole("option")).toHaveText([
    "All departments",
    ...sopDepartments,
  ]);
  await expect(department.getByRole("option")).toHaveCount(10);
  await department.selectOption("Front Office Department");
  const expected = data.chats.filter((chat) =>
    employees.some(
      (user) =>
        user.id === chat.user_id &&
        sameDepartment(user.department, "Front Office Department"),
    ),
  ).length;
  await expect(page.locator(".questions-list-card .card-header h2")).toHaveText(
    `${expected.toLocaleString("en-US")} Questions`,
  );
  await department.selectOption("Engineering Department");
  await expect(page.locator(".questions-list-card .card-header h2")).toHaveText(
    "0 Questions",
  );
  await expect(
    page.getByRole("heading", { name: "No results found" }),
  ).toBeVisible();
  await expect(department.getByRole("option")).toHaveText([
    "All departments",
    ...documentDepartments,
  ]);
  await department.selectOption("all");
  await expect(page.locator(".questions-list-card .card-header h2")).toHaveText(
    `${data.chats.length.toLocaleString("en-US")} Questions`,
  );
});

test("Questions still lists every department without any employee records", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("bayview-demo-users", "[]"),
  );
  await page.goto("/chat-logs");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(
    page.getByLabel("Filter by department").getByRole("option"),
  ).toHaveText(["All departments", ...documentDepartments]);
});
