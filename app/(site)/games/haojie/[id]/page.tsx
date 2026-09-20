import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/access";
import { HAOJIE_PATH, HaojieError } from "@/lib/haojie/contracts";
import { parseRoomId } from "@/lib/haojie/input";
import { getRoom } from "@/lib/haojie/service";
import { getHaojieDb, isHaojieEnabled } from "@/lib/haojie/runtime";
import { HaojieRoom } from "@/components/haojie/room";

export const metadata = { title: "浩劫 2 对局" };
export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isHaojieEnabled()) notFound();
  const { id } = await params;
  const { member } = await requireMember(`${HAOJIE_PATH}/${encodeURIComponent(id)}`);
  let initial;
  try {
    parseRoomId(id);
    initial = (await getRoom(getHaojieDb(), id, member.id))!;
  } catch (error) {
    if (error instanceof HaojieError && error.status === 404) notFound();
    throw error;
  }
  return <HaojieRoom key={`${id}:${member.id}`} initial={initial} />;
}
