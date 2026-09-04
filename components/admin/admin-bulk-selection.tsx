"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ActionErrorMessage } from "@/components/action-error-message";
import { ModalDialog } from "@/components/modal-dialog";
import type { AdminBulkActionState } from "@/app/(site)/admin/actions";
import type { AdminContentType } from "@/lib/admin/query";

type BulkAction = (
  state: AdminBulkActionState,
  formData: FormData,
) => Promise<AdminBulkActionState>;

const labels: Record<AdminContentType, string> = {
  posts: "帖子",
  replies: "回复",
  annotations: "批注",
  "annotation-replies": "批注回复",
};

export function AdminBulkSelection({
  type,
  action,
  children,
}: {
  type: AdminContentType;
  action: BulkAction;
  children: ReactNode;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [operation, setOperation] = useState<"hide" | "purge" | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [resultOperationId, setResultOperationId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [state, formAction, pending] = useActionState(
    async (previous: AdminBulkActionState, formData: FormData) => {
      const result = await action(previous, formData);
      setResultOperationId(String(formData.get("operationId") ?? ""));
      if (result.success) {
        setSummary(`已处理 ${result.succeeded ?? 0} 条，跳过 ${result.skipped ?? 0} 条。`);
        setSelected([]);
        setOperation(null);
        setOperationId(crypto.randomUUID());
        rootRef.current
          ?.querySelectorAll<HTMLInputElement>(
            "input[data-admin-select-row], input[data-admin-select-all]",
          )
          .forEach((input) => {
            input.checked = false;
            input.indeterminate = false;
          });
        router.refresh();
      }
      return result;
    },
    {},
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLInputElement>("input[data-admin-select-row]")];
    const all = root.querySelector<HTMLInputElement>("input[data-admin-select-all]");
    if (!all) return;
    all.checked = rows.length > 0 && selected.length === rows.length;
    all.indeterminate = selected.length > 0 && selected.length < rows.length;
  }, [selected]);

  const open = (next: "hide" | "purge") => {
    setSummary("");
    setResultOperationId(null);
    setOperationId(crypto.randomUUID());
    setOperation(next);
  };
  const label = labels[type];
  const closeDialog = () => {
    if (resultOperationId === operationId && state.succeeded) router.refresh();
    setOperation(null);
  };

  return (
    <div
      className="admin-bulk-scope"
      ref={rootRef}
      onChange={(event) => {
        const input = event.target as HTMLInputElement;
        if (input.matches("input[data-admin-select-all]")) {
          const values: string[] = [];
          rootRef.current
            ?.querySelectorAll<HTMLInputElement>("input[data-admin-select-row]")
            .forEach((row) => {
              row.checked = input.checked;
              if (input.checked) values.push(row.value);
            });
          setSelected(values);
          return;
        }
        if (!input.matches("input[data-admin-select-row]")) return;
        setSelected(
          [
            ...(rootRef.current?.querySelectorAll<HTMLInputElement>(
              "input[data-admin-select-row]:checked",
            ) ?? []),
          ].map((row) => row.value),
        );
      }}
    >
      <div className="admin-bulk-bar" aria-live="polite">
        <span>已选 {selected.length} 条（仅当前页）</span>
        <div>
          <button
            className="button button--ghost button--small"
            type="button"
            disabled={selected.length === 0}
            onClick={() => open("hide")}
          >
            批量隐藏
          </button>
          <button
            className="button button--danger button--small"
            type="button"
            disabled={selected.length === 0}
            onClick={() => open("purge")}
          >
            批量永久删除
          </button>
        </div>
        {summary && <small>{summary}</small>}
      </div>
      <div className="admin-table-scroll">{children}</div>
      <ModalDialog
        open={operation !== null}
        title={operation === "hide" ? `隐藏所选${label}？` : `永久删除所选${label}？`}
        description={
          operation === "hide"
            ? `将隐藏所选 ${selected.length} 条内容；已经隐藏的内容会跳过。`
            : `将永久删除所选 ${selected.length} 条内容及其约定的关联记录。此操作不可撤销。`
        }
        onClose={() => !pending && closeDialog()}
        alert
      >
        <form action={formAction} className="moderation-form" noValidate>
          <input type="hidden" name="operation" value={operation ?? ""} />
          <input type="hidden" name="operationId" value={operationId} />
          {selected.map((id) => (
            <input type="hidden" name="ids" value={id} key={id} />
          ))}
          {operation === "hide" && (
            <label className="field-label">
              原因（可选）
              <textarea
                className="text-area"
                name="reason"
                rows={3}
                maxLength={300}
                disabled={pending}
              />
            </label>
          )}
          {resultOperationId === operationId && (state.failed ?? 0) > 0 && operation && (
            <p className="admin-bulk-result" aria-live="polite">
              已处理 {state.succeeded ?? 0} 条，跳过 {state.skipped ?? 0} 条，失败{" "}
              {state.failed ?? 0} 条。
            </p>
          )}
          {resultOperationId === operationId && (
            <ActionErrorMessage error={state.error} incidentId={state.incidentId} />
          )}
          <div className="dialog-actions">
            <button
              className="button button--ghost"
              type="button"
              disabled={pending}
              onClick={closeDialog}
            >
              取消
            </button>
            <button
              className={operation === "purge" ? "button button--danger" : "button button--primary"}
              type="submit"
              disabled={
                pending ||
                selected.length === 0 ||
                (resultOperationId === operationId && state.code === "ACCESS_REVOKED")
              }
              aria-busy={pending}
            >
              {pending ? "正在处理…" : operation === "purge" ? "永久删除" : "隐藏所选"}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
