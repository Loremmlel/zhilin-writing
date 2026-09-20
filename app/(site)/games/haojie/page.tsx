import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { getHaojieDb, isHaojieEnabled } from "@/lib/haojie/runtime";
import { listRooms } from "@/lib/haojie/service";
import { HAOJIE_PATH, roomModeLabel, roomStatusLabel } from "@/lib/haojie/contracts";
import { parsePage, pageHref } from "@/lib/pagination";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { CreateRoom } from "@/components/haojie/create-room";

export const metadata = { title: "浩劫 2" };
export default async function HaojiePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isHaojieEnabled()) notFound();
  const { member } = await requireMember(HAOJIE_PATH);
  const requested = parsePage((await searchParams).page);
  const rooms = await listRooms(getHaojieDb(), member.id, requested);
  if (rooms.page !== requested) redirect(pageHref(HAOJIE_PATH, {}, rooms.page));
  return (
    <div className="page-column haojie-lobby">
      <PageHeader title="浩劫 2" />
      <CreateRoom />
      <h2 className="haojie-list-title">我的未结束对局</h2>
      {rooms.items.length ? (
        <ul className="haojie-room-list">
          {rooms.items.map((room) => (
            <li key={room.id}>
              <Link href={`${HAOJIE_PATH}/${room.id}`}>
                <strong>
                  {room.player1.name} · {room.player2?.name ?? "等待另一位玩家"}
                </strong>
                <span className="muted">
                  {roomModeLabel(room.mode)} · {roomStatusLabel(room.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <p>暂无未结束的对局。</p>
        </div>
      )}
      <Pagination {...rooms} path={HAOJIE_PATH} />
    </div>
  );
}
