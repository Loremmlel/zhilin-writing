"use client";

export type VisibilityUser = { id: string; displayName: string };

export function PostVisibilityField({
  value,
  onChange,
  users,
  authorId,
  disabled = false,
}: {
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  users: VisibilityUser[];
  authorId: string;
  disabled?: boolean;
}) {
  const restricted = value !== null;
  const unavailableIds =
    value?.filter((id) => id !== authorId && !users.some((user) => user.id === id)) ?? [];
  return (
    <fieldset className="post-visibility" disabled={disabled}>
      <legend className="field-label">可见范围</legend>
      <input type="hidden" name="visibilityUserIds" value={JSON.stringify(value)} />
      <div className="post-visibility-modes">
        <label>
          <input
            type="radio"
            name="post-visibility-mode"
            checked={!restricted}
            onChange={() => onChange(null)}
          />
          全部站内用户
        </label>
        <label>
          <input
            type="radio"
            name="post-visibility-mode"
            checked={restricted}
            onChange={() => onChange(users.some((user) => user.id === authorId) ? [authorId] : [])}
          />
          指定用户
        </label>
      </div>
      {restricted && (
        <>
          {unavailableIds.length > 0 && (
            <p className="muted">
              有 {unavailableIds.length} 个已不可选用户。{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => onChange(value.filter((id) => !unavailableIds.includes(id)))}
              >
                清除失效选择
              </button>
            </p>
          )}
          <div className="post-visibility-users" aria-label="可见用户白名单">
            {users.map((user) => (
              <label key={user.id}>
                <input
                  type="checkbox"
                  checked={user.id === authorId || value.includes(user.id)}
                  disabled={user.id === authorId}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...value, user.id]
                        : value.filter((id) => id !== user.id),
                    )
                  }
                />
                <span>
                  {user.displayName}
                  {user.id === authorId ? "（作者）" : ""}
                </span>
              </label>
            ))}
            {users.length === 0 && <span className="muted">暂无可选择的普通用户。</span>}
          </div>
        </>
      )}
    </fieldset>
  );
}
