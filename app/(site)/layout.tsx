import { requireMember } from "@/lib/auth/access";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { countUnreadNotifications } from "@/db/queries";
import { isHaojieEnabled } from "@/lib/haojie/runtime";
import { canAccessWriting } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { member, allowed } = await requireMember("/");
  const writingEnabled = canAccessWriting(allowed);
  let unreadCount = 0;
  try {
    if (writingEnabled) unreadCount = await countUnreadNotifications(member.id);
  } catch {
    // The badge is non-critical; the Notifications route owns its own retry boundary.
  }
  return (
    <div className="site-shell">
      <SiteHeader
        member={member}
        isAdmin={allowed.isAdmin}
        unreadCount={unreadCount}
        haojieEnabled={isHaojieEnabled()}
        writingEnabled={writingEnabled}
      />
      <main className="site-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
