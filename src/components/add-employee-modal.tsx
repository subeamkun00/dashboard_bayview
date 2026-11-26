"use client";

import { useId, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Plus } from "lucide-react";
import { Modal } from "./ui";
import {
  emptyEmployeeInput,
  isValidPersonName,
  validateEmployeeCreation,
  type EmployeeCreationField,
  type EmployeeCreationInput,
  type EmployeeCreationOptions,
} from "@/lib/employee-creation";

export function AddEmployeeModal({
  options,
  existingEmployeeIds,
  previewNote = false,
  onCreate,
  onClose,
}: {
  options: EmployeeCreationOptions;
  existingEmployeeIds: string[];
  previewNote?: boolean;
  onCreate: (
    input: EmployeeCreationInput,
  ) => Promise<{ invite_code?: string | null; warning?: string } | void>;
  onClose: () => void;
}) {
  const id = useId();
  const firstName = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [input, setInput] = useState<EmployeeCreationInput>({
    ...emptyEmployeeInput,
  });
  const [touched, setTouched] = useState<
    Partial<Record<EmployeeCreationField, boolean>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    code: string | null;
    warning?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const errors = validateEmployeeCreation(input, options);
  if (
    input.employee_id.trim() &&
    existingEmployeeIds.includes(input.employee_id.trim())
  )
    errors.employee_id = "This employee ID already exists.";
  const positions = options.positions.filter(
    ({ department_id }) => department_id === input.department_id,
  );
  const invalid = Object.keys(errors).length > 0;
  function close() {
    if (!submitting.current) onClose();
  }
  function change(field: EmployeeCreationField, value: string) {
    setError("");
    setInput((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "department_id" ? { position_id: "" } : {}),
    }));
    if (field === "department_id")
      setTouched((previous) => ({ ...previous, position_id: false }));
  }
  function blur(field: EmployeeCreationField) {
    // Closing a native dialog (including the Strict Mode effect cleanup) can
    // blur its focused input. That is not a user validation interaction.
    if (!firstName.current?.closest("dialog")?.open) return;
    setTouched((previous) => ({ ...previous, [field]: true }));
    if (["first_name", "last_name", "employee_id"].includes(field))
      setInput((previous) => ({
        ...previous,
        [field]: previous[field].trim(),
      }));
  }
  function visibleError(field: EmployeeCreationField) {
    const invalidName =
      ["first_name", "last_name"].includes(field) &&
      input[field] &&
      !isValidPersonName(input[field].trim());
    return touched[field] ||
      invalidName ||
      (field === "employee_id" &&
        errors.employee_id === "This employee ID already exists.")
      ? errors[field]
      : undefined;
  }
  function fieldError(field: EmployeeCreationField) {
    const message = visibleError(field);
    return message ? (
      <small
        className="employee-field-error"
        id={`${id}-${field}-error`}
        role="alert"
      >
        {message}
      </small>
    ) : null;
  }
  function describedBy(field: EmployeeCreationField, helper = false) {
    return (
      [
        helper ? `${id}-${field}-help` : "",
        visibleError(field) ? `${id}-${field}-error` : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined
    );
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || invalid) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await onCreate({
        ...input,
        first_name: input.first_name.trim(),
        last_name: input.last_name.trim(),
        employee_id: input.employee_id.trim(),
        phone: input.phone.trim(),
      });
      if (result && (result.invite_code || result.warning))
        setCreated({
          name: `${input.first_name.trim()} ${input.last_name.trim()}`,
          code: result.invite_code || null,
          warning: result.warning,
        });
      else onClose();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Unable to add this employee. Please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (created)
    return (
      <Modal
        title="Employee added"
        subtitle={created.name}
        className="employee-create-modal"
        trapFocus
        onClose={onClose}
      >
        <div className="employee-create-scroll">
          {created.code && (
            <>
              <p>
                Give this one-time invite code to the employee. They need it,
                together with their details, to sign up from the link in LINE.
                It is shown only once and expires in 14 days.
              </p>
              <div className="invite-code" aria-label="Invite code">
                <code>{created.code}</code>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(created.code || "")
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false));
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          )}
          {created.warning && (
            <p className="document-error" role="alert">
              {created.warning}
            </p>
          )}
        </div>
        <div className="employee-editor-footer">
          <button className="button primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal
      title="Add Employee"
      subtitle="Enter employee information."
      className="employee-create-modal"
      initialFocusRef={firstName}
      closeDisabled={busy}
      trapFocus
      onClose={close}
    >
      <form
        className="employee-create-form"
        onSubmit={submit}
        noValidate
        aria-busy={busy}
      >
        <div className="employee-create-scroll">
          {previewNote && (
            <p className="employee-preview-note">
              Frontend preview only — not saved to the database (demo mode,
              no Supabase project connected).
            </p>
          )}
          <fieldset disabled={busy}>
            <div className="employee-name-fields">
              {(["first_name", "last_name"] as const).map((field, index) => (
                <div className="field" key={field}>
                  <label htmlFor={`${id}-${field}`}>
                    {index === 0 ? "First name" : "Last name"}{" "}
                    <span className="employee-required" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id={`${id}-${field}`}
                    ref={index === 0 ? firstName : undefined}
                    required
                    type="text"
                    maxLength={100}
                    autoComplete={index === 0 ? "given-name" : "family-name"}
                    placeholder={index === 0 ? "e.g. Somchai" : "e.g. Inlin"}
                    value={input[field]}
                    onChange={(event) => change(field, event.target.value)}
                    onBlur={() => blur(field)}
                    aria-invalid={Boolean(visibleError(field))}
                    aria-describedby={describedBy(field, true)}
                  />
                  <small id={`${id}-${field}-help`}>
                    Thai or English letters.
                  </small>
                  {fieldError(field)}
                </div>
              ))}
            </div>
            <div className="field">
              <label htmlFor={`${id}-employee_id`}>
                Employee ID{" "}
                <span className="employee-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id={`${id}-employee_id`}
                required
                type="text"
                maxLength={100}
                autoComplete="off"
                placeholder="Enter employee ID"
                value={input.employee_id}
                onChange={(event) => change("employee_id", event.target.value)}
                onBlur={() => blur("employee_id")}
                aria-invalid={Boolean(visibleError("employee_id"))}
                aria-describedby={describedBy("employee_id")}
              />
              {fieldError("employee_id")}
            </div>
            <div className="field">
              <label htmlFor={`${id}-phone`}>
                Phone number
              </label>
              <input
                id={`${id}-phone`}
                type="tel"
                maxLength={30}
                autoComplete="off"
                placeholder="e.g. 081-234-5678"
                value={input.phone}
                onChange={(event) => change("phone", event.target.value)}
                onBlur={() => blur("phone")}
                aria-invalid={Boolean(visibleError("phone"))}
                aria-describedby={describedBy("phone", true)}
              />
              <small id={`${id}-phone-help`}>
                Optional. The employee confirms their own number when they sign up.
              </small>
              {fieldError("phone")}
            </div>
            <div className="field">
              <label htmlFor={`${id}-department_id`}>
                Department{" "}
                <span className="employee-required" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id={`${id}-department_id`}
                required
                value={input.department_id}
                onChange={(event) =>
                  change("department_id", event.target.value)
                }
                onBlur={() => blur("department_id")}
                aria-invalid={Boolean(visibleError("department_id"))}
                aria-describedby={describedBy("department_id")}
              >
                <option value="">Select department</option>
                {options.departments.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              {fieldError("department_id")}
            </div>
            <div className="field">
              <label htmlFor={`${id}-position_id`}>
                Position{" "}
                <span className="employee-required" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id={`${id}-position_id`}
                required
                disabled={!input.department_id}
                value={input.position_id}
                onChange={(event) => change("position_id", event.target.value)}
                onBlur={() => blur("position_id")}
                aria-invalid={Boolean(visibleError("position_id"))}
                aria-describedby={describedBy("position_id", true)}
              >
                <option value="">Select position</option>
                {positions.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <small id={`${id}-position_id-help`}>
                {input.department_id && !positions.length
                  ? "No positions available for this department in the current data. Connect the employee catalog when the backend is ready."
                  : "Select a department to view available positions."}
              </small>
              {fieldError("position_id")}
            </div>
            <div className="field">
              <label htmlFor={`${id}-invite`}>Invite code</label>
              <input
                id={`${id}-invite`}
                readOnly
                disabled
                value=""
                placeholder="Generated automatically when you add"
              />
              <small>
                HR gives this one-time code to the employee. It appears on the
                next screen and stays visible in Edit user until they sign up.
              </small>
            </div>
          </fieldset>
          {error && (
            <p className="document-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="employee-create-footer">
          <button
            type="button"
            className="button"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button primary employee-add-button"
            disabled={busy || invalid}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
            ) : (
              <Plus size={16} aria-hidden="true" />
            )}
            {busy ? "Adding…" : "Add Employee"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
