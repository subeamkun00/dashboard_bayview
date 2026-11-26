"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Database,
  FileText,
  Filter,
  MessageCircle,
  Network,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  Empty,
  Modal,
  Pagination,
  SearchInput,
} from "./ui";
import { QuestionsChart } from "./charts";
import { chartData, date, downloadCsv, number, rangeStart } from "@/lib/utils";
import type { Chat, Connection, Employee } from "@/lib/types";
import { SettingsPage } from "./settings-page";
import { FormattedMessage } from "./formatted-message";
import { DocumentsPage } from "./documents-page";
import { ChatImagesPage } from "./chat-images-page";
import { ReplyThread } from "./reply-thread";
import { UsersPage } from "./users-page";
import { assistantAccess, employeeDepartment } from "@/lib/users";
import { answerAccuracy } from "@/lib/answer-accuracy";
import { catalogDepartments, sameDepartment } from "@/lib/organization";

export function DashboardPage({
  page,
  userId,
}: {
  page: string;
  userId?: string;
}) {
  if (page === "users")
    return userId ? <UserDetail userId={userId} /> : <UsersPage />;
  if (page === "chat-logs") return <ChatLogsPage />;
  if (page === "documents") return <DocumentsPage />;
  if (page === "chat-images") return <ChatImagesPage />;
  if (page === "settings") return <SettingsPage />;
  return <OverviewPage />;
}
export function PageHeading({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

function formatDateFilterValue(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function normalizeDateFilterText(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  return [day, month, year].filter(Boolean).join("/");
}

function parseDateFilterValue(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return "";
  const [, day, month, year] = match;
  const candidate = new Date(`${year}-${month}-${day}T00:00:00`);
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== Number(year) ||
    candidate.getMonth() + 1 !== Number(month) ||
    candidate.getDate() !== Number(day)
  )
    return "";
  return `${year}-${month}-${day}`;
}

export function DateRange({
  days,
  setDays,
}: {
  days: number;
  setDays: (d: number) => void;
}) {
  return (
    <label className="date-range">
      <CalendarDays size={16} />
      <select
        aria-label="Date range"
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      >
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={60}>Last 60 days</option>
      </select>
      <ChevronDown size={14} />
    </label>
  );
}
function StatsCards({ days }: { days: number }) {
  const { data, now, loading } = useWorkspace();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const chatsToday = data.chats.filter((chat) => {
    const createdAt = new Date(chat.created_at).getTime();
    return createdAt >= today.getTime() && createdAt <= now;
  });
  const questionsToday = chatsToday.length;
  const accuracy = answerAccuracy(data.chats, days, now);
  const cards = [
    {
      title: "Total users",
      value: data.users.length,
    },
    {
      title: "Total questions",
      value: data.chats.length,
    },
    {
      title: "Questions today",
      value: questionsToday,
    },
  ];
  return (
    <div className="stats-grid">
      {cards.map((c) => (
        <Card key={c.title} className="stat-card">
          <div className="stat-top">
            <span>{c.title}</span>
          </div>
          <div className="stat-middle">
            <strong>{number(c.value)}</strong>
          </div>
        </Card>
      ))}
      <Card className="stat-card accuracy-card">
        <div className="stat-top">
          <span title="Success ÷ (Success + Fallback) × 100. Failed and admin replies are excluded.">
            Accuracy
          </span>
        </div>
        <div className="stat-middle" aria-live="polite" aria-atomic="true">
          <strong>
            {loading || accuracy.percentage === null
              ? "—"
              : `${accuracy.percentage.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}
          </strong>
        </div>
        <div className="accuracy-summary">
          <span>Last {days} days</span>
          <span>
            {loading
              ? "Loading…"
              : accuracy.total
                ? `${number(accuracy.success)} Success · ${number(accuracy.fallback)} Fallback`
                : "No Success or Fallback questions"}
          </span>
        </div>
      </Card>
    </div>
  );
}
export function SystemStatus({ full = false }: { full?: boolean }) {
  const { demo } = useWorkspace();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      if (demo)
        setConnections([
          { name: "LINE OA", status: "online", detail: "Messaging channel" },
          {
            name: "n8n Workflow",
            status: "online",
            detail: "Automation engine",
          },
          {
            name: "Gemini AI",
            status: "online",
            detail: "Intelligence & retrieval",
          },
          {
            name: "Supabase",
            status: "online",
            detail: "Database & authentication",
          },
        ]);
      else {
        const res = await fetch("/api/health");
        if (!res.ok) throw new Error();
        setConnections(await res.json());
      }
    } catch {
      setConnections(
        ["LINE OA", "n8n Workflow", "Gemini AI", "Supabase"].map((name) => ({
          name,
          status: "offline",
          detail: "Status check unavailable",
        })),
      );
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void check(); /* Recheck when the workspace mode changes. */
  }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps
  const icons = [MessageCircle, Network, Sparkles, Database];
  return (
    <Card className={`system-card ${full ? "full-system" : ""}`}>
      <CardHeader
        title="System status"
        action={
          <button
            className="icon-button"
            aria-label="Refresh system status"
            onClick={check}
            disabled={checking}
          >
            <RefreshCw className={checking ? "spin" : undefined} size={18} />
          </button>
        }
      />
      <div className="connection-list">
        {(connections.length
          ? connections
          : ["LINE OA", "n8n Workflow", "Gemini AI", "Supabase"].map(
              (name) => ({
                name,
                status: "unconfigured",
                detail: "Checking connection…",
              }),
            )
        ).map((c, i) => {
          const Icon = icons[i];
          return (
            <div className="connection" key={c.name}>
              <span className={`connection-icon connection-${i}`}>
                <Icon size={21} />
              </span>
              <div>
                <strong>{c.name}</strong>
                <small>{c.detail}</small>
              </div>
              <Badge
                variant={
                  c.status === "online"
                    ? "green"
                    : c.status === "offline"
                      ? "red"
                      : "neutral"
                }
              >
                {checking
                  ? "Checking"
                  : c.status === "online"
                    ? "Online"
                    : c.status === "offline"
                      ? "Offline"
                      : "Not set"}
              </Badge>
            </div>
          );
        })}
      </div>
      <div className="system-foot">
        <span
          className={
            connections.every((c) => c.status === "online") &&
            connections.length
              ? "live-dot"
              : "muted-dot"
          }
        />
        <span>
          {demo
            ? "All systems operational · demo"
            : connections.length &&
                connections.every((c) => c.status === "online")
              ? "All systems operational"
              : "Connection checks complete"}
        </span>
        <span className="system-pulse">
          <Activity size={14} />
        </span>
      </div>
    </Card>
  );
}
function QuestionsPanel({
  days,
  big = false,
}: {
  days: number;
  big?: boolean;
}) {
  const { data, now } = useWorkspace();
  const [period, setPeriod] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const values = useMemo(
    () => chartData(data.chats, period, days, now),
    [data.chats, period, days, now],
  );
  const total = values.reduce((sum, d) => sum + d.questions, 0);
  const summary =
    period === "Daily"
      ? `questions in the last ${days} days`
      : period === "Weekly"
        ? `questions in the last ${values.length} week${values.length === 1 ? "" : "s"}`
        : values.length === 1
          ? "questions this month"
          : `questions in the last ${values.length} months`;
  return (
    <Card className={`questions-panel ${big ? "large-panel" : ""}`}>
      <CardHeader
        title="Questions over time"
        action={
          <div className="segmented" role="group" aria-label="Chart period">
            {(["Daily", "Weekly", "Monthly"] as const).map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPeriod(p)}
                className={period === p ? "selected" : ""}
                aria-pressed={period === p}
              >
                {p}
              </button>
            ))}
          </div>
        }
      />
      <div className="chart-summary" aria-live="polite">
        <strong>{number(total)}</strong>
        <span>{summary}</span>
      </div>
      <QuestionsChart data={values} period={period} />
    </Card>
  );
}
function DepartmentQuestions({ days }: { days: number }) {
  const { data, now } = useWorkspace();
  const departments = useMemo(() => {
    const departmentByUser = new Map(
      data.users.map((user) => [
        user.id,
        user.department.trim() || "Unassigned",
      ]),
    );
    const totals = new Map<string, { questions: number; users: Set<string> }>();

    data.chats
      .filter((chat) => {
        const createdAt = new Date(chat.created_at).getTime();
        return createdAt >= rangeStart(days, now) && createdAt <= now;
      })
      .forEach((chat) => {
        const department = departmentByUser.get(chat.user_id) || "Unassigned";
        const current = totals.get(department) || {
          questions: 0,
          users: new Set<string>(),
        };
        current.questions += 1;
        current.users.add(chat.user_id);
        totals.set(department, current);
      });

    return [...totals.entries()]
      .map(([department, total]) => ({
        department,
        questions: total.questions,
        users: total.users.size,
      }))
      .sort((a, b) => b.questions - a.questions)
      .slice(0, 4);
  }, [data.chats, data.users, days, now]);
  const maximum = departments[0]?.questions || 1;

  return (
    <Card className="department-questions">
      <CardHeader
        title="Most department questions"
        action={
          <Link href="/users" className="text-link">
            View users <ArrowUpRight size={14} />
          </Link>
        }
      />
      <div className="department-question-list">
        {departments.map((department, index) => (
          <div className="department-question" key={department.department}>
            <span className="department-rank">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="department-question-name">
              <strong>{department.department}</strong>
              <small>
                {number(department.users)} team member
                {department.users === 1 ? "" : "s"} asked
              </small>
              <span className="department-question-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${(department.questions / maximum) * 100}%`,
                  }}
                />
              </span>
            </span>
            <span className="department-question-count">
              <strong>{number(department.questions)}</strong>
              <small>questions</small>
            </span>
          </div>
        ))}
        {!departments.length && (
          <Empty
            title="No department activity yet"
            text="Department question totals will appear here."
          />
        )}
      </div>
    </Card>
  );
}
const topUserPeriods = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
] as const;

function ActiveUsers() {
  const { data, now } = useWorkspace();
  const [periodDays, setPeriodDays] = useState<1 | 7 | 30>(7);
  const counts = useMemo(() => {
    const totals = new Map<string, number>();
    const today = new Map<string, number>();
    const periodStart = rangeStart(periodDays, now);
    const todayStart = rangeStart(1, now);

    data.chats.forEach((chat) => {
      const createdAt = new Date(chat.created_at).getTime();
      if (createdAt > now) return;
      if (createdAt >= periodStart)
        totals.set(chat.user_id, (totals.get(chat.user_id) || 0) + 1);
      if (createdAt >= todayStart)
        today.set(chat.user_id, (today.get(chat.user_id) || 0) + 1);
    });

    return data.users
      .map((user) => ({
        ...user,
        questionCount: totals.get(user.id) || 0,
        todayCount: today.get(user.id) || 0,
      }))
      .filter((user) => user.questionCount > 0)
      .sort(
        (a, b) =>
          b.questionCount - a.questionCount ||
          b.todayCount - a.todayCount ||
          a.display_name.localeCompare(b.display_name),
      )
      .slice(0, 4);
  }, [data.chats, data.users, now, periodDays]);
  return (
    <Card className="top-users">
      <CardHeader
        title="Top users by questions"
        action={
          <div className="top-users-header-actions">
            <div
              className="segmented top-users-period"
              role="group"
              aria-label="Top users period"
            >
              {topUserPeriods.map((period) => (
                <button
                  type="button"
                  key={period.days}
                  className={periodDays === period.days ? "selected" : ""}
                  aria-pressed={periodDays === period.days}
                  onClick={() => setPeriodDays(period.days)}
                >
                  {period.label}
                </button>
              ))}
            </div>
            <Link href="/users" className="text-link">
              View all <ArrowUpRight size={14} />
            </Link>
          </div>
        }
      />
      <div className="top-users-list" aria-live="polite">
        {counts.map((user, index) => (
          <Link className="top-user" key={user.id} href={`/users/${user.id}`}>
            <span className="top-user-rank" aria-label={`Rank ${index + 1}`}>
              {index + 1}
            </span>
            <Avatar name={user.display_name} image={user.profile_image_url} />
            <span className="top-user-name">
              <strong>{user.display_name}</strong>
              <small className="top-user-department">
                {user.department || "Team member"}
              </small>
            </span>
            <span className="top-user-metric">
              <span className="top-user-total">
                <strong>{number(user.questionCount)}</strong>
                <span>questions</span>
              </span>
              <small>
                {periodDays === 1
                  ? "Today"
                  : `${number(user.todayCount)} today`}
              </small>
            </span>
          </Link>
        ))}
        {!counts.length && (
          <Empty
            title="No questions in this period"
            text="Choose a longer period to see the most active users."
          />
        )}
      </div>
    </Card>
  );
}
function OverviewPage() {
  const { data, demo, toast, now } = useWorkspace();
  const [days, setDays] = useState(30);
  return (
    <>
      <PageHeading
        eyebrow="YOUR DASHBOARD"
        title="AI Workflow Automation"
        subtitle=""
        actions={
          <>
            <DateRange days={days} setDays={setDays} />
            <button
              className="button"
              onClick={() => {
                const since = rangeStart(days, now);
                downloadCsv(
                  data.chats
                    .filter((c) => new Date(c.created_at).getTime() >= since)
                    .map((c) => ({
                      date: c.created_at,
                      user:
                        data.users.find((u) => u.id === c.user_id)
                          ?.display_name || c.user_id,
                      question: c.question,
                      response: c.ai_response,
                      status: c.response_status,
                    })),
                  "bayview-activity-report.csv",
                );
                toast("Your activity report has been exported.");
              }}
            >
              <ArrowDownToLine size={16} />
              Export report
            </button>
          </>
        }
      />
      <StatsCards days={days} />
      <div className="overview-main-grid">
        <QuestionsPanel days={days} />
        <SystemStatus />
      </div>
      <div className="overview-secondary-grid overview-department-grid">
        <ActiveUsers />
        <DepartmentQuestions days={days} />
      </div>
      <Card className="recent-card">
        <CardHeader
          title="Recent conversations"
          action={
            <Link className="text-link" href="/chat-logs">
              View all conversations <ArrowRight size={15} />
            </Link>
          }
        />
        <ConversationTable chats={data.chats.slice(0, 5)} compact />
        <div className="table-foot">
          <span>
            <span className="live-dot" />
            {demo
              ? "Sample conversations from your team"
              : "Activity updates automatically"}
          </span>
          <span>Showing the latest 5 conversations</span>
        </div>
      </Card>
    </>
  );
}

function statusMeta(status: Chat["response_status"]) {
  switch (status) {
    case "success":
      return { variant: "green", label: "Success", detail: "Answered" };
    case "fallback":
      return { variant: "amber", label: "Fallback", detail: "Needs a reply" };
    case "replied":
      return {
        variant: "purple",
        label: "Replied",
        detail: "Replied by admin",
      };
    default:
      return { variant: "red", label: "Failed", detail: "Failed" };
  }
}

export function ConversationTable({
  chats,
  compact = false,
}: {
  chats: Chat[];
  compact?: boolean;
}) {
  const { data } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Look the chat up live so a saved reply shows up immediately after refresh.
  const selected = data.chats.find((c) => c.id === selectedId) || null;
  return (
    <>
      <div className="table-scroll">
        <table
          className={`data-table conversation-table ${compact ? "compact-table" : ""}`}
        >
          <thead>
            <tr>
              <th>User</th>
              <th>Question {!compact && "& AI response"}</th>
              <th>Date & time</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {chats.map((c) => {
              const user = data.users.find((u) => u.id === c.user_id);
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/users/${c.user_id}`} className="table-user">
                      <Avatar
                        name={user?.display_name || "Team member"}
                        image={user?.profile_image_url}
                        size="small-avatar"
                      />
                      <span>
                        <strong>{user?.display_name || "Team member"}</strong>
                        {!compact && <small>{user?.department}</small>}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <button
                      className="question-cell"
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span>
                        {c.category && c.category !== "General"
                          ? `[${c.category}] `
                          : ""}
                        {c.question}
                      </span>
                      {!compact && <small>{c.ai_response}</small>}
                    </button>
                  </td>
                  <td>
                    <span className="date-cell">
                      {date(c.created_at, true)}
                    </span>
                  </td>
                  <td>
                    <Badge variant={statusMeta(c.response_status).variant}>
                      {statusMeta(c.response_status).label}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="conversation-details-button"
                      aria-label={`View conversation: ${c.question}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span>View Details</span>
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!chats.length && <Empty />}
      {selected && (
        <Modal
          title="Conversation details"
          onClose={() => setSelectedId(null)}
          wide
        >
          <Conversation
            chat={selected}
            user={data.users.find((u) => u.id === selected.user_id)}
            showSource={false}
          />
        </Modal>
      )}
    </>
  );
}
function Conversation({
  chat,
  user,
  showSource = true,
}: {
  chat: Chat;
  user?: Employee;
  showSource?: boolean;
}) {
  return (
    <div className="conversation">
      <div className="chat-date">
        {date(chat.created_at, true)}
        <Badge variant={statusMeta(chat.response_status).variant}>
          {statusMeta(chat.response_status).detail}
        </Badge>
      </div>
      <div className="chat-message user-message">
        <Avatar
          name={user?.display_name || "Team member"}
          image={user?.profile_image_url}
        />
        <div>
          <strong>{user?.display_name || "Team member"}</strong>
          <p>{chat.question}</p>
        </div>
      </div>
      {/* "ติดต่อแอดมิน" chats are admin conversations; the assistant says nothing. */}
      {chat.ai_response.trim() && (
        <div className="chat-message ai-message">
          <span className="ai-avatar">
            <Sparkles size={18} />
          </span>
          <div>
            <strong>
              Bayview Assistant <span>AI</span>
            </strong>
            <FormattedMessage>{chat.ai_response}</FormattedMessage>
            {showSource && chat.source_document && (
              <div className="chat-source-row">
                <span>แหล่งข้อมูล</span>
                <span className="chat-source">
                  <FileText size={13} />
                  {chat.source_document}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      <ReplyThread chat={chat} user={user} />
    </div>
  );
}
function UserDetail({ userId }: { userId: string }) {
  const { data, toast } = useWorkspace();
  const user = data.users.find((u) => u.id === userId);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  if (!user)
    return (
      <>
        <Link className="text-link" href="/users">
          <ArrowLeft size={15} />
          Back to users
        </Link>
        <Empty
          title="User not found"
          text="This user may no longer be available in your workspace."
        />
      </>
    );
  const all = data.chats.filter((c) => c.user_id === userId);
  const chats = all.filter((c) =>
    `${c.question} ${c.ai_response}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <Link className="back-link" href="/users">
        <ArrowLeft size={15} />
        Back to users
      </Link>
      <PageHeading
        title="User details"
        subtitle="A closer look at your team member’s assistant activity."
        actions={
          <button
            className="button"
            onClick={() => {
              downloadCsv(
                all.map((c) => ({ ...c })),
                `bayview-${user.display_name}-history.csv`,
              );
              toast(
                all.length
                  ? "Conversation history exported."
                  : "No conversations to export.",
              );
            }}
          >
            <ArrowDownToLine size={16} />
            Export history
          </button>
        }
      />
      <Card className="user-profile-card">
        <Avatar
          name={user.display_name}
          image={user.profile_image_url}
          size="large-avatar"
        />
        <div className="user-profile-info">
          <h2>
            {user.display_name}{" "}
            <Badge variant={assistantAccess(user) ? "green" : "neutral"}>
              {assistantAccess(user) ? "Enabled" : "Disabled"}
            </Badge>
          </h2>
          <p>{employeeDepartment(user) || "Not assigned"}</p>
        </div>
        <div className="user-profile-stat">
          <span>Nickname</span>
          <strong>{user.nickname?.trim() || "—"}</strong>
        </div>
        <div className="user-profile-stat">
          <span>Position</span>
          <strong>{user.position?.trim() || "Not assigned"}</strong>
        </div>
        <div className="user-profile-stat">
          <span>Total questions</span>
          <strong className="big-number">{number(all.length)}</strong>
        </div>
      </Card>
      <Card className="conversation-history">
        <CardHeader
          title="Conversation history"
          subtitle="Questions, answers, and the knowledge behind them"
          action={
            <SearchInput
              value={search}
              onChange={(s) => {
                setSearch(s);
                setPage(1);
              }}
              placeholder="Search history..."
            />
          }
        />
        {chats.slice((page - 1) * 5, page * 5).map((c) => (
          <Conversation key={c.id} chat={c} user={user} />
        ))}
        {!chats.length && <Empty />}
        <Pagination
          page={page}
          setPage={setPage}
          total={chats.length}
          pageSize={5}
        />
      </Card>
    </>
  );
}
function ChatLogsPage() {
  const pageSize = 10;
  const { data, toast } = useWorkspace();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState(params.get("status") || "all");
  const [category, setCategory] = useState("all");
  const [day, setDay] = useState("");
  const [dayText, setDayText] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const waiting = data.chats.filter(
    (c) => c.response_status === "fallback",
  ).length;
  useEffect(() => {
    setSearch(params.get("q") || "");
    setStatus(params.get("status") || "all");
  }, [params]);
  const departmentByUser = useMemo(
    () =>
      new Map(
        data.users.map((user) => [
          user.id,
          user.department.trim() || "Team member",
        ]),
      ),
    [data.users],
  );
  const chats = useMemo(
    () =>
      data.chats
        .filter(
          (c) =>
            `${c.question} ${c.ai_response}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (department === "all" ||
              sameDepartment(departmentByUser.get(c.user_id), department)) &&
            (status === "all" || c.response_status === status) &&
            (category === "all" || (c.category || "General") === category) &&
            (!day ||
              new Date(c.created_at).toLocaleDateString("en-CA") ===
                new Date(`${day}T12:00:00`).toLocaleDateString("en-CA")),
        )
        .sort((a, b) =>
          sort === "newest"
            ? b.created_at.localeCompare(a.created_at)
            : a.created_at.localeCompare(b.created_at),
        ),
    [
      data.chats,
      search,
      department,
      departmentByUser,
      status,
      category,
      day,
      sort,
    ],
  );
  useEffect(
    () => setPage(1),
    [search, department, status, category, day, sort],
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(chats.length / pageSize)),
  );
  return (
    <>
      <PageHeading
        eyebrow="EVERY CONVERSATION COUNTS"
        title="Questions and Repiles"
        subtitle=""
        actions={
          <button
            className="button primary questions-export-button"
            onClick={() => {
              if (!chats.length) {
                toast("No matching conversations to export.", true);
                return;
              }
              downloadCsv(
                chats.map((c) => ({
                  user: data.users.find((u) => u.id === c.user_id)
                    ?.display_name,
                  question: c.question,
                  ai_response: c.ai_response,
                  date: c.created_at,
                  status: c.response_status,
                  admin_reply: c.admin_reply || "",
                  replied_by: c.replied_by_name || "",
                  replied_at: c.replied_at || "",
                })),
                "bayview-chat-logs.csv",
              );
              toast(`${number(chats.length)} conversations exported.`);
            }}
          >
            <ArrowDownToLine size={16} />
            Export CSV
          </button>
        }
      />
      <Card className="questions-list-card">
        <CardHeader
          title={`${number(chats.length)} Questions`}
          action={
            <Badge variant="neutral">
              <MessageCircle size={12} /> LINE Official Account
            </Badge>
          }
        />
        <div className="filter-bar questions-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search questions or responses..."
          />
          <button
            className={`button ${more ? "is-selected" : ""}`}
            aria-expanded={more}
            aria-controls="chat-log-filters"
            onClick={() => setMore(!more)}
          >
            <Filter size={15} />
            Filters
          </button>
          <select
            className="filter-select"
            aria-label="Sort conversations"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          {waiting > 0 && (
            <button
              type="button"
              className="pending-replies-bubble"
              aria-pressed={status === "fallback"}
              aria-label={`${number(waiting)} ${waiting === 1 ? "conversation" : "conversations"} waiting for an admin reply. ${status === "fallback" ? "Hide all; return to all conversations" : "Show all pending conversations"}`}
              title={
                status === "fallback"
                  ? "Hide pending-only view and return to all conversations"
                  : "Show all pending admin replies"
              }
              onClick={() =>
                setStatus(status === "fallback" ? "all" : "fallback")
              }
            >
              <MessageCircle size={17} aria-hidden="true" />
              <span className="pending-replies-summary" role="status">
                <strong>{number(waiting)}</strong>
                <span>Pending admin replies</span>
              </span>
              <span className="pending-replies-reset">
                {status === "fallback" ? "Hide all" : "Show all"}
              </span>
            </button>
          )}
        </div>
        {more && (
          <div id="chat-log-filters" className="filter-bar extra-filters">
            <label>
              Department
              <select
                className="filter-select"
                aria-label="Filter by department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="all">All departments</option>
                {catalogDepartments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                className="filter-select"
                aria-label="Response status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="success">Success</option>
                <option value="fallback">Fallback (needs reply)</option>
                <option value="replied">Replied</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label>
              Type
              <select
                className="filter-select"
                aria-label="Conversation type"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All types</option>
                <option value="General">AI questions</option>
                <option value="Contact">Contact admin</option>
                <option value="SOP Guide">SOP guide</option>
                <option value="Login">Login</option>
              </select>
            </label>
            <label>
              Conversation date
              <span className="date-filter">
                <span className="date-picker-trigger">
                  <CalendarDays size={15} />
                  <input
                    type="date"
                    aria-label="Choose conversation date"
                    value={day}
                    onChange={(e) => {
                      setDay(e.target.value);
                      setDayText(formatDateFilterValue(e.target.value));
                    }}
                  />
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  aria-label="Conversation date"
                  title="Conversation date (dd/mm/yyyy)"
                  placeholder="dd/mm/yyyy"
                  value={dayText}
                  onChange={(e) => {
                    const formatted = normalizeDateFilterText(e.target.value);
                    setDayText(formatted);
                    setDay(parseDateFilterValue(formatted));
                  }}
                />
              </span>
            </label>
            <button
              className="text-link"
              onClick={() => {
                setSearch("");
                setDepartment("all");
                setStatus("all");
                setDay("");
                setDayText("");
              }}
            >
              Reset filters <X size={14} />
            </button>
          </div>
        )}
        <nav className="chat-logs-pagination" aria-label="Chat log pagination">
          <Pagination
            page={currentPage}
            setPage={setPage}
            total={chats.length}
            pageSize={pageSize}
          />
        </nav>
        <ConversationTable
          chats={chats.slice(
            (currentPage - 1) * pageSize,
            currentPage * pageSize,
          )}
        />
        <nav aria-label="Chat log pagination bottom">
          <Pagination
            page={currentPage}
            setPage={setPage}
            total={chats.length}
            pageSize={pageSize}
          />
        </nav>
      </Card>
    </>
  );
}
