import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminContentTable } from "@/components/admin/admin-content-table";
import { GameArchiveControl } from "@/components/admin/game-archive-control";
import { Pagination } from "@/components/pagination";
import { requireAdministrator } from "@/lib/auth/access";
import { listArchiveRooms } from "@/lib/haojie/archives";
import { getHaojieDb } from "@/lib/haojie/runtime";
import { roomModeLabel, roomStatusLabel } from "@/lib/haojie/contracts";
import { parsePage } from "@/lib/pagination";
import { formatDateTime } from "@/lib/format";
import { manageGameArchive } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "对局档案 | 知临中学" };
const endLabels: Record<string, string> = {
  game: "分出胜负",
  resign: "认输",
  cancel: "取消",
  aborted: "管理员结束",
};

export default async function GameArchivesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdministrator("/admin/games");
  const result = await listArchiveRooms(getHaojieDb(), parsePage((await searchParams).page));
  return (
    <AdminShell active="games">
      <div className="admin-page admin-page--content">
        <div className="admin-workspace admin-workspace--single">
          <main className="admin-workspace-main admin-workspace-main--content">
            <section className="admin-section admin-content-section" aria-labelledby="games-title">
              <div className="admin-content-topbar">
                <h1 id="games-title">对局档案</h1>
                <span className="admin-content-meta">共 {result.total} 局</span>
              </div>
              {result.items.length ? (
                <div className="admin-table-scroll">
                  <AdminContentTable
                    selectable={false}
                    rows={result.items}
                    getRowId={(row) => row.id}
                    columns={[
                      {
                        label: "对局",
                        render: (row) => (
                          <>
                            <strong>
                              {row.player1Name} · {row.player2Name ?? "等待对手"}
                            </strong>
                            <small>
                              {roomModeLabel(row.mode)} · {row.id.slice(0, 8)}
                            </small>
                          </>
                        ),
                      },
                      {
                        label: "结果",
                        render: (row) => (
                          <>
                            <span>
                              {row.endReason
                                ? endLabels[row.endReason]
                                : roomStatusLabel(row.status)}
                            </span>
                            <small>
                              {row.winner === "draw"
                                ? "平局"
                                : row.winner
                                  ? `${row.winner === "1" ? row.player1Name : row.player2Name} 获胜`
                                  : "—"}
                            </small>
                          </>
                        ),
                      },
                      { label: "更新时间", render: (row) => formatDateTime(row.updatedAt) },
                      {
                        label: "记录",
                        render: (row) => (
                          <>
                            <span>{row.recordCount} 条</span>
                            <small>{row.recordingComplete ? "完整记录" : "历史不完整"}</small>
                          </>
                        ),
                      },
                      {
                        label: "归档",
                        render: (row) =>
                          row.archiveKey
                            ? `已归档 · ${Math.max(1, Math.ceil((row.archiveBytes ?? 0) / 1024))} KB`
                            : ["finished", "cancelled"].includes(row.status)
                              ? "待归档"
                              : "记录中",
                      },
                      {
                        label: "操作",
                        className: "admin-table-operation",
                        render: (row) => (
                          <div className="admin-table-actions">
                            {row.archiveKey ? (
                              <a
                                className="text-link"
                                href={`/api/admin/games/${row.id}/download`}
                                download
                              >
                                下载 JSON
                              </a>
                            ) : (
                              <GameArchiveControl
                                active={["waiting", "playing"].includes(row.status)}
                                action={manageGameArchive.bind(
                                  null,
                                  row.id,
                                  row.revision,
                                  ["waiting", "playing"].includes(row.status) ? "abort" : "archive",
                                )}
                              />
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>
              ) : (
                <p className="empty-copy">暂无对局记录。</p>
              )}
              <Pagination
                total={result.total}
                page={result.page}
                pageSize={result.pageSize}
                path="/admin/games"
              />
            </section>
          </main>
        </div>
      </div>
    </AdminShell>
  );
}
