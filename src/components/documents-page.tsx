"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BriefcaseBusiness,
  Building2,
  ChefHat,
  ChevronDown,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Lock,
  Pencil,
  House,
  Info,
  Landmark,
  LoaderCircle,
  MessageSquareReply,
  Megaphone,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  UploadCloud,
  UsersRound,
  Utensils,
  Wrench,
  X,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import {
  AccessPicker,
  PermissionsDialog,
  accessIcons,
  accessLabel,
  emptyScope,
  scopeReady,
  scopeToFields,
  type AccessScope,
} from "./document-access";
import { Card, Empty, Modal, Pagination, SearchInput } from "./ui";
import {
  departmentTitle,
  documentCategory,
  documentDepartments,
  documentFileAccept,
  documentFilename,
  documentMaxFileSize,
  documentMimeTypes,
  documentUpdatedAt,
  fileSize,
  fileType,
  inDepartment,
  isAdminReply,
  isWholeHotel,
  listDepartmentOf,
  listPositionOf,
  positionsForDepartment,
  sameDepartment,
  validateDocumentFile,
} from "@/lib/documents";
import { readFile, removeFile, storeFile } from "@/lib/local-files";
import { uploadWithProgress } from "@/lib/document-upload";
import { uiPixels } from "@/lib/ui-scale";
import type { Document as KnowledgeDocument } from "@/lib/types";

const pageSize = 10;
function formatDate(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
async function documentRequest(init: RequestInit, id?: string) {
  const response = await fetch(
    `/api/documents${id ? `?id=${encodeURIComponent(id)}` : ""}`,
    init,
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "Unable to update the document. Please try again.",
    );
  return result;
}
// One list per department. Whole-hotel documents are listed where they were
// filed (department / position), so there is no separate "Whole hotel" list.
// "Admin replies" is a list of its own: answers saved when an admin replied to
// a question the assistant could not answer. They stay out of the department
// lists so those keep only real documents.
const ADMIN_REPLIES = "Admin replies";
const allDocumentGroups: string[] = [ADMIN_REPLIES, ...documentDepartments];
const groupTitle = (name: string) =>
  name === ADMIN_REPLIES ? ADMIN_REPLIES : departmentTitle(name);
function departmentIcon(name: string) {
  if (name === ADMIN_REPLIES) return MessageSquareReply;
  if (isWholeHotel(name)) return Globe;
  const key = name.toLowerCase();
  if (/human resources|^hr$/.test(key)) return UsersRound;
  if (/front office|bell boy/.test(key)) return Building2;
  if (/housekeeping/.test(key)) return House;
  if (/food|beverage/.test(key)) return Utensils;
  if (/kitchen/.test(key)) return ChefHat;
  if (/engineer|^it$/.test(key)) return Wrench;
  if (/sales|marketing/.test(key)) return Megaphone;
  if (/account|purchasing|finance/.test(key)) return Landmark;
  if (/executive/.test(key)) return BriefcaseBusiness;
  return FolderOpen;
}

function DocumentActions({
  document: doc,
  disabled,
  onDetails,
  onPreview,
  onDownload,
  onDelete,
}: {
  document: KnowledgeDocument;
  disabled: boolean;
  onDetails: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  function invoke(action: () => void) {
    menu.current?.hidePopover();
    action();
  }
  return (
    <>
      <button
        ref={trigger}
        className="icon-button document-menu-trigger"
        popoverTarget={id}
        aria-label={`Actions for ${documentFilename(doc)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(
              uiPixels(12),
              Math.min(
                rect.right - uiPixels(190),
                window.innerWidth - uiPixels(202),
              ),
            ),
            top: Math.max(
              uiPixels(12),
              Math.min(
                rect.bottom + uiPixels(6),
                window.innerHeight - uiPixels(200),
              ),
            ),
          });
        }}
      >
        <MoreHorizontal size={20} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label={`Actions for ${documentFilename(doc)}`}
        className="document-action-menu"
        style={position}
        onToggle={(event) => {
          const visible = event.newState === "open";
          setOpen(visible);
          if (visible)
            menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        onKeyDown={(event) => {
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = buttons.indexOf(
            window.document.activeElement as HTMLButtonElement,
          );
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            menu.current?.hidePopover();
            trigger.current?.focus();
          }
        }}
      >
        {["PDF", "TXT"].includes(fileType(doc)) && (
          <button role="menuitem" onClick={() => invoke(onPreview)}>
            <Eye size={16} /> Preview
          </button>
        )}
        <button role="menuitem" onClick={() => invoke(onDetails)}>
          <Info size={16} /> View details
        </button>
        <button role="menuitem" onClick={() => invoke(onDownload)}>
          <Download size={16} /> Download
        </button>
        <button
          role="menuitem"
          className="danger"
          onClick={() => invoke(onDelete)}
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>
    </>
  );
}

export function DocumentsPage() {
  const {
    data,
    setData,
    demo,
    loading,
    error: loadError,
    refresh,
    toast,
  } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [searchOverrides, setSearchOverrides] = useState<
    Record<string, boolean>
  >({});
  const [pages, setPages] = useState<Record<string, number>>({});
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [permissionsFor, setPermissionsFor] =
    useState<KnowledgeDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState<{
    document: KnowledgeDocument;
    url?: string;
    text?: string;
    error?: string;
  } | null>(null);
  const selected = data.documents.find(
    (doc) => doc.id === params.get("document"),
  );
  const departments = allDocumentGroups;
  const positionsFor = (department: string) =>
    positionsForDepartment(
      department,
      data.users
        .filter((user) => sameDepartment(user.department, department))
        .map((user) => user.position),
    );
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return departments
      .map((name) => {
        const documents = data.documents
          .filter((doc) =>
            name === ADMIN_REPLIES
              ? isAdminReply(doc)
              : !isAdminReply(doc) && inDepartment(listDepartmentOf(doc), name),
          )
          .sort(
            (a, b) =>
              (listPositionOf(a) || "").localeCompare(
                listPositionOf(b) || "",
              ) ||
              (Date.parse(documentUpdatedAt(b) || "") || 0) -
                (Date.parse(documentUpdatedAt(a) || "") || 0),
          );
        const matches =
          !query || groupTitle(name).toLowerCase().includes(query)
            ? documents
            : documents.filter((doc) =>
                [
                  documentFilename(doc),
                  doc.document_name,
                  listPositionOf(doc) || "",
                ].some((value) => value.toLowerCase().includes(query)),
              );
        return { name, documents, matches };
      })
      .filter(
        (group) =>
          !query ||
          group.name.toLowerCase().includes(query) ||
          group.matches.length > 0,
      );
  }, [departments, data.documents, search]);
  // Keep older records reachable without inventing a destination department or
  // rewriting their stored metadata. They are not additional department groups.
  const documentsToOrganize = useMemo(
    () =>
      data.documents
        .filter(
          (doc) =>
            !isAdminReply(doc) &&
            !departments.some((name) =>
              inDepartment(listDepartmentOf(doc), name),
            ),
        )
        .sort(
          (a, b) =>
            (Date.parse(documentUpdatedAt(b) || "") || 0) -
            (Date.parse(documentUpdatedAt(a) || "") || 0),
        )
        .filter(
          (doc) =>
            !search.trim() ||
            [doc.department, documentFilename(doc), doc.document_name].some(
              (value) =>
                value?.toLowerCase().includes(search.trim().toLowerCase()),
            ),
        ),
    [data.documents, departments, search],
  );
  const organizePage = Math.min(
    pages.organize || 1,
    Math.max(1, Math.ceil(documentsToOrganize.length / pageSize)),
  );
  const processing = data.documents.some(
    (doc) => doc.processing_status === "processing",
  );
  useEffect(() => {
    if (demo) return;
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    const timer = processing
      ? setInterval(() => {
          if (window.document.visibilityState === "visible") void refresh();
        }, 5000)
      : undefined;
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [demo, processing, refresh]);
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview?.url],
  );
  function uploader(doc: KnowledgeDocument) {
    return (
      data.admins
        .find((admin) => admin.id === doc.uploaded_by)
        ?.display_name?.trim() ||
      doc.uploaded_by_name?.trim() ||
      "Unknown user"
    );
  }
  function changeSearch(value: string) {
    setSearch(value);
    setSearchOverrides({});
    setPages({});
  }
  function openDetails(doc?: KnowledgeDocument) {
    setActionError("");
    router.replace(
      doc ? `/documents?document=${encodeURIComponent(doc.id)}` : "/documents",
      { scroll: false },
    );
  }
  async function originalFile(doc: KnowledgeDocument) {
    if (demo) {
      const file = await readFile(doc.id);
      if (!file)
        throw new Error(
          "This sample has no original file. Upload a file to preview or download it in demo mode.",
        );
      return file;
    }
    const result = await documentRequest({ method: "GET" }, doc.id);
    const response = await fetch(result.url);
    if (!response.ok) throw new Error("Unable to load the original file.");
    const blob = await response.blob();
    return new Blob([blob], {
      type: documentMimeTypes[fileType(doc).toLowerCase()] || blob.type,
    });
  }
  async function download(doc: KnowledgeDocument) {
    if (busy) return;
    setBusy(doc.id);
    setActionError("");
    try {
      const blob = await originalFile(doc);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = documentFilename(doc);
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) {
      const message =
        problem instanceof Error ? problem.message : "Download failed.";
      setActionError(message);
      toast(message, true);
    } finally {
      setBusy(null);
    }
  }
  async function showPreview(doc: KnowledgeDocument) {
    if (busy) return;
    setBusy(doc.id);
    setPreview({ document: doc });
    try {
      const file = await originalFile(doc);
      setPreview(
        fileType(doc) === "TXT"
          ? { document: doc, text: await file.text() }
          : { document: doc, url: URL.createObjectURL(file) },
      );
    } catch (problem) {
      setPreview({
        document: doc,
        error:
          problem instanceof Error ? problem.message : "Preview unavailable.",
      });
    } finally {
      setBusy(null);
    }
  }
  async function reprocess(doc: KnowledgeDocument) {
    if (busy) return;
    setBusy(doc.id);
    setActionError("");
    try {
      if (demo)
        throw new Error(
          "Reprocessing requires the connected knowledge base. Demo mode does not run the RAG workflow.",
        );
      await documentRequest({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id }),
      });
      toast("Document queued for processing.");
    } catch (problem) {
      setActionError(
        problem instanceof Error ? problem.message : "Reprocessing failed.",
      );
    } finally {
      if (!demo) await refresh();
      setBusy(null);
    }
  }
  async function deleteDocument() {
    if (!deleting || busy) return;
    setBusy(deleting.id);
    setActionError("");
    try {
      if (demo) {
        await removeFile(deleting.id);
        setData((previous) => ({
          ...previous,
          documents: previous.documents.filter((doc) => doc.id !== deleting.id),
        }));
        toast("Demo document deleted.");
      } else {
        const result = await documentRequest({
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: deleting.id }),
        });
        toast(
          result.message || "Document removed from the knowledge base.",
          Boolean(result.warning),
        );
        await refresh();
      }
      if (selected?.id === deleting.id) openDetails();
      setDeleting(null);
    } catch (problem) {
      setActionError(
        problem instanceof Error ? problem.message : "Deletion failed.",
      );
    } finally {
      setBusy(null);
    }
  }
  function requestDelete(doc: KnowledgeDocument) {
    setActionError("");
    setDeleting(doc);
  }
  function documentTable(records: KnowledgeDocument[], showDepartment = false) {
    return (
      <div className="table-scroll">
        <table className="data-table department-document-table">
          <thead>
            <tr>
              <th scope="col">Filename</th>
              <th scope="col">Access</th>
              <th scope="col">Type</th>
              <th scope="col">Uploaded by</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <button
                    className="department-file"
                    onClick={() => openDetails(doc)}
                    title={documentFilename(doc)}
                  >
                    <span
                      className={`department-file-icon file-${fileType(doc).toLowerCase()}`}
                    >
                      <FileText size={20} />
                    </span>
                    <span className="department-file-text">
                      <span className="department-filename">
                        {documentFilename(doc)}
                      </span>
                      {showDepartment && (
                        <small>
                          Current department: {doc.department || "Not assigned"}
                        </small>
                      )}
                    </span>
                  </button>
                </td>
                <td>
                  {(() => {
                    const access = accessLabel(doc);
                    const Icon = accessIcons[access.mode];
                    return (
                      <button
                        type="button"
                        className="access-button"
                        disabled={busy !== null}
                        onClick={() => setPermissionsFor(doc)}
                        aria-label={`Permissions for ${documentFilename(doc)}: ${access.title}`}
                        title="Change who can get answers from this document"
                      >
                        <Icon size={15} />
                        <span className="access-button-text">
                          <strong>{access.title}</strong>
                          <small>{departmentTitle(access.detail)}</small>
                        </span>
                        <Pencil size={13} />
                      </button>
                    );
                  })()}
                </td>
                <td>
                  <span className="document-type-badge">{fileType(doc)}</span>
                </td>
                <td>
                  <span className="document-uploader">{uploader(doc)}</span>
                </td>
                <td>
                  <time
                    dateTime={documentUpdatedAt(doc)}
                    className="document-updated"
                  >
                    {formatDate(documentUpdatedAt(doc))}
                  </time>
                </td>
                <td>
                  <DocumentActions
                    document={doc}
                    disabled={busy !== null}
                    onDetails={() => openDetails(doc)}
                    onPreview={() => void showPreview(doc)}
                    onDownload={() => void download(doc)}
                    onDelete={() => requestDelete(doc)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <div className="page-heading documents-heading">
        <div>
          <h1>SOP Documents</h1>
        </div>
        <div className="heading-actions">
          <button
            className="button primary"
            disabled={loading}
            onClick={() => setUploadOpen(true)}
          >
            <UploadCloud size={17} /> Upload file
          </button>
        </div>
      </div>
      <div className="department-search">
        <SearchInput
          value={search}
          onChange={changeSearch}
          placeholder="Search departments or documents..."
        />
      </div>
      {loadError && (
        <div className="document-load-error" role="alert">
          <div>
            <strong>Unable to load documents</strong>
            <p>{loadError}</p>
          </div>
          <button className="button" onClick={() => void refresh()}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      )}
      {loading ? (
        <div
          className="department-list department-loading"
          role="status"
          aria-label="Loading departments and documents"
        >
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="department-skeleton" aria-hidden="true">
              <span />
              <div>
                <span />
                <span />
              </div>
            </div>
          ))}
          <span className="sr-only">Loading departments and documents…</span>
        </div>
      ) : groups.length === 0 &&
        documentsToOrganize.length === 0 &&
        !loadError ? (
        <Card>
          <Empty
            title="No matching departments or documents"
            text="Try another department name or filename."
          />
        </Card>
      ) : (
        <div className="department-list">
          {groups.map((group, index) => {
            const open = search.trim()
              ? (searchOverrides[group.name] ?? true)
              : expanded.has(group.name);
            const Icon = departmentIcon(group.name);
            const panelId = `department-documents-${index}`;
            const currentPage = Math.min(
              pages[group.name] || 1,
              Math.max(1, Math.ceil(group.matches.length / pageSize)),
            );
            return (
              <section
                className={`department-section ${open ? "is-expanded" : ""}`}
                key={group.name}
              >
                <h2>
                  <button
                    className="department-toggle"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => {
                      if (search.trim())
                        setSearchOverrides((previous) => ({
                          ...previous,
                          [group.name]: !open,
                        }));
                      else
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (open) next.delete(group.name);
                          else next.add(group.name);
                          return next;
                        });
                    }}
                  >
                    <span className="department-icon">
                      <Icon size={22} />
                    </span>
                    <span className="department-heading-text">
                      <strong>{groupTitle(group.name)}</strong>
                      <span>
                        {group.documents.length.toLocaleString()}{" "}
                        {group.name === ADMIN_REPLIES
                          ? group.documents.length === 1
                            ? "saved answer"
                            : "saved answers"
                          : group.documents.length === 1
                            ? "document"
                            : "documents"}
                      </span>
                    </span>
                    <ChevronDown className="department-chevron" size={19} />
                  </button>
                </h2>
                <div
                  className="department-panel"
                  id={panelId}
                  role="region"
                  aria-label={`${groupTitle(group.name)} documents`}
                  hidden={!open}
                >
                  {open &&
                    (group.matches.length === 0 ? (
                      <div className="department-empty">
                        <FileText size={28} />
                        <strong>
                          {group.name === ADMIN_REPLIES
                            ? "No admin replies saved yet."
                            : "No documents in this department yet."}
                        </strong>
                        <p>
                          {group.name === ADMIN_REPLIES
                            ? "When you reply to a question the assistant could not answer, keep “Use this answer when the same question is asked again” ticked and the answer appears here."
                            : "Use Upload file above to add documents."}
                        </p>
                      </div>
                    ) : (
                      <>
                        {group.matches.length > pageSize && (
                          <nav
                            className="department-pagination"
                            aria-label={`${groupTitle(group.name)} document pagination`}
                          >
                            <Pagination
                              page={currentPage}
                              total={group.matches.length}
                              pageSize={pageSize}
                              setPage={(value) =>
                                setPages((previous) => ({
                                  ...previous,
                                  [group.name]: value,
                                }))
                              }
                            />
                          </nav>
                        )}
                        {documentTable(
                          group.matches.slice(
                            (currentPage - 1) * pageSize,
                            currentPage * pageSize,
                          ),
                        )}
                      </>
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {!loading && documentsToOrganize.length > 0 && (
        <Card className="legacy-documents-card">
          <div className="card-header">
            <div>
              <h2>Documents to organize</h2>
              <p>
                {documentsToOrganize.length.toLocaleString()}{" "}
                {documentsToOrganize.length === 1
                  ? "document uses"
                  : "documents use"}{" "}
                a previous or unassigned department. Files and original
                department values are unchanged.
              </p>
            </div>
            {!search.trim() && (
              <button
                className="button"
                aria-expanded={organizeOpen}
                aria-controls="documents-to-organize"
                onClick={() => setOrganizeOpen(!organizeOpen)}
              >
                {organizeOpen ? "Hide documents" : "View documents"}
              </button>
            )}
          </div>
          <div
            id="documents-to-organize"
            hidden={!organizeOpen && !search.trim()}
          >
            {(organizeOpen || search.trim()) && (
              <>
                {documentsToOrganize.length > pageSize && (
                  <nav
                    className="department-pagination"
                    aria-label="Documents to organize pagination"
                  >
                    <Pagination
                      page={organizePage}
                      total={documentsToOrganize.length}
                      pageSize={pageSize}
                      setPage={(value) =>
                        setPages((previous) => ({
                          ...previous,
                          organize: value,
                        }))
                      }
                    />
                  </nav>
                )}
                {documentTable(
                  documentsToOrganize.slice(
                    (organizePage - 1) * pageSize,
                    organizePage * pageSize,
                  ),
                  true,
                )}
              </>
            )}
          </div>
        </Card>
      )}
      {permissionsFor && (
        <PermissionsDialog
          key={permissionsFor.id}
          doc={permissionsFor}
          departments={departments}
          positionsFor={positionsFor}
          onClose={() => setPermissionsFor(null)}
        />
      )}
      {uploadOpen && (
        <UploadDocument
          departments={departments}
          positionsFor={positionsFor}
          onClose={() => setUploadOpen(false)}
          onUploaded={(department) => {
            changeSearch("");
            setExpanded((previous) => new Set([...previous, department]));
            setUploadOpen(false);
          }}
        />
      )}
      {preview && (
        <Modal
          title="Document preview"
          wide
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <h3 className="document-preview-title">
            {documentFilename(preview.document)}
          </h3>
          {busy && (
            <p role="status" className="document-processing-note">
              <LoaderCircle size={17} className="spin" /> Loading preview…
            </p>
          )}
          {preview.error && (
            <p role="alert" className="document-error">
              {preview.error}
            </p>
          )}
          {preview.text !== undefined && (
            <pre className="document-text-preview">{preview.text}</pre>
          )}
          {preview.url && (
            <iframe
              className="document-pdf-preview"
              src={preview.url}
              title={`Preview of ${documentFilename(preview.document)}`}
            />
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy !== null}
              onClick={() => setPreview(null)}
            >
              Close
            </button>
            <button
              className="button"
              disabled={busy !== null}
              onClick={() => void download(preview.document)}
            >
              <Download size={16} /> Download
            </button>
          </div>
        </Modal>
      )}
      {selected && !deleting && (
        <Modal title="Document details" wide onClose={() => openDetails()}>
          <div className="document-detail-heading">
            <span className="file-icon">
              <FileText size={22} />
              <small>{fileType(selected)}</small>
            </span>
            <div>
              <h3>{selected.document_name}</h3>
              <p>{documentFilename(selected)}</p>
            </div>
          </div>
          <dl className="document-detail-grid">
            {[
              ["Category", documentCategory(selected.document_type)],
              [
                "Department",
                listDepartmentOf(selected)
                  ? departmentTitle(listDepartmentOf(selected)!)
                  : "Unassigned",
              ],
              ["Position", listPositionOf(selected) || "All positions"],
              [
                "Who can ask",
                isWholeHotel(selected.department)
                  ? "Whole hotel"
                  : selected.position
                    ? `${selected.position} only`
                    : "Whole department",
              ],
              ["File type", fileType(selected)],
              ["File size", fileSize(selected.file_size)],
              ["Uploaded", formatDate(selected.uploaded_at)],
              ["Uploaded by", uploader(selected)],
              ["Updated", formatDate(documentUpdatedAt(selected))],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            className="button"
            onClick={() => {
              setPermissionsFor(selected);
              openDetails();
            }}
          >
            <Lock size={15} />
            Change permissions
          </button>
          {selected.description && (
            <div className="document-notes">
              <h4>Description / notes</h4>
              <p>{selected.description}</p>
            </div>
          )}
          <details className="document-rag-details">
            <summary>Knowledge base details</summary>
            <dl className="document-detail-grid">
              <div>
                <dt>Processing</dt>
                <dd>{selected.processing_status}</dd>
              </div>
              <div>
                <dt>Last processed</dt>
                <dd>{formatDate(selected.last_processed_at)}</dd>
              </div>
              <div>
                <dt>Chunks</dt>
                <dd>
                  {selected.chunks_count?.toLocaleString() ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt>Embeddings</dt>
                <dd>{selected.embeddings_count.toLocaleString()}</dd>
              </div>
              <div className="document-detail-full">
                <dt>Source / document ID</dt>
                <dd>{selected.rag_source_id || selected.id}</dd>
              </div>
            </dl>
            {selected.processing_error && (
              <p className="document-error" role="status">
                {selected.processing_error}
              </p>
            )}
          </details>
          {actionError && (
            <p className="document-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy !== null}
              onClick={() => void download(selected)}
            >
              <Download size={16} /> Download
            </button>
            <button
              className="button"
              disabled={
                busy !== null || selected.processing_status === "processing"
              }
              onClick={() => void reprocess(selected)}
            >
              <RefreshCw size={16} /> Reprocess
            </button>
            <button
              className="button destructive"
              disabled={busy !== null}
              onClick={() => requestDelete(selected)}
            >
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Delete document?"
          onClose={() => {
            if (!busy) {
              setDeleting(null);
              setActionError("");
            }
          }}
        >
          <p className="modal-description">
            This will remove the document from the AI knowledge base and may
            affect answers that depend on this source.
          </p>
          <p className="document-delete-name">{documentFilename(deleting)}</p>
          {actionError && (
            <p className="document-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy !== null}
              onClick={() => {
                setDeleting(null);
                setActionError("");
              }}
            >
              Cancel
            </button>
            <button
              className="button destructive"
              disabled={busy !== null}
              onClick={() => void deleteDocument()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {busy ? "Deleting…" : "Delete document"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function UploadDocument({
  departments,
  positionsFor,
  onClose,
  onUploaded,
}: {
  departments: string[];
  positionsFor: (department: string) => string[];
  onClose: () => void;
  onUploaded: (department: string) => void;
}) {
  const { demo, admin, setData, refresh, toast } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const departmentInput = useRef<HTMLSelectElement>(null);
  const submitting = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<AccessScope>(emptyScope);
  const { department, position, list_department, list_position } =
    scopeToFields(scope);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    if (files.length !== 1) {
      setError("Upload one document at a time.");
      return;
    }
    const problem = validateDocumentFile(files[0]);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(files[0]);
    setError("");
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !scopeReady(scope) || submitting.current) return;
    submitting.current = true;
    setUploading(true);
    setProgress(null);
    setError("");
    try {
      if (demo) {
        const id = crypto.randomUUID();
        await storeFile(id, file);
        const timestamp = new Date().toISOString();
        const doc: KnowledgeDocument = {
          id,
          document_name: file.name,
          original_filename: file.name,
          document_type: "Other",
          department,
          position: position || null,
          list_department: list_department || null,
          list_position: list_position || null,
          description: "",
          file_type: file.name.split(".").pop()?.toLowerCase(),
          file_url: "",
          file_size: file.size,
          uploaded_at: timestamp,
          updated_at: timestamp,
          uploaded_by: admin.id,
          uploaded_by_name: admin.display_name,
          processing_status: "failed",
          processing_error:
            "Demo upload saved locally. Connect the knowledge base to process this document for AI answers.",
          embeddings_count: 0,
          chunks_count: 0,
        };
        setData((previous) => ({
          ...previous,
          documents: [doc, ...previous.documents],
        }));
        toast(
          "Demo file saved locally. AI processing requires a connected workspace.",
        );
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("title", "");
        form.append("document_type", "Other");
        form.append("department", department);
        form.append("position", position);
        form.append("list_department", list_department ?? "");
        form.append("list_position", list_position ?? "");
        form.append("description", "");
        const result = await uploadWithProgress(form, setProgress);
        await refresh();
        toast(
          result.message || "Document uploaded.",
          result.processing_status === "failed",
        );
      }
      // Open the list the document now appears in.
      onUploaded(list_department || department);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Upload failed. Please try again.",
      );
    } finally {
      submitting.current = false;
      setUploading(false);
    }
  }
  return (
    <Modal
      title="Upload document"
      wide
      initialFocusRef={departmentInput}
      onClose={() => {
        if (!submitting.current) onClose();
      }}
    >
      <form className="department-upload-form" onSubmit={upload}>
        <p className="modal-description">
          Choose who can ask about this document, then upload it for the AI
          assistant.
        </p>
        <fieldset disabled={uploading} className="document-upload-fields">
          <AccessPicker
            scope={scope}
            onChange={setScope}
            departments={departments}
            positionsFor={positionsFor}
            departmentRef={departmentInput}
          />
          <input
            ref={input}
            type="file"
            accept={documentFileAccept}
            aria-label="Document file"
            className="document-file-input"
            onChange={(event) => {
              selectFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div
            className={`upload-zone document-upload-zone ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!submitting.current) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!submitting.current) selectFiles(event.dataTransfer.files);
            }}
          >
            <span className="department-upload-icon">
              <UploadCloud size={29} />
            </span>
            <strong>Drag and drop your file here</strong>
            <span>TXT recommended</span>
            <span>
              PDF and DOCX also supported · Up to{" "}
              {documentMaxFileSize / (1024 * 1024)} MB
            </span>
            <button
              type="button"
              className="button"
              onClick={() => input.current?.click()}
            >
              Browse files
            </button>
            <small>One document per upload</small>
          </div>
          {file && (
            <ul className="selected-document-list" aria-label="Selected files">
              <li>
                <FileText size={22} />
                <div>
                  <strong title={file.name}>{file.name}</strong>
                  <span>{fileSize(file.size)}</span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    setFile(null);
                    setError("");
                  }}
                >
                  <X size={18} />
                </button>
              </li>
            </ul>
          )}
        </fieldset>
        {error && (
          <p className="document-error" role="alert">
            {error}
          </p>
        )}
        {uploading && (
          <div className="document-upload-progress" role="status">
            <span>
              <LoaderCircle size={16} className="spin" />
              {progress === 100
                ? "File transferred. Saving your document…"
                : `Uploading${progress !== null ? ` · ${progress}%` : " your document…"}`}
            </span>
            <progress
              aria-label="Document upload progress"
              max={100}
              value={progress ?? undefined}
            />
          </div>
        )}
        <div className="modal-actions">
          <button
            className="button"
            type="button"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={!file || !scopeReady(scope) || uploading}
          >
            {uploading ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <UploadCloud size={16} />
            )}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
