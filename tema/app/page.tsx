"use client"

import { Store, Clock, AlertCircle, TrendingUp, Download, SlidersHorizontal } from "lucide-react"
import { StatCard } from "@/components/stat-card"
import { SellerTable } from "@/components/seller-table"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"

const stats = [
  { title: "Toplam Satıcı", value: 20, icon: Store, color: "blue" as const },
  { title: "Onay Bekleyenler", value: 20, icon: Clock, color: "orange" as const },
  { title: "Açık Şikayetler", value: 0, icon: AlertCircle, color: "slate" as const },
  { title: "Bugün Yeni Satıcı", value: 0, icon: TrendingUp, color: "green" as const },
]

export default function Page() {
  return (
    <main className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground text-balance">Satıcı Yönetimi</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">Tüm satıcıları görüntüle ve yönet</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* Stat Cards */}
        <section aria-label="İstatistikler" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <StatCard key={s.title} {...s} />
          ))}
        </section>

        {/* Table Card */}
        <section aria-label="Satıcı Listesi" className="bg-card rounded-lg border border-border shadow-sm">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-sm h-8 border-border text-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Güncelleme: Yeni → Eski Azalan
            </Button>
            <Button
              size="sm"
              className="gap-2 text-sm h-8 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="w-3.5 h-3.5" />
              Excel&apos;e Aktar
            </Button>
          </div>

          {/* Table */}
          <SellerTable />

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Toplam 20 satıcı</p>
            <div className="flex items-center gap-1">
              {[1, 2].map((p) => (
                <button
                  key={p}
                  className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                    p === 1
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
