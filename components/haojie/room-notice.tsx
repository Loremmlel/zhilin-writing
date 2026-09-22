"use client";

import { useEffect, useState, type ReactNode } from "react";

// Each receipt mounts once; polling the same receipt must not restart its timer.
export function RoomNotice({
  children,
  transient = false,
}: {
  children: ReactNode;
  transient?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!transient) return;
    const timer = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [transient]);
  if (!visible) return null;
  return (
    <div className="haojie-room-notice">
      <div role={transient ? "status" : "alert"}>{children}</div>
      {!transient && (
        <button
          type="button"
          className="button button--text"
          aria-label="关闭提示"
          onClick={() => setVisible(false)}
        >
          ×
        </button>
      )}
    </div>
  );
}
