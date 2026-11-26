import { BAYVIEW_CATALOG } from "./bayview-catalog";

// The hotel's departments and positions (organization chart). This is the one
// list used by Users, Documents, Add Employee and the employee sign-up page.
export const catalogDepartments: readonly string[] = BAYVIEW_CATALOG.map(
  (group) => group.department,
);
const key = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+department$/, "");
// "Front Office" and "Front Office Department" are the same department.
export const sameDepartment = (a?: string | null, b?: string | null) =>
  Boolean(a?.trim() && b?.trim()) && key(a!) === key(b!);
// A document can be shared with the whole hotel instead of one department.
export const WHOLE_HOTEL = "All departments";
export const isWholeHotel = (value?: string | null) =>
  ["all", "company", "all departments", "whole hotel"].includes(
    (value || "").trim().toLowerCase(),
  );
export const departmentTitle = (name: string) =>
  isWholeHotel(name) ? "Whole hotel" : name;
// Is a document (by its department value) inside this department group?
export const inDepartment = (
  documentDepartment: string | null | undefined,
  group: string,
) =>
  isWholeHotel(group)
    ? isWholeHotel(documentDepartment)
    : sameDepartment(documentDepartment, group);
// The department / position list a document is shown in. Whole-hotel documents
// are listed where they were filed (list_*); the others by their own access.
export const listDepartmentOf = (doc: {
  department?: string | null;
  list_department?: string | null;
}) => (isWholeHotel(doc.department) ? doc.list_department : doc.department);
export const listPositionOf = (doc: {
  department?: string | null;
  position?: string | null;
  list_position?: string | null;
}) => (isWholeHotel(doc.department) ? doc.list_position : doc.position) || null;
// The catalog spelling of a department when it has one, otherwise the value as given.
export function canonicalDepartment(value?: string | null) {
  const name = value?.trim() || "";
  if (isWholeHotel(name)) return WHOLE_HOTEL;
  return catalogDepartments.find((item) => sameDepartment(item, name)) ?? name;
}
export function catalogPositionsOf(department?: string | null) {
  return (
    BAYVIEW_CATALOG.find((group) =>
      sameDepartment(group.department, department),
    )?.positions ?? []
  );
}
export const catalogPositionNames: readonly string[] = [
  ...new Set(BAYVIEW_CATALOG.flatMap((group) => group.positions)),
];
