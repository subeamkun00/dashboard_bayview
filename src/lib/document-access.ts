import { canonicalDepartment, isWholeHotel, WHOLE_HOTEL } from "./organization";
import type { Document as KnowledgeDocument } from "./types";

// Who can get answers from a document: everyone, one department, or one position.
export type AccessScope = {
  mode: "hotel" | "department" | "position";
  department: string;
  position: string;
};
export const emptyScope: AccessScope = {
  mode: "department",
  department: "",
  position: "",
};
export function scopeFromDocument(doc: KnowledgeDocument): AccessScope {
  if (isWholeHotel(doc.department))
    // For a whole-hotel document, department / position say where it is listed.
    return {
      mode: "hotel",
      department: canonicalDepartment(doc.list_department),
      position: doc.list_position || "",
    };
  const department = canonicalDepartment(doc.department);
  return doc.position
    ? { mode: "position", department, position: doc.position }
    : { mode: "department", department, position: "" };
}
// The values stored on the document.
export function scopeToFields(scope: AccessScope) {
  if (scope.mode === "hotel")
    return {
      department: WHOLE_HOTEL,
      position: "",
      list_department: scope.department,
      list_position: scope.position,
    };
  return {
    department: scope.department,
    position: scope.mode === "position" ? scope.position : "",
    list_department: null,
    list_position: null,
  };
}
// Every document is listed under a department; "one position" also needs one.
export const scopeReady = (scope: AccessScope) =>
  Boolean(scope.department) &&
  (scope.mode !== "position" || Boolean(scope.position));
export function scopeSummary(scope: AccessScope) {
  if (scope.mode === "hotel")
    return scope.department
      ? `Everyone in the hotel can get answers from this document. It is listed under ${scope.department}${scope.position ? ` › ${scope.position}` : ""}.`
      : "Choose where this document is listed to continue.";
  if (!scope.department) return "Choose a department to continue.";
  if (scope.mode === "department")
    return `Everyone in ${scope.department} can get answers from this document, including its department heads.`;
  if (!scope.position) return "Choose a position to continue.";
  return `Only ${scope.position} in ${scope.department} can get answers from this document, plus the department head of ${scope.department}.`;
}
// Short label for the table.
export function accessLabel(doc: KnowledgeDocument) {
  const scope = scopeFromDocument(doc);
  if (scope.mode === "hotel")
    return { mode: scope.mode, title: "Whole hotel", detail: "Everyone" };
  if (scope.mode === "position")
    return {
      mode: scope.mode,
      title: scope.position,
      detail: scope.department,
    };
  return {
    mode: scope.mode,
    title: scope.department || "Not assigned",
    detail: "All positions",
  };
}
