import { notFound } from "next/navigation";
import { DashboardPage } from "@/components/dashboard-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ page?: string[] }>;
}) {
  const { page = [] } = await params;
  if (
    page.length > 2 ||
    (page.length === 2 && page[0] !== "users") ||
    (page[0] &&
      !["users", "chat-logs", "documents", "chat-images", "settings"].includes(page[0]))
  )
    notFound();
  return <DashboardPage page={page[0] || "overview"} userId={page[1]} />;
}
