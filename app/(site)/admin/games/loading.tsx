import { AdminShell } from "@/components/admin/admin-shell";
import { AdminListSkeleton } from "@/components/loading/skeletons";
export default function Loading() {
  return (
    <AdminShell active="games">
      <AdminListSkeleton />
    </AdminShell>
  );
}
