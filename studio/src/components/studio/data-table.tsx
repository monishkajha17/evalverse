"use client";

import { useMemo, useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ColumnDef<T> = {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  defaultVisible?: boolean;
  className?: string;
  headerClassName?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  minWidth = 720,
}: {
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  minWidth?: number;
}) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const visible = useMemo(
    () => columns.filter((c) => (hidden[c.id] ? false : c.defaultVisible !== false)),
    [columns, hidden],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
      <div className="flex items-center justify-end border-b border-hairline px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-ink-muted">
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((col) => {
              const checked = !hidden[col.id] && col.defaultVisible !== false;
              return (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={checked}
                  onCheckedChange={(next) =>
                    setHidden((prev) => ({ ...prev, [col.id]: next === false }))
                  }
                >
                  {col.header}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-auto">
        <table className="sticky-table w-full border-collapse text-left text-xs" style={{ minWidth }}>
          <thead>
            <tr className="text-ink/55">
              {visible.map((col) => (
                <th key={col.id} className={cn("px-3 py-2 font-semibold", col.headerClassName)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(visible.length, 1)} className="px-3 py-10">
                  {empty || <div className="text-center text-ink/50">No rows</div>}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-t border-border",
                    onRowClick && "cursor-pointer hover:bg-muted/70",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visible.map((col) => (
                    <td key={col.id} className={cn("px-3 py-2 align-middle", col.className)}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
