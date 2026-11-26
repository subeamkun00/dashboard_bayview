import type { Document } from "./types";
import {
  canonicalDepartment,
  catalogDepartments,
  catalogPositionsOf,
  departmentTitle,
  inDepartment,
  isWholeHotel,
  listDepartmentOf,
  listPositionOf,
  sameDepartment,
  WHOLE_HOTEL,
} from "./organization";
export {
  canonicalDepartment,
  departmentTitle,
  inDepartment,
  isWholeHotel,
  listDepartmentOf,
  listPositionOf,
  sameDepartment,
  WHOLE_HOTEL,
};

// Answers saved from admin replies in the dashboard (see lib/admin-answer.ts).
// Created by the system, so not offered in the upload form.
export const ADMIN_REPLY_CATEGORY = "Admin Reply";
export const isAdminReply = (doc: {
  document_type?: string | null;
  document_name?: string | null;
}) =>
  doc.document_type === ADMIN_REPLY_CATEGORY ||
  /^คำตอบจาก(แอดมิน|เจ้าหน้าที่)/.test(doc.document_name || "");

export const documentCategories = [
  "SOP",
  "Job Description",
  "Policy",
  "Training",
  "Other",
] as const;
export const documentDepartments: string[] = [...catalogDepartments];
export const documentMimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
export const documentMaxFileSize = 20 * 1024 * 1024;
export const documentFileAccept = Object.keys(documentMimeTypes)
  .map((extension) => `.${extension}`)
  .join(",");
export function documentFilename(doc: Document) {
  return doc.original_filename || doc.document_name;
}
export function documentUpdatedAt(doc: Document) {
  return [doc.updated_at, doc.last_processed_at, doc.uploaded_at]
    .filter(
      (value): value is string =>
        Boolean(value) && !Number.isNaN(Date.parse(value!)),
    )
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
export function documentCategory(value: string) {
  return value === "Internal Policy" ? "Policy" : value;
}
export function fileType(doc: Document) {
  return (
    doc.file_type ||
    (doc.original_filename || doc.file_url || doc.document_name)
      .split(".")
      .pop() ||
    "file"
  ).toUpperCase();
}
export function fileSize(bytes: number) {
  if (!bytes) return "Size unavailable";
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function validateDocumentFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !documentMimeTypes[extension])
    return "Choose a PDF, DOCX, or TXT file.";
  if (!file.size || file.size > documentMaxFileSize)
    return "File must be between 1 byte and 20 MB.";
  return "";
}

// Positions a document can be written for: the organization chart plus any
// extra position passed in (for example the one the document already has).
export function positionsForDepartment(
  department: string,
  extra: (string | null | undefined)[] = [],
) {
  return [
    ...new Set([
      ...catalogPositionsOf(department),
      ...extra.filter((name): name is string => Boolean(name?.trim())),
    ]),
  ];
}
export const allPositionsLabel = "All positions in this department";
