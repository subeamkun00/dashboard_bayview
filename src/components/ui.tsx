"use client";
import { useEffect, useId, useRef } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Inbox,
  ArrowUpRight,
} from "lucide-react";
import { initials } from "@/lib/utils";
export function Avatar({
  name,
  size = "",
  image,
}: {
  name: string;
  size?: string;
  image?: string | null;
}) {
  const palette = ["sage", "peach", "lavender", "blue", "rose"];
  const color = palette[name.charCodeAt(0) % palette.length];
  return (
    <span className={`avatar ${color} ${size}`}>
      {image ? (
        <Image
          src={image}
          alt={name}
          referrerPolicy="no-referrer"
          width={70}
          height={70}
          unoptimized
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
export function Badge({
  children,
  variant = "green",
}: {
  children: React.ReactNode;
  variant?: string;
}) {
  return (
    <span className={`badge ${variant}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="search-input">
      <Search size={16} />
      <input
        aria-label={label || placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}
export function Empty({
  title = "No results found",
  text = "Try adjusting your search or filters.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Pagination({
  page,
  setPage,
  total,
  pageSize = 8,
}: {
  page: number;
  setPage: (n: number) => void;
  total: number;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        Showing{" "}
        <strong>
          {total ? (page - 1) * pageSize + 1 : 0}–
          {Math.min(page * pageSize, total)}
        </strong>{" "}
        of <strong>{total.toLocaleString()}</strong> results
      </span>
      <div>
        <button
          className="button small"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={15} /> Previous
        </button>
        <span className="page-number">
          {page} / {pages}
        </span>
        <button
          className="button small"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  initialFocusRef,
  className = "",
  subtitle,
  closeDisabled = false,
  trapFocus = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  subtitle?: string;
  closeDisabled?: boolean;
  trapFocus?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog?.showModal();
    initialFocusRef?.current?.focus();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [initialFocusRef]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${className}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onKeyDown={(event) => {
        if (!trapFocus || event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, [tabindex]",
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && (
            <p className="modal-subtitle" id={subtitleId}>
              {subtitle}
            </p>
          )}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
          disabled={closeDisabled}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
export function Trend({
  value,
  label = "vs. previous period",
}: {
  value: string;
  label?: string;
}) {
  return (
    <span className="trend">
      <span>
        <ArrowUpRight size={13} />
        {value}
      </span>
      <span>{label}</span>
    </span>
  );
}
