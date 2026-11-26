"use client";
import { useId, useState } from "react";
import { Building2, Globe, Lock, User } from "lucide-react";

export const accessIcons = {
  hotel: Globe,
  department: Building2,
  position: User,
};
import { Modal } from "./ui";
import { useWorkspace } from "./workspace-provider";
import { departmentTitle, isWholeHotel } from "@/lib/organization";
import {
  accessLabel,
  scopeFromDocument,
  scopeReady,
  scopeSummary,
  scopeToFields,
  type AccessScope,
} from "@/lib/document-access";
import type { Document as KnowledgeDocument } from "@/lib/types";

export {
  accessLabel,
  emptyScope,
  scopeFromDocument,
  scopeReady,
  scopeSummary,
  scopeToFields,
  type AccessScope,
} from "@/lib/document-access";

const choices = [
  {
    mode: "hotel" as const,
    icon: Globe,
    title: "Whole hotel",
    text: "Everyone in the hotel",
  },
  {
    mode: "department" as const,
    icon: Building2,
    title: "One department",
    text: "Everyone in the department, including its heads",
  },
  {
    mode: "position" as const,
    icon: User,
    title: "One position",
    text: "Only that position, plus the department head",
  },
];

export function AccessPicker({
  scope,
  onChange,
  departments,
  positionsFor,
  departmentRef,
  disabled,
}: {
  scope: AccessScope;
  onChange: (scope: AccessScope) => void;
  departments: string[];
  positionsFor: (department: string) => string[];
  departmentRef?: React.RefObject<HTMLSelectElement | null>;
  disabled?: boolean;
}) {
  const name = useId();
  const positions = positionsFor(scope.department);
  const withCurrent =
    scope.position && !positions.includes(scope.position)
      ? [scope.position, ...positions]
      : positions;
  return (
    <fieldset className="access-picker" disabled={disabled}>
      <legend>
        Who can get answers from this document{" "}
        <span className="document-required">Required</span>
      </legend>
      <div className="access-choices" role="radiogroup">
        {choices.map(({ mode, icon: Icon, title, text }) => (
          <label
            key={mode}
            className={`access-choice ${scope.mode === mode ? "is-selected" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={mode}
              checked={scope.mode === mode}
              onChange={() =>
                onChange({
                  mode,
                  // Department / position always say where the document is listed.
                  department: scope.department,
                  position:
                    mode === "position" || mode === "hotel"
                      ? scope.position
                      : "",
                })
              }
            />
            <span className="access-choice-icon">
              <Icon size={20} />
            </span>
            <span className="access-choice-text">
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
          </label>
        ))}
      </div>
      {scope.mode === "hotel" && (
        <p className="access-note">
          Everyone can ask about this document. Choose where it is listed on the
          Documents page.
        </p>
      )}
      <label className="field">
        {scope.mode === "hotel" ? "List under department" : "Department"}
        <select
          ref={departmentRef}
          required
          aria-label="Department"
          value={scope.department}
          onChange={(event) => {
            const department = event.target.value;
            onChange({
              ...scope,
              department,
              position: positionsFor(department).includes(scope.position)
                ? scope.position
                : "",
            });
          }}
        >
          <option value="">Select a department</option>
          {departments
            .filter((item) => !isWholeHotel(item))
            .map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
        </select>
      </label>
      {(scope.mode === "position" || scope.mode === "hotel") && (
        <label className="field">
          {scope.mode === "hotel"
            ? "List under position (optional)"
            : "Position"}
          <select
            required={scope.mode === "position"}
            aria-label="Position"
            value={scope.position}
            disabled={!scope.department}
            onChange={(event) =>
              onChange({ ...scope, position: event.target.value })
            }
          >
            <option value="">
              {!scope.department
                ? "Select a department first"
                : scope.mode === "hotel"
                  ? "All positions"
                  : "Select a position"}
            </option>
            {withCurrent.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="access-summary" role="status">
        <Lock size={14} /> {scopeSummary(scope)}
      </p>
    </fieldset>
  );
}

// Opened from the "Access" button of a document (and from its details).
export function PermissionsDialog({
  doc,
  departments,
  positionsFor,
  onClose,
}: {
  doc: KnowledgeDocument;
  departments: string[];
  positionsFor: (department: string) => string[];
  onClose: () => void;
}) {
  const { demo, setData, refresh, toast } = useWorkspace();
  const [scope, setScope] = useState<AccessScope>(() => scopeFromDocument(doc));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const original = scopeFromDocument(doc);
  const dirty =
    scope.mode !== original.mode ||
    scope.department !== original.department ||
    scope.position !== original.position;
  async function save() {
    if (!dirty || !scopeReady(scope) || busy) return;
    setBusy(true);
    setError("");
    const fields = scopeToFields(scope);
    try {
      if (demo) {
        setData((previous) => ({
          ...previous,
          documents: previous.documents.map((item) =>
            item.id === doc.id
              ? {
                  ...item,
                  department: fields.department,
                  position: fields.position || null,
                  list_department: fields.list_department,
                  list_position: fields.list_position || null,
                }
              : item,
          ),
        }));
      } else {
        const response = await fetch("/api/documents", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: doc.id, ...fields }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Unable to save.");
        await refresh();
      }
      toast("Permissions saved. The AI uses them right away.");
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Document permissions"
      subtitle={doc.original_filename || doc.document_name}
      className="document-permissions-modal"
      trapFocus
      onClose={onClose}
    >
      <div className="document-permissions-body">
        <p className="access-current">
          Now: <strong>{accessLabel(doc).title}</strong>
          {" · "}
          {departmentTitle(accessLabel(doc).detail)}
        </p>
        <AccessPicker
          scope={scope}
          onChange={setScope}
          departments={departments}
          positionsFor={positionsFor}
          disabled={busy}
        />
        {error && (
          <p className="document-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="employee-editor-footer">
        <button
          className="button"
          type="button"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!dirty || !scopeReady(scope) || busy}
          onClick={() => void save()}
        >
          {busy ? "Saving..." : "Save permissions"}
        </button>
      </div>
    </Modal>
  );
}
