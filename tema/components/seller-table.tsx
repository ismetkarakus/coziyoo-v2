"use client"

import { useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table"
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface Seller {
  id: string
  displayId: string
  storeName: string
  status: "Aktif" | "Pasif" | "Beklemede"
  complaintCount: number
  orderHealth: string
  healthTrend: "up" | "down" | "neutral"
  ratingTrend: string
}

const mockData: Seller[] = [
  { id: "1", displayId: "2768f419-1...", storeName: "alici ayhan", status: "Aktif", complaintCount: 0, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
  { id: "2", displayId: "c5b183d3-a...", storeName: "BothMuratCelik7o06", status: "Aktif", complaintCount: 1, orderHealth: "N.1T", healthTrend: "up", ratingTrend: "+0.0" },
  { id: "3", displayId: "ba914600-0...", storeName: "BothBurakSahin7o05", status: "Aktif", complaintCount: 2, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
  { id: "4", displayId: "9cf70a22-d...", storeName: "BothCanAydin7o04", status: "Aktif", complaintCount: 0, orderHealth: "N.1T", healthTrend: "up", ratingTrend: "+0.0" },
  { id: "5", displayId: "a094b44e-5...", storeName: "BothAliKaya7o03", status: "Aktif", complaintCount: 0, orderHealth: "N.1T", healthTrend: "up", ratingTrend: "+0.0" },
  { id: "6", displayId: "3da7d9da-9...", storeName: "BothMehmetDemir7o02", status: "Aktif", complaintCount: 1, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
  { id: "7", displayId: "d0ca5c3f-9...", storeName: "BothAhmetYilmaz7o01", status: "Aktif", complaintCount: 2, orderHealth: "N.1T", healthTrend: "up", ratingTrend: "+0.0" },
  { id: "8", displayId: "b5fa9b0d-2...", storeName: "ElifTuran7o14", status: "Aktif", complaintCount: 3, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
  { id: "9", displayId: "802cbb60-1...", storeName: "ZeynepAksoy7o13", status: "Aktif", complaintCount: 4, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
  { id: "10", displayId: "360ca322-1...", storeName: "AyseGunes7o12", status: "Aktif", complaintCount: 1, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
  { id: "11", displayId: "d0c880a3-...", storeName: "FatmaKaraca7o11", status: "Aktif", complaintCount: 0, orderHealth: "N.1T", healthTrend: "neutral", ratingTrend: "+0.0" },
]

function TrendIcon({ trend }: { trend: "up" | "down" | "neutral" }) {
  if (trend === "up") return <ArrowUp className="w-3.5 h-3.5 text-emerald-500" />
  if (trend === "down") return <ArrowDown className="w-3.5 h-3.5 text-red-500" />
  return <span className="w-3.5 h-3.5 text-muted-foreground inline-flex items-center justify-center">•</span>
}

const columns: ColumnDef<Seller>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="Tümünü seç"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label="Satır seç"
      />
    ),
    enableSorting: false,
  },
  {
    accessorKey: "displayId",
    header: ({ column }) => (
      <button
        className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
        onClick={() => column.toggleSorting()}
      >
        Display ID <ArrowUpDown className="w-3 h-3" />
      </button>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">{row.getValue("displayId")}</span>
    ),
  },
  {
    accessorKey: "storeName",
    header: ({ column }) => (
      <button
        className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
        onClick={() => column.toggleSorting()}
      >
        Mağaza Adı <ArrowUpDown className="w-3 h-3" />
      </button>
    ),
    cell: ({ row }) => (
      <span className="font-medium text-sm text-foreground">{row.getValue("storeName")}</span>
    ),
  },
  {
    accessorKey: "status",
    header: () => (
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Durum</span>
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      return (
        <Badge
          className={cn(
            "text-xs font-medium px-2.5 py-0.5 rounded-full",
            status === "Aktif" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
            status === "Pasif" && "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20",
            status === "Beklemede" && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
          )}
          variant="outline"
        >
          {status}
        </Badge>
      )
    },
  },
  {
    accessorKey: "complaintCount",
    header: ({ column }) => (
      <button
        className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
        onClick={() => column.toggleSorting()}
      >
        Şikayet Sayısı <ArrowUpDown className="w-3 h-3" />
      </button>
    ),
    cell: ({ row }) => {
      const count = row.getValue("complaintCount") as number
      return (
        <span className={cn("text-sm font-medium", count > 0 ? "text-orange-500" : "text-muted-foreground")}>
          {count}
        </span>
      )
    },
  },
  {
    accessorKey: "orderHealth",
    header: () => (
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sipariş Sağlığı</span>
    ),
    cell: ({ row }) => {
      const seller = row.original
      return (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold border border-amber-500/20">
            {seller.orderHealth}
          </span>
          <TrendIcon trend={seller.healthTrend} />
        </div>
      )
    },
  },
  {
    accessorKey: "ratingTrend",
    header: () => (
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rating Trend</span>
    ),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        – ★ <span className="text-xs">({row.getValue("ratingTrend")})</span>
      </span>
    ),
  },
  {
    id: "actions",
    header: () => null,
    cell: () => (
      <Button variant="outline" size="sm" className="text-xs h-7 gap-1 border-border hover:bg-muted">
        Detay <ChevronDown className="w-3 h-3" />
      </Button>
    ),
  },
]

export function SellerTable() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState({})

  const table = useReactTable({
    data: mockData,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border bg-muted/40">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-left whitespace-nowrap first:pl-4"
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => (
            <tr
              key={row.id}
              className={cn(
                "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
                i % 2 === 0 ? "bg-card" : "bg-background"
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 whitespace-nowrap first:pl-4">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
