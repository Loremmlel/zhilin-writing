import type { ReactNode } from "react";

export type AdminTableColumn<T> = {
  label: string;
  className?: string;
  render: (row: T) => ReactNode;
};

export function AdminContentTable<T>({
  rows,
  columns,
  getRowId,
  wide = false,
}: {
  rows: T[];
  columns: AdminTableColumn<T>[];
  getRowId: (row: T) => string;
  wide?: boolean;
}) {
  return (
    <table className={`admin-table${wide ? " admin-table--wide" : ""}`}>
      <thead>
        <tr>
          <th className="admin-table-select" scope="col">
            <input type="checkbox" data-admin-select-all aria-label="选择当前页全部内容" />
          </th>
          {columns.map((column) => (
            <th className={column.className} scope="col" key={column.label}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const id = getRowId(row);
          return (
            <tr key={id}>
              <td className="admin-table-select">
                <input type="checkbox" value={id} data-admin-select-row aria-label="选择此条内容" />
              </td>
              {columns.map((column) => (
                <td className={column.className} key={column.label}>
                  <div className="admin-table-cell-content">{column.render(row)}</div>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
