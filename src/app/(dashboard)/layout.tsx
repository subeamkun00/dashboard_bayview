import { redirect } from "next/navigation";
import { authorized, isConfigured } from "@/lib/supabase/server";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { DashboardShell } from "@/components/dashboard-shell";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = isConfigured ? await authorized() : null;
  if (isConfigured && !session) redirect("/login");
  return (
    <WorkspaceProvider admin={session?.admin}>
      <DashboardShell>{children}</DashboardShell>
    </WorkspaceProvider>
  );
}
