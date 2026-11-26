"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Files,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Avatar } from "./ui";
import { browserClient } from "@/lib/supabase/client";

const navigation = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Users", href: "/users", icon: Users },
  { label: "Questions and Repiles", href: "/chat-logs", icon: MessageSquare },
  { label: "SOP Documents", href: "/documents", icon: Files },
  { label: "Chat Images", href: "/chat-images", icon: ImageIcon },
];
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon" aria-hidden="true">
        B
      </span>
      <span>
        Bayview<span className="brand-ai">Automation</span>
        <small>KNOWLEDGE, CONNECTED.</small>
      </span>
    </div>
  );
}
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, demo, admin, loading, error, refresh } = useWorkspace();
  const [sidebar, setSidebar] = useState(false);
  const [profile, setProfile] = useState(false);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProfile(false);
        setSidebar(false);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  const current = pathname.startsWith("/users/")
    ? "User details"
    : [...navigation, { label: "Settings", href: "/settings" }].find(
        (n) => n.href === pathname,
      )?.label || "Overview";
  async function logout() {
    const client = browserClient();
    if (client) await client.auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          aria-label="Close navigation"
          className="sidebar-overlay"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "is-open" : ""}`}>
        <Link href="/" className="brand-link">
          <Brand />
        </Link>
        <div className="workspace-switch">
          <span className="workspace-monogram">B</span>
          <span>
            <strong>Bayview Hotel</strong>
            <small>Admin workspace</small>
          </span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation.map((n) => (
            <Link
              key={n.href}
              className={`nav-item ${(n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)) ? "active" : ""}`}
              href={n.href}
              onClick={() => setSidebar(false)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.href === "/chat-logs" && (
                <span className="nav-count">
                  {loading ? "—" : data.chats.length.toLocaleString("en-US")}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="nav-divider" />
        <p className="nav-label">MANAGEMENT</p>
        <Link
          href="/settings"
          className={`nav-item ${pathname === "/settings" ? "active" : ""}`}
          onClick={() => setSidebar(false)}
        >
          <Settings size={19} />
          Settings
        </Link>
        <div className="sidebar-bottom">
          <div className="sidebar-health">
            <span className="live-dot" />
            <span>{demo ? "Demo workspace" : "Connected workspace"}</span>
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebar(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current}</strong>
          </div>
          <div className="topbar-actions">
            <div className="profile-wrap">
              <button
                className="profile-button"
                onClick={() => {
                  setProfile(!profile);
                }}
                aria-label="Admin profile menu"
              >
                <Avatar name={admin.display_name} />
                <span>
                  <strong>{admin.display_name}</strong>
                  <small>
                    {admin.role === "admin"
                      ? "Administrator"
                      : admin.role === "head"
                        ? "Department head"
                        : admin.role.toUpperCase()}
                  </small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profile && (
                <>
                  <button
                    className="dropdown-dismiss"
                    aria-label="Close profile menu"
                    onClick={() => setProfile(false)}
                  />
                  <div className="profile-menu">
                    <small>{admin.email}</small>
                    <Link href="/settings" onClick={() => setProfile(false)}>
                      <Settings size={16} /> Account settings
                    </Link>
                    <button onClick={logout}>
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">
          {error && !["/documents", "/users", "/chat-images"].includes(pathname) ? (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="button small" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : null}
          {loading && !["/documents", "/users", "/chat-images"].includes(pathname) ? (
            <div className="loading-page">
              <span className="loading-spinner" />
              <p>Getting your workspace ready…</p>
            </div>
          ) : (
            children
          )}
        </main>
        <footer className="footer">
          <span>
            © {new Date().getFullYear()} Bayview Hotel · Internal knowledge
            assistant
          </span>
          <span>
            <ShieldCheck size={13} />
            {demo ? "Preview with sample data" : "Secure admin workspace"}
            <span className="footer-dot">·</span>Powered by Gemini
          </span>
        </footer>
      </div>
    </div>
  );
}
