import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  color?: "blue" | "green" | "orange" | "slate"
}

const colorMap = {
  blue: {
    icon: "bg-blue-50 text-blue-600",
    border: "border-l-blue-500",
  },
  green: {
    icon: "bg-emerald-50 text-emerald-600",
    border: "border-l-emerald-500",
  },
  orange: {
    icon: "bg-orange-50 text-orange-500",
    border: "border-l-orange-400",
  },
  slate: {
    icon: "bg-slate-100 text-slate-500",
    border: "border-l-slate-400",
  },
}

export function StatCard({ title, value, icon: Icon, color = "blue" }: StatCardProps) {
  const colors = colorMap[color]
  return (
    <div
      className={cn(
        "bg-card rounded-lg border border-border border-l-4 p-5 flex items-center gap-4 shadow-sm",
        colors.border
      )}
    >
      <div className={cn("rounded-lg p-2.5", colors.icon)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground font-medium leading-relaxed">{title}</p>
        <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
      </div>
    </div>
  )
}
