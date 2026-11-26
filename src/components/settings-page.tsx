"use client";
import { useState } from "react";
import { LockKeyhole, Save, UserRound } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Avatar, Badge, Card, CardHeader } from "./ui";
import { PageHeading, SystemStatus } from "./dashboard-pages";
export function SettingsPage() {
  const { admin, demo, setData, refresh, toast } = useWorkspace();
  const [tab, setTab] = useState("Profile");
  const [name, setName] = useState(admin.display_name);
  const [saving, setSaving] = useState(false);
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (demo) {
        const next = { ...admin, display_name: name.trim() };
        localStorage.setItem("bayview-demo-profile", JSON.stringify(next));
        setData((d) => ({
          ...d,
          admins: d.admins.map((a) => (a.id === admin.id ? next : a)),
        }));
      } else {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "profile",
            display_name: name.trim(),
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        await refresh();
      }
      toast("Your profile has been updated.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save profile.", true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOUR WORKSPACE"
        title="Settings"
        subtitle="Manage your account and connected services."
      />
      <div className="settings-tabs">
        {[
          { title: "Profile", icon: UserRound },
          { title: "Connections", icon: LockKeyhole },
        ].map((t) => (
          <button
            className={tab === t.title ? "active" : ""}
            key={t.title}
            onClick={() => setTab(t.title)}
          >
            <t.icon size={16} />
            {t.title}
          </button>
        ))}
      </div>
      {tab === "Profile" && (
        <div className="settings-profile">
          <Card>
            <CardHeader
              title="Admin profile"
              subtitle="Your details in the Bayview workspace"
            />
            <form className="settings-form" onSubmit={saveProfile}>
              <div className="profile-edit">
                <Avatar name={name || admin.display_name} size="large-avatar" />
                <div>
                  <h3>{admin.display_name}</h3>
                  <Badge>
                    {admin.role === "admin"
                      ? "Administrator"
                      : admin.role === "head"
                        ? "Department head"
                        : admin.role.toUpperCase()}
                  </Badge>
                </div>
              </div>
              <label className="field">
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                Email address
                <input value={admin.email} disabled type="email" />
                <small>Your login email is managed by your organization.</small>
              </label>
              <div className="form-footer">
                <button className="button primary" disabled={saving}>
                  <Save size={16} />
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {tab === "Connections" && (
        <div className="settings-grid">
          <SystemStatus full />
          <div className="settings-aside">
            <span className="feature-icon blue">
              <LockKeyhole size={25} />
            </span>
            <h3>Connected behind the scenes.</h3>
            <p>
              LINE sends questions to n8n. Gemini retrieves relevant knowledge
              and generates a response, while Supabase securely stores activity
              and documents.
            </p>
            <div className="flow-chips">
              <span>LINE OA</span>
              <span>→</span>
              <span>n8n</span>
              <span>→</span>
              <span>Gemini + RAG</span>
              <span>→</span>
              <span>Supabase</span>
            </div>
            <p className="muted">
              Connection credentials are configured securely in your server
              environment. Use the refresh control to check current
              availability.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
