import { test, expect } from "@playwright/test";
import {
  WHOLE_HOTEL,
  departmentTitle,
  inDepartment,
  isWholeHotel,
  canonicalDepartment,
  catalogDepartments,
  catalogPositionNames,
  catalogPositionsOf,
  sameDepartment,
} from "../src/lib/organization";
import { documentDepartments } from "../src/lib/documents";
import { employeeOptions } from "../src/lib/users";
import { frontendEmployeeOptions } from "../src/lib/employee-creation";

test("one organization list drives Users, Documents and Add Employee", () => {
  expect(catalogDepartments).toHaveLength(9);
  expect(catalogDepartments[0]).toBe("Executive Office Department");
  expect(catalogDepartments.at(-1)).toBe("IT");
  expect(catalogPositionNames).toContain("Guest Service Agent");
  expect(documentDepartments).toEqual([...catalogDepartments]);
  expect(frontendEmployeeOptions().departments.map(({ name }) => name)).toEqual([
    ...catalogDepartments,
  ]);
  const options = employeeOptions([{ department: "", position: null }]);
  for (const name of catalogDepartments) expect(options.departments).toContain(name);
  for (const name of catalogPositionNames) expect(options.positions).toContain(name);
});

test("older department spellings still match the chart", () => {
  expect(sameDepartment("Front Office", "Front Office Department")).toBe(true);
  expect(sameDepartment(" housekeeping department ", "Housekeeping")).toBe(true);
  expect(sameDepartment("Front Office", "Housekeeping Department")).toBe(false);
  expect(sameDepartment("", "Front Office")).toBe(false);
  expect(canonicalDepartment("Food & Beverage")).toBe("Food & Beverage Department");
  expect(canonicalDepartment("HR")).toBe("HR");
  expect(canonicalDepartment(null)).toBe("");
  expect(catalogPositionsOf("Front Office")).toContain("Night Manager");
  expect(catalogPositionsOf("IT")).toEqual(["IT support"]);
  expect(catalogPositionsOf("Unknown")).toEqual([]);
});

test("the catalog matches the list the hotel supplied", () => {
  const counts = [7, 10, 12, 9, 13, 15, 14, 4, 1];
  expect(catalogDepartments.map((name) => catalogPositionsOf(name).length)).toEqual(counts);
  expect(counts.reduce((sum, n) => sum + n, 0)).toBe(85);
});

test("documents can be shared with the whole hotel", () => {
  for (const value of ["All departments", "all", "Company", " whole hotel "])
    expect(isWholeHotel(value)).toBe(true);
  expect(isWholeHotel("Front Office")).toBe(false);
  expect(isWholeHotel("")).toBe(false);
  expect(canonicalDepartment("company")).toBe(WHOLE_HOTEL);
  expect(departmentTitle(WHOLE_HOTEL)).toBe("Whole hotel");
  expect(departmentTitle("IT")).toBe("IT");
  expect(inDepartment("All departments", WHOLE_HOTEL)).toBe(true);
  expect(inDepartment("Front Office", WHOLE_HOTEL)).toBe(false);
  expect(inDepartment("All departments", "Front Office Department")).toBe(false);
  expect(inDepartment("Front Office", "Front Office Department")).toBe(true);
  expect(catalogDepartments).not.toContain(WHOLE_HOTEL);
});
