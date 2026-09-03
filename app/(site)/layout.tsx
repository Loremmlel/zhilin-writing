import { requireMember } from "@/lib/auth/access";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { countUnreadNotifications } from "@/db/queries";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { member, allowed } = await requireMember("/");
  let unreadCount = 0;
  try {
    unreadCount = await countUnreadNotifications(member.id);
  } catch {
    // The badge is non-critical; the Notifications route owns its own retry boundary.
  }
  return (
    <div className="site-shell">
      <SiteHeader member={member} isAdmin={allowed.isAdmin} unreadCount={unreadCount} />
      <main className="site-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
