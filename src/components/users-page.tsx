"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Ban,
  CheckCircle2,
  FileText,
  Info,
  KeyRound,
  LoaderCircle,
  Link2,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Avatar, Card, Empty, Modal, Pagination, SearchInput } from "./ui";
import { AddEmployeeModal } from "./add-employee-modal";
import {
  frontendEmployeeOptions,
  validateEmployeeCreation,
  type EmployeeCreationInput,
} from "@/lib/employee-creation";
import {
  assistantAccess,
  employeeAccessStatus,
  employeeDepartment,
  employeeOptions,
  hasCompletedLineSignup,
} from "@/lib/users";
import { number } from "@/lib/utils";
import {
  catalogDepartments,
  catalogPositionsOf,
  sameDepartment,
} from "@/lib/organization";
import type { Employee } from "@/lib/types";
import { EMPLOYEE_DRAWER_QUERY } from "@/lib/ui-scale";

type Draft = {
  id: string;
  department: string;
  position: string;
  originalDepartment: string;
  originalPosition: string;
  head: boolean;
  originalHead: boolean;
  allDocs: boolean;
  originalAllDocs: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  originalFirstName: string;
  originalLastName: string;
  originalPhone: string;
};
function AccessBadge({ user }: { user: Employee }) {
  const status = employeeAccessStatus(user);
  return (
    <span
      className={`employee-access ${status}`}
      title={
        status === "unverified"
          ? "LINE sign-up has not been completed."
          : undefined
      }
    >
      <span aria-hidden="true" />
      {status === "unverified"
        ? "Unverified"
        : status === "enabled"
          ? "Enabled"
          : "Disabled"}
    </span>
  );
}
function AccountBadge({
  variant,
  children,
}: {
  variant: "enabled" | "disabled" | "unverified";
  children: React.ReactNode;
}) {
  return (
    <span className={`employee-account-badge ${variant}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
function AccountInfo({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className="employee-status-help">
      <button type="button" aria-label={label} aria-describedby={id}>
        <Info size={15} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}
export function UsersPage() {
  const {
    data,
    demo,
    admin,
    loading,
    error: loadError,
    setData,
    refresh,
    toast,
  } = useWorkspace();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [access, setAccess] = useState("all");
  const [sort, setSort] = useState("questions");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [discard, setDiscard] = useState<{ nextId: string | null } | null>(
    null,
  );
  const [disableConfirm, setDisableConfirm] = useState(false);
  const [busy, setBusy] = useState<"profile" | "access" | "contact" | null>(null);
  const [error, setError] = useState("");
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  // Frontend-only records stay local to this page. Never send them to the
  // existing user PATCH endpoint or persist them as real Supabase employees.
  const [previewUsers, setPreviewUsers] = useState<Employee[]>([]);
  const allUsers = useMemo(
    () => [...data.users, ...previewUsers],
    [data.users, previewUsers],
  );
  const submitting = useRef(false);
  const canEdit = admin.role === "admin";
  // Department heads may add employees (to their own department) but not edit anyone.
  const canAdd =
    canEdit || (admin.role === "head" && Boolean(admin.department));
  // Administrators edit everyone; a department head edits the contact details of
  // people in their own department.
  // Enable / disable access, invite codes and LINE reset: administrators for
  // everyone, a department head for people of their own department who are not
  // department heads themselves (themselves included).
  const canManageAccess = useCallback(
    (user: Employee) =>
      canEdit ||
      (admin.role === "head" &&
        Boolean(admin.department) &&
        !user.is_department_head &&
        employeeDepartment(user).trim().toLowerCase() ===
          (admin.department ?? "").trim().toLowerCase()),
    [canEdit, admin.role, admin.department],
  );
  const canEditEmployee = (user: Employee) =>
    canEdit ||
    (admin.role === "head" &&
      Boolean(admin.department) &&
      employeeDepartment(user).trim().toLowerCase() ===
        (admin.department ?? "").trim().toLowerCase());
  const options = useMemo(() => employeeOptions(allUsers), [allUsers]);
  const creationOptions = useMemo(() => {
    const all = frontendEmployeeOptions(allUsers);
    if (admin.role !== "head") return all;
    // Department heads can only add people to their own department.
    const own = (admin.department ?? "").trim().toLowerCase();
    const departments = all.departments.filter(
      ({ name }) => name.trim().toLowerCase() === own,
    );
    const ids = new Set(departments.map(({ id }) => id));
    return {
      ...all,
      departments,
      positions: all.positions.filter(({ department_id }) =>
        ids.has(department_id),
      ),
    };
  }, [allUsers, admin.role, admin.department]);
  const selected = allUsers.find((user) => user.id === draft?.id);
  const dirty = Boolean(
    draft &&
    (draft.department !== draft.originalDepartment ||
      draft.position !== draft.originalPosition ||
      draft.head !== draft.originalHead ||
      draft.allDocs !== draft.originalAllDocs ||
      draft.firstName !== draft.originalFirstName ||
      draft.lastName !== draft.originalLastName ||
      draft.phone !== draft.originalPhone),
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    data.chats.forEach((chat) =>
      result.set(chat.user_id, (result.get(chat.user_id) || 0) + 1),
    );
    return result;
  }, [data.chats]);
  const users = useMemo(
    () =>
      allUsers
        .filter((user) => {
          const query = search.trim().toLowerCase();
          return (
            (!query ||
              [user.display_name, user.nickname].some((value) =>
                value?.toLowerCase().includes(query),
              )) &&
            (department === "all" ||
              (department === "unassigned"
                ? !employeeDepartment(user)
                : sameDepartment(employeeDepartment(user), department))) &&
            (access === "all" || employeeAccessStatus(user) === access)
          );
        })
        .sort((a, b) =>
          sort === "name"
            ? a.display_name.localeCompare(b.display_name)
            : (sort === "least" ? 1 : -1) *
                ((counts.get(a.id) || 0) - (counts.get(b.id) || 0)) ||
              a.display_name.localeCompare(b.display_name),
        ),
    [allUsers, search, department, access, sort, counts],
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(users.length / 8)));
  function selectUser(user: Employee) {
    const currentDepartment = employeeDepartment(user);
    const currentPosition = user.position?.trim() || "";
    setDraft({
      id: user.id,
      department: currentDepartment,
      position: currentPosition,
      originalDepartment: currentDepartment,
      originalPosition: currentPosition,
      head: Boolean(user.is_department_head),
      originalHead: Boolean(user.is_department_head),
      allDocs: Boolean(user.can_access_all_documents),
      originalAllDocs: Boolean(user.can_access_all_documents),
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      phone: user.phone ?? "",
      originalFirstName: user.first_name ?? "",
      originalLastName: user.last_name ?? "",
      originalPhone: user.phone ?? "",
    });
    setError("");
  }
  function requestEdit(user: Employee) {
    if (submitting.current || user.id === draft?.id) return;
    if (dirty) setDiscard({ nextId: user.id });
    else selectUser(user);
  }
  function requestClose() {
    if (submitting.current) return;
    if (dirty) setDiscard({ nextId: null });
    else {
      setDraft(null);
      setError("");
    }
  }
  function clearFilters() {
    setSearch("");
    setDepartment("all");
    setAccess("all");
    setPage(1);
  }
  async function addEmployee(input: EmployeeCreationInput) {
    if (!canAdd)
      throw new Error("Only administrators and department heads can add employees.");
    const validation = validateEmployeeCreation(input, creationOptions);
    const message = Object.values(validation)[0];
    if (message) throw new Error(message);
    if (allUsers.some((user) => user.employee_id === input.employee_id))
      throw new Error("This employee ID already exists.");
    const department = creationOptions.departments.find(
      ({ id }) => id === input.department_id,
    )!;
    const position = creationOptions.positions.find(
      ({ id }) => id === input.position_id,
    )!;
    if (!demo) {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: input.first_name,
          last_name: input.last_name,
          employee_id: input.employee_id,
          phone: input.phone,
          department: department.name,
          position: position.name,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "Unable to add this employee.");
      await refresh();
      toast("Employee added successfully.");
      return {
        invite_code: result.invite_code as string | null,
        warning: result.warning as string | undefined,
      };
    }
    const timestamp = new Date().toISOString();
    setPreviewUsers((previous) => [
      ...previous,
      {
        ...input,
        id: `preview-${crypto.randomUUID()}`,
        line_user_id: null,
        display_name: `${input.first_name} ${input.last_name}`,
        department: department.name,
        position: position.name,
        profile_image_url: null,
        first_seen: timestamp,
        last_seen: timestamp,
        created_at: timestamp,
        status: "inactive",
        access_enabled: false,
      },
    ]);
    toast("Employee added successfully — demo mode, not saved to a database.");
  }
  const loadInvite = useCallback(
    async (user: Employee) => {
      if (
        !canManageAccess(user) ||
        demo ||
        previewUsers.some((p) => p.id === user.id)
      )
        return null;
      const response = await fetch(
        `/api/users/invite?id=${encodeURIComponent(user.id)}`,
        { cache: "no-store" },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "Unable to load the invite code.");
      return (result.invite ?? null) as {
        code: string;
        expires_at: string;
      } | null;
    },
    [canManageAccess, demo, previewUsers],
  );
  async function issueInvite(user: Employee, reset: boolean) {
    if (!canManageAccess(user))
      throw new Error(
        "You can only manage employees of your own department who are not department heads.",
      );
    if (demo || previewUsers.some((p) => p.id === user.id))
      throw new Error("Invite codes need a connected Supabase project.");
    const response = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, reset }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(result.error || "Unable to issue an invite code.");
    await refresh();
    return result.invite_code as string;
  }
  async function mutate(
    action: "profile" | "access" | "contact",
    enabled?: boolean,
  ) {
    if (!selected || !draft || submitting.current) return;
    const allowed =
      action === "contact"
        ? canEditEmployee(selected)
        : action === "access"
          ? canManageAccess(selected)
          : canEdit;
    if (!allowed) return;
    const contact = {
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      phone: draft.phone.trim(),
    };
    const contactChanged =
      draft.firstName !== draft.originalFirstName ||
      draft.lastName !== draft.originalLastName ||
      draft.phone !== draft.originalPhone;
    const localContact = {
      first_name: contact.first_name,
      last_name: contact.last_name,
      display_name: `${contact.first_name} ${contact.last_name}`.trim(),
      phone: contact.phone || null,
    };
    submitting.current = true;
    setBusy(action);
    setError("");
    const preview = previewUsers.some((user) => user.id === selected.id);
    try {
      let updated: Employee;
      if (demo || preview) {
        updated =
          action === "contact"
            ? { ...selected, ...localContact }
            : action === "profile"
              ? {
                  ...selected,
                  department: draft.department,
                  position: draft.position,
                  is_department_head: draft.head,
                  can_access_all_documents: draft.allDocs,
                  ...localContact,
                }
              : {
                ...selected,
                access_enabled: enabled,
                ...(enabled === false && {
                  auth_user_id: null,
                  line_user_id: null,
                  claimed_at: null,
                  line_id: null,
                  email: null,
                }),
              };
      } else {
        const response = await fetch("/api/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "contact"
              ? { id: selected.id, action, ...contact }
              : action === "profile"
                ? {
                    id: selected.id,
                    action,
                    department: draft.department,
                    position: draft.position,
                    ...(draft.head !== draft.originalHead && {
                      is_department_head: draft.head,
                    }),
                    ...(draft.allDocs !== draft.originalAllDocs && {
                      can_access_all_documents: draft.allDocs,
                    }),
                    ...(contactChanged && contact),
                  }
                : { id: selected.id, action, access_enabled: enabled },
          ),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Unable to save this user.");
        updated = result.user;
      }
      if (preview)
        setPreviewUsers((previous) =>
          previous.map((user) => (user.id === updated.id ? updated : user)),
        );
      else
        setData((previous) => ({
          ...previous,
          users: previous.users.map((user) =>
            user.id === updated.id ? updated : user,
          ),
        }));
      if (action === "profile" || action === "contact")
        setDraft((previous) =>
          previous?.id === updated.id
            ? {
                ...previous,
                department: employeeDepartment(updated),
                position: updated.position || "",
                originalDepartment: employeeDepartment(updated),
                originalPosition: updated.position || "",
                head: Boolean(updated.is_department_head),
                originalHead: Boolean(updated.is_department_head),
                allDocs: Boolean(updated.can_access_all_documents),
                originalAllDocs: Boolean(updated.can_access_all_documents),
                firstName: updated.first_name ?? "",
                lastName: updated.last_name ?? "",
                phone: updated.phone ?? "",
                originalFirstName: updated.first_name ?? "",
                originalLastName: updated.last_name ?? "",
                originalPhone: updated.phone ?? "",
              }
            : previous,
        );
      if (action === "access") setDisableConfirm(false);
      toast(
        action === "profile" || action === "contact"
          ? "Employee details updated."
          : enabled
            ? "User access enabled."
            : "User disabled. LINE and email links have been reset.",
      );
      if (!demo && !preview) await refresh();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Unable to save this user. Please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PEOPLE</div>
          <h1>User management</h1>
        </div>
      </div>
      {loadError && (
        <div className="employee-load-error" role="alert">
          <div>
            <strong>Unable to load users</strong>
            <p>{loadError}</p>
          </div>
          <button className="button" onClick={() => void refresh()}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      )}
      <div className={`employee-management ${selected ? "editor-open" : ""}`}>
        <Card className="employee-card">
          <div className="employee-card-heading">
            <h2>
              {number(allUsers.length)}{" "}
              {allUsers.length === 1 ? "user" : "users"}
            </h2>
            <button
              className="button primary employee-add-button"
              type="button"
              aria-haspopup="dialog"
              disabled={!canAdd || loading || busy !== null}
              title={
                canAdd
                  ? "Add employee"
                  : "Administrator or department head access required"
              }
              onClick={() => setAddEmployeeOpen(true)}
            >
              <Plus size={17} aria-hidden="true" /> Add Employee
            </button>
          </div>
          {previewUsers.length > 0 && (
            <p className="employee-page-preview-note" role="status">
              {previewUsers.length}{" "}
              {previewUsers.length === 1 ? "employee is" : "employees are"} a
              frontend preview only. Not saved to the database; refreshing or
              leaving this page removes the preview.
            </p>
          )}
          <div className="employee-toolbar">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search name or nickname..."
            />
            <select
              className="filter-select"
              aria-label="User department"
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All departments</option>
              <option value="unassigned">Not assigned</option>
              {options.departments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              aria-label="User access"
              value={access}
              onChange={(event) => {
                setAccess(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All access</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="unverified">Unverified</option>
            </select>
            <select
              className="filter-select"
              aria-label="Sort users"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="questions">Most questions</option>
              <option value="least">Fewest questions</option>
              <option value="name">Name A–Z</option>
            </select>
            {(search || department !== "all" || access !== "all") && (
              <button className="text-link" onClick={clearFilters}>
                <X size={14} /> Clear filters
              </button>
            )}
          </div>
          <nav className="users-pagination" aria-label="User pagination">
            <Pagination
              page={currentPage}
              setPage={setPage}
              total={users.length}
            />
          </nav>
          <div className="table-scroll">
            <table className="data-table employee-table">
              <thead>
                <tr>
                  <th scope="col">Team member</th>
                  <th scope="col">Department</th>
                  <th scope="col">Position</th>
                  <th scope="col">Questions</th>
                  <th scope="col">Access</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }, (_, index) => (
                      <tr
                        key={index}
                        className="employee-skeleton"
                        aria-hidden="true"
                      >
                        {Array.from({ length: 6 }, (_, cell) => (
                          <td key={cell}>
                            <span />
                          </td>
                        ))}
                      </tr>
                    ))
                  : users
                      .slice((currentPage - 1) * 8, currentPage * 8)
                      .map((user) => (
                        <tr
                          key={user.id}
                          className={
                            selected?.id === user.id ? "employee-selected" : ""
                          }
                        >
                          <td>
                            <UserIdentity
                              user={user}
                              preview={previewUsers.some(
                                (record) => record.id === user.id,
                              )}
                            />
                          </td>
                          <td>{employeeDepartment(user) || "Not assigned"}</td>
                          <td>
                            {user.position?.trim() || "Not assigned"}
                            {user.is_department_head && (
                              <span className="head-badge">Head</span>
                            )}
                            {canEdit && user.can_access_all_documents && (
                              <span className="head-badge">All departments</span>
                            )}
                          </td>
                          <td>
                            <strong>{number(counts.get(user.id) || 0)}</strong>
                          </td>
                          <td>
                            <AccessBadge user={user} />
                          </td>
                          <td>
                            <button
                              className="button small employee-edit"
                              aria-label={`Edit ${user.display_name}`}
                              disabled={!canEditEmployee(user) || busy !== null}
                              title={
                                canEditEmployee(user)
                                  ? "Edit user"
                                  : "You can only edit employees of your own department"
                              }
                              onClick={() => requestEdit(user)}
                            >
                              <Pencil size={14} /> Edit
                            </button>
                          </td>
                        </tr>
                      ))}
              </tbody>
            </table>
          </div>
          {loading && (
            <p role="status" className="employee-loading-text">
              Loading users…
            </p>
          )}
          {!loading && !loadError && !users.length && (
            <>
              <Empty
                title="No users found"
                text="Try a different name, nickname, department, or access filter."
              />
              <div className="employee-empty-action">
                <button className="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            </>
          )}
          <nav aria-label="User pagination bottom">
            <Pagination
              page={currentPage}
              setPage={setPage}
              total={users.length}
            />
          </nav>
        </Card>
        {selected && draft && (
          <UserEditor
            key={selected.id}
            user={selected}
            draft={draft}
            options={options}
            busy={busy}
            error={error}
            dirty={dirty}
            onClose={requestClose}
            onChange={(changes) =>
              setDraft((previous) =>
                previous ? { ...previous, ...changes } : previous,
              )
            }
            canEdit={canEdit}
            canManageAccount={canManageAccess(selected)}
            onSave={() => void mutate(canEdit ? "profile" : "contact")}
            onAccess={() => {
              setError("");
              if (assistantAccess(selected)) setDisableConfirm(true);
              else void mutate("access", true);
            }}
            onInvite={(reset) => issueInvite(selected, reset)}
            onLoadInvite={loadInvite}
          />
        )}
      </div>
      {addEmployeeOpen && (
        <AddEmployeeModal
          options={creationOptions}
          existingEmployeeIds={allUsers.flatMap((user) =>
            user.employee_id ? [user.employee_id] : [],
          )}
          previewNote={demo}
          onCreate={addEmployee}
          onClose={() => setAddEmployeeOpen(false)}
        />
      )}
      {discard && (
        <Modal title="Discard changes?" onClose={() => setDiscard(null)}>
          <p className="modal-description">
            Unsaved changes to {selected?.display_name} will be discarded.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDiscard(null)}>
              Keep editing
            </button>
            <button
              className="button destructive"
              onClick={() => {
                const next = allUsers.find(
                  (user) => user.id === discard.nextId,
                );
                setDiscard(null);
                if (next) selectUser(next);
                else {
                  setDraft(null);
                  setError("");
                }
              }}
            >
              Discard changes
            </button>
          </div>
        </Modal>
      )}
      {disableConfirm && selected && (
        <Modal
          title="Disable this user?"
          className="employee-disable-modal"
          closeDisabled={busy !== null}
          onClose={() => {
            if (!submitting.current) setDisableConfirm(false);
          }}
        >
          <p className="employee-confirm-name">{selected.display_name}</p>
          <section
            className="employee-disable-warning"
            aria-label="Effects of disabling this user"
          >
            <h3>
              <span className="employee-disable-alert-icon" aria-hidden="true">
                !
              </span>
              This will disable the user and:
            </h3>
            <ul className="employee-disable-effects">
              <li>
                <span
                  className="employee-disable-effect-icon"
                  aria-hidden="true"
                >
                  <UserRound />
                </span>
                <div>
                  <h4>Access removed</h4>
                  <p>User will lose access to the AI assistant.</p>
                </div>
              </li>
              <li>
                <span
                  className="employee-disable-effect-icon"
                  aria-hidden="true"
                >
                  <Link2 />
                </span>
                <div>
                  <h4>LINE &amp; email reset</h4>
                  <p>
                    Their LINE and email links will be reset. Existing invite
                    codes will no longer work.
                  </p>
                </div>
              </li>
              <li>
                <span
                  className="employee-disable-effect-icon"
                  aria-hidden="true"
                >
                  <FileText />
                </span>
                <div>
                  <h4>Question history kept</h4>
                  <p>Their profile and question history will remain stored.</p>
                </div>
              </li>
            </ul>
            <p className="employee-disable-note">
              <Info aria-hidden="true" />
              User can sign up again via LINE after access is enabled.
            </p>
          </section>
          {error && (
            <p className="document-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy !== null}
              onClick={() => setDisableConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="button destructive"
              disabled={busy !== null}
              onClick={() => void mutate("access", false)}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Ban size={16} />
              )}
              {busy ? "Disabling…" : "Disable user"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function UserIdentity({ user, preview }: { user: Employee; preview: boolean }) {
  const content = (
    <>
      <Avatar name={user.display_name} image={user.profile_image_url} />
      <span>
        <strong>{user.display_name}</strong>
        <small>
          {user.nickname?.trim() || (preview ? "Frontend preview" : "—")}
        </small>
      </span>
    </>
  );
  return preview ? (
    <span className="table-user" title="Not saved to database">
      {content}
    </span>
  ) : (
    <Link href={`/users/${user.id}`} className="table-user">
      {content}
    </Link>
  );
}

function UserEditor({
  user,
  draft,
  options,
  busy,
  error,
  dirty,
  onClose,
  onChange,
  onSave,
  onAccess,
  onInvite,
  onLoadInvite,
  canEdit,
  canManageAccount,
}: {
  canEdit: boolean;
  canManageAccount: boolean;
  user: Employee;
  draft: Draft;
  options: ReturnType<typeof employeeOptions>;
  busy: "profile" | "access" | "contact" | null;
  error: string;
  dirty: boolean;
  onClose: () => void;
  onChange: (changes: Partial<Draft>) => void;
  onSave: () => void;
  onAccess: () => void;
  onInvite: (reset: boolean) => Promise<string>;
  onLoadInvite: (
    user: Employee,
  ) => Promise<{ code: string; expires_at: string } | null>;
}) {
  const titleId = useId();
  const [invite, setInvite] = useState<{
    error?: string;
    busy?: boolean;
    code?: string;
  }>({});
  const [pending, setPending] = useState<{
    status: "loading" | "ready" | "none" | "error";
    code?: string;
    expires_at?: string;
  }>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const accessEnabled = assistantAccess(user);
  const lineVerified = hasCompletedLineSignup(user);
  const activeInviteCode = invite.code || pending.code;
  useEffect(() => {
    let cancelled = false;
    setInvite({});
    setCopied(false);
    if (user.line_user_id) {
      setPending({ status: "none" });
      return;
    }
    setPending({ status: "loading" });
    onLoadInvite(user)
      .then((info) => {
        if (!cancelled)
          setPending(info ? { status: "ready", ...info } : { status: "none" });
      })
      .catch(() => {
        if (!cancelled) setPending({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, user.line_user_id, accessEnabled, onLoadInvite]);
  const dialog = useRef<HTMLDialogElement>(null);
  const departmentInput = useRef<HTMLSelectElement>(null);
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(EMPLOYEE_DRAWER_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(EMPLOYEE_DRAWER_QUERY);
    const change = () => setMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const current = dialog.current;
    if (mobile) current?.showModal();
    departmentInput.current?.focus();
    return () => {
      current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [mobile, user.id]);
  const content = (
    <>
      <div className="employee-editor-header">
        <h2 id={titleId}>Edit user</h2>
        <button
          className="icon-button"
          aria-label="Close edit user"
          disabled={busy !== null}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <form
        className="employee-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && draft.department && draft.position) onSave();
        }}
      >
        <div className="employee-editor-scroll">
          <div className="employee-editor-person">
            <Avatar
              name={user.display_name}
              image={user.profile_image_url}
              size="large-avatar"
            />
            <div>
              <strong>{user.display_name}</strong>
              <span>{user.nickname?.trim() || "—"}</span>
            </div>
          </div>
          <dl className="employee-info" aria-label="Employee details">
            <div>
              <dt>Full name</dt>
              <dd>
                {`${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() ||
                  user.display_name}
              </dd>
            </div>
            <div>
              <dt>Nickname</dt>
              <dd>{user.nickname?.trim() || "—"}</dd>
            </div>
            <div>
              <dt>Employee ID</dt>
              <dd>{user.employee_id || "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{user.phone || "—"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email || "—"}</dd>
            </div>
            <div>
              <dt>LINE</dt>
              <dd>
                {user.line_user_id
                  ? `Linked${user.line_id ? ` (${user.line_id})` : ""}`
                  : "Not linked"}
              </dd>
            </div>
          </dl>
          <fieldset disabled={busy !== null}>
            <label className="field">
              First name
              <input
                aria-label="First name"
                required
                maxLength={100}
                autoComplete="off"
                value={draft.firstName}
                onChange={(event) => onChange({ firstName: event.target.value })}
              />
            </label>
            <label className="field">
              Last name
              <input
                aria-label="Last name"
                required
                maxLength={100}
                autoComplete="off"
                value={draft.lastName}
                onChange={(event) => onChange({ lastName: event.target.value })}
              />
            </label>
            <label className="field">
              Phone number
              <input
                aria-label="Phone number"
                type="tel"
                inputMode="tel"
                maxLength={30}
                autoComplete="off"
                placeholder="e.g. 081-234-5678"
                value={draft.phone}
                onChange={(event) => onChange({ phone: event.target.value })}
              />
            </label>
          </fieldset>
          {canEdit && (
          <fieldset disabled={busy !== null}>
            <label className="field">
              Department
              <select
                ref={departmentInput}
                aria-label="Employee department"
                required
                value={draft.department}
                onChange={(event) => {
                  const next = event.target.value;
                  // Keep the position only if it belongs to the new department.
                  onChange({
                    department: next,
                    position: catalogPositionsOf(next).includes(draft.position)
                      ? draft.position
                      : "",
                  });
                }}
              >
                <option value="">Select department</option>
                {draft.originalDepartment &&
                  !catalogDepartments.includes(draft.originalDepartment) && (
                    <option value={draft.originalDepartment}>
                      {draft.originalDepartment} (not in the list)
                    </option>
                  )}
                {catalogDepartments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Position
              <select
                aria-label="Employee position"
                required
                value={draft.position}
                onChange={(event) => onChange({ position: event.target.value })}
              >
                <option value="">
                  {draft.department
                    ? "Select position"
                    : "Select a department first"}
                </option>
                {(() => {
                  const own = catalogPositionsOf(draft.department);
                  return (
                    <>
                      {draft.position && !own.includes(draft.position) && (
                        <option value={draft.position}>
                          {draft.position} (not in the list)
                        </option>
                      )}
                      {own.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </>
                  );
                })()}
              </select>
            </label>
            <label className="field-check">
              <input
                type="checkbox"
                checked={draft.head}
                onChange={(event) => onChange({ head: event.target.checked })}
              />
              <span>
                <strong>Department head</strong>
                <small>
                  Gets answers from every document of their own department,
                  whatever the position, plus the documents marked for the
                  whole hotel (department ALL). Documents of other departments
                  stay hidden. Once the employee has verified their email,
                  they can also sign in to this dashboard to answer
                  questions, upload documents and add employees to their own
                  department.
                </small>
              </span>
            </label>
            <label className="field-check">
              <input
                type="checkbox"
                checked={draft.allDocs}
                onChange={(event) =>
                  onChange({ allDocs: event.target.checked })
                }
              />
              <span>
                <strong>All-department document access</strong>
                <small>
                  Receives answers and original files from the documents of
                  every department and position, not only their own.
                  Department heads are limited to their own department. Grant
                  this only to staff who are authorised to view all company
                  documents, such as IT support.
                </small>
              </span>
            </label>
          </fieldset>
          )}
          {canEdit && !options.positions.length && (
            <p className="employee-config-warning" role="status">
              No employee positions are available. Ask your administrator to
              configure the real position list.
            </p>
          )}
          {canManageAccount && (
          <section
            className="employee-account-card"
            aria-labelledby={`${titleId}-account`}
          >
            <h3 id={`${titleId}-account`}>Account status</h3>
            <dl className="employee-status-list">
              <div className="employee-status-row">
                <dt>
                  <span
                    className="employee-status-icon access"
                    aria-hidden="true"
                  >
                    <ShieldCheck size={23} />
                  </span>
                  <span className="employee-status-label">Access</span>
                  <AccountInfo
                    label="About access"
                    text="Controls this employee’s access to the AI assistant. LINE sign-up is tracked separately."
                  />
                </dt>
                <dd data-testid="editor-access-status">
                  <AccountBadge
                    variant={accessEnabled ? "enabled" : "disabled"}
                  >
                    {accessEnabled ? "Enabled" : "Disabled"}
                  </AccountBadge>
                </dd>
              </div>
              <div className="employee-status-row">
                <dt>
                  <span
                    className={`employee-status-icon line ${lineVerified ? "verified" : ""}`}
                    aria-hidden="true"
                  >
                    <MessageCircle size={25} />
                    <span>LINE</span>
                  </span>
                  <span className="employee-line-identity">
                    <span className="employee-line-heading">
                      <span className="employee-status-label">
                        LINE account
                      </span>
                      <AccountInfo
                        label="About LINE account"
                        text="Verified after the employee completes LINE sign-up. Sign-up does not change their access setting."
                      />
                    </span>
                    {lineVerified && user.email && (
                      <span
                        className="employee-line-email"
                        data-testid="editor-line-email"
                      >
                        {user.email}
                      </span>
                    )}
                  </span>
                </dt>
                <dd data-testid="editor-line-status">
                  <AccountBadge
                    variant={lineVerified ? "enabled" : "unverified"}
                  >
                    {lineVerified ? "Verified" : "Unverified"}
                  </AccountBadge>
                </dd>
              </div>
            </dl>
            <button
              className={`button employee-access-action ${accessEnabled ? "disable" : "enable"}`}
              type="button"
              disabled={busy !== null}
              onClick={onAccess}
            >
              {busy === "access" ? (
                <LoaderCircle size={16} className="spin" />
              ) : accessEnabled ? (
                <Ban size={21} />
              ) : (
                <CheckCircle2 size={21} />
              )}
              {accessEnabled ? "Disable user" : "Enable user"}
            </button>
            <div className="employee-link-actions">
              {(!user.line_user_id || activeInviteCode) && (
                <dl className="employee-status-list">
                  <div className="employee-status-row employee-invite-row">
                    <dt>
                      <span
                        className="employee-status-icon neutral"
                        aria-hidden="true"
                      >
                        <KeyRound size={23} />
                      </span>
                      <span className="employee-status-label">Invite code</span>
                    </dt>
                    <dd aria-live="polite">
                      {activeInviteCode ? (
                        <span className="employee-invite-value">
                          <span className="invite-code-row">
                            <code className="invite-code-inline">
                              {activeInviteCode}
                            </code>
                            <button
                              type="button"
                              className="button small"
                              onClick={() => {
                                void navigator.clipboard
                                  ?.writeText(activeInviteCode)
                                  .then(() => setCopied(true))
                                  .catch(() => setCopied(false));
                              }}
                            >
                              {copied ? "Copied" : "Copy"}
                            </button>
                          </span>
                          {pending.expires_at && (
                            <small>
                              valid until{" "}
                              {new Date(
                                pending.expires_at,
                              ).toLocaleDateString()}
                            </small>
                          )}
                        </span>
                      ) : pending.status === "loading" ? (
                        "Loading…"
                      ) : pending.status === "error" ? (
                        "Unavailable (apply migration 009)."
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              <button
                className="button employee-invite-action"
                type="button"
                disabled={busy !== null || invite.busy}
                onClick={() => {
                  if (
                    user.line_user_id &&
                    !window.confirm(
                      "This unlinks the employee's LINE account and email so they can sign up again. Continue?",
                    )
                  )
                    return;
                  setInvite({ busy: true });
                  setCopied(false);
                  onInvite(Boolean(user.line_user_id))
                    .then(async (code) => {
                      // Keep the new invite code with the account controls.
                      setInvite({ code });
                      try {
                        const info = await onLoadInvite(user);
                        setPending({ status: "ready", code, ...info });
                      } catch {
                        setPending({ status: "ready", code });
                      }
                    })
                    .catch((problem) =>
                      setInvite({
                        error:
                          problem instanceof Error
                            ? problem.message
                            : "Unable to issue an invite code.",
                      }),
                    );
                }}
              >
                {invite.busy ? (
                  <LoaderCircle size={21} className="spin" />
                ) : user.line_user_id ? (
                  <RefreshCw size={21} />
                ) : (
                  <KeyRound size={21} />
                )}
                {user.line_user_id ? "Reset link" : "Generate invite code"}
              </button>
              {invite.error && (
                <p className="document-error" role="alert">
                  {invite.error}
                </p>
              )}
            </div>
          </section>
          )}
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
            disabled={busy !== null}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={
              busy !== null ||
              !dirty ||
              !draft.firstName.trim() ||
              !draft.lastName.trim() ||
              (canEdit &&
                (!draft.department ||
                  !draft.position ||
                  !options.positions.includes(draft.position)))
            }
          >
            {busy === "profile" || busy === "contact" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Save size={16} />
            )}
            {busy === "profile" || busy === "contact"
              ? "Saving…"
              : "Save changes"}
          </button>
        </div>
      </form>
    </>
  );
  return mobile ? (
    <dialog
      ref={dialog}
      className="employee-editor employee-drawer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {content}
    </dialog>
  ) : (
    <aside
      className="employee-editor"
      role="region"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {content}
    </aside>
  );
}
