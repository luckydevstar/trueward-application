import { requireActor } from "@/lib/actor";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const actor = await requireActor();

  return (
    <DashboardShell
      name={actor.name ?? actor.email}
      email={actor.email}
      role={actor.role}
    >
      {children}
    </DashboardShell>
  );
}
