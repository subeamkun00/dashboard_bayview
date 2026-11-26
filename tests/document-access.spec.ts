import { test, expect } from "@playwright/test";
import { createDemoData } from "../src/lib/demo";
import {
  accessLabel,
  emptyScope,
  scopeFromDocument,
  scopeReady,
  scopeSummary,
  scopeToFields,
} from "../src/lib/document-access";

const base = createDemoData().documents[0];
const doc = (department: string | null, position: string | null = null) => ({
  ...base,
  department,
  position,
});

test("a document's access is whole hotel, one department or one position", () => {
  expect(scopeFromDocument(doc("All departments"))).toEqual({
    mode: "hotel",
    department: "",
    position: "",
  });
  expect(scopeFromDocument(doc("Front Office"))).toEqual({
    mode: "department",
    department: "Front Office Department",
    position: "",
  });
  expect(scopeFromDocument(doc("Front Office Department", "Guest Service Agent"))).toEqual({
    mode: "position",
    department: "Front Office Department",
    position: "Guest Service Agent",
  });
  expect(accessLabel(doc("All departments"))).toMatchObject({ title: "Whole hotel", detail: "Everyone" });
  expect(accessLabel(doc("Housekeeping"))).toMatchObject({ title: "Housekeeping Department", detail: "All positions" });
  expect(accessLabel(doc("Housekeeping", "Gardener"))).toMatchObject({ title: "Gardener", detail: "Housekeeping Department" });
  expect(accessLabel(doc(null))).toMatchObject({ title: "Not assigned" });
});

test("the chosen access is what gets stored", () => {
  expect(scopeToFields({ mode: "hotel", department: "Front Office Department", position: "Night Manager" })).toEqual({
    department: "All departments",
    position: "",
  });
  expect(scopeToFields({ mode: "department", department: "IT", position: "IT support" })).toEqual({
    department: "IT",
    position: "",
  });
  expect(scopeToFields({ mode: "position", department: "IT", position: "IT support" })).toEqual({
    department: "IT",
    position: "IT support",
  });
});

test("an upload needs a complete access choice", () => {
  expect(scopeReady(emptyScope)).toBe(false);
  expect(scopeReady({ mode: "hotel", department: "", position: "" })).toBe(true);
  expect(scopeReady({ mode: "department", department: "IT", position: "" })).toBe(true);
  expect(scopeReady({ mode: "position", department: "IT", position: "" })).toBe(false);
  expect(scopeReady({ mode: "position", department: "IT", position: "IT support" })).toBe(true);
  expect(scopeSummary({ mode: "hotel", department: "", position: "" })).toContain("Everyone in the hotel");
  expect(scopeSummary({ mode: "position", department: "IT", position: "IT support" })).toContain("department head");
});
