import { requireMember } from "@/lib/auth/access";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { countUnreadNotifications } from "@/db/queries";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { member, allowed } = await requireMember("/");
  const unreadCount = await countUnreadNotifications(member.id);
  return (
    <div className="site-shell">
      <SiteHeader member={member} isAdmin={allowed.isAdmin} unreadCount={unreadCount} />
      <main className="site-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
