import { requireMember } from "@/lib/auth/access";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { member, allowed } = await requireMember("/");
  return (
    <div className="site-shell">
      <SiteHeader member={member} isAdmin={allowed.isAdmin} />
      <main className="site-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
