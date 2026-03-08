import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConnect = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  pool: {
    connect: mockConnect,
    query: mockPoolQuery,
  },
}));

type LedgerEntry = { id: string; sellerId: string; amount: number; sourceType: string };
type Batch = {
  id: string;
  sellerId: string;
  payoutDate: string;
  batchKey: string;
  totalAmount: number;
  status: "pending" | "processing" | "paid" | "failed";
};
type BatchItem = { batchId: string; ledgerEntryId: string; amount: number };

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

describe("payouts service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates daily payout batch once and keeps next run idempotent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));

    const ledger: LedgerEntry[] = [
      { id: "l1", sellerId: "seller-1", amount: 100, sourceType: "order_finance" },
      { id: "l2", sellerId: "seller-1", amount: -20, sourceType: "finance_adjustment" },
    ];
    const batches: Batch[] = [];
    const items: BatchItem[] = [];

    const clientQuery = vi.fn(async (sql: unknown, params: unknown[] = []) => {
      const q = normalizeSql(sql);
      if (q === "begin" || q === "commit" || q === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      if (q.includes("pg_try_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{ acquired: true }] };
      }
      if (q.includes("insert into seller_ledger_entries") && q.includes("from order_finance")) {
        return { rowCount: 0, rows: [] };
      }
      if (q.includes("insert into seller_ledger_entries") && q.includes("from finance_adjustments")) {
        return { rowCount: 0, rows: [] };
      }
      if (q.includes("from seller_bank_accounts")) {
        return { rowCount: 1, rows: [{ seller_id: "seller-1" }] };
      }
      if (q.includes("from seller_payout_batches") && q.includes("status in ('pending', 'processing', 'paid')")) {
        const sellerId = String(params[0]);
        const payoutDate = String(params[1]);
        const found = batches.find(
          (row) => row.sellerId === sellerId && row.payoutDate === payoutDate && ["pending", "processing", "paid"].includes(row.status)
        );
        return { rowCount: found ? 1 : 0, rows: found ? [{ id: found.id }] : [] };
      }
      if (q.includes("from seller_ledger_entries sle") && q.includes("for update")) {
        const sellerId = String(params[0]);
        const activeLinked = new Set(
          items
            .filter((item) => {
              const batch = batches.find((b) => b.id === item.batchId);
              return !!batch && ["pending", "processing", "paid"].includes(batch.status);
            })
            .map((item) => item.ledgerEntryId)
        );
        const rows = ledger
          .filter((row) => row.sellerId === sellerId)
          .filter((row) => row.sourceType !== "payout_debit")
          .filter((row) => !activeLinked.has(row.id))
          .map((row) => ({ id: row.id, amount: row.amount.toFixed(2) }));
        return { rowCount: rows.length, rows };
      }
      if (q.includes("insert into seller_payout_batches")) {
        const sellerId = String(params[0]);
        const payoutDate = String(params[1]);
        const batchKey = String(params[2]);
        const totalAmount = Number(params[4]);
        if (batches.some((row) => row.batchKey === batchKey)) {
          return { rowCount: 0, rows: [] };
        }
        const created: Batch = {
          id: `b_${batches.length + 1}`,
          sellerId,
          payoutDate,
          batchKey,
          totalAmount,
          status: "pending",
        };
        batches.push(created);
        return { rowCount: 1, rows: [{ id: created.id }] };
      }
      if (q.includes("insert into seller_payout_items")) {
        items.push({
          batchId: String(params[0]),
          ledgerEntryId: String(params[1]),
          amount: Number(params[2]),
        });
        return { rowCount: 1, rows: [] };
      }
      if (q.includes("update seller_payout_batches") && q.includes("set status = 'processing'")) {
        const batch = batches.find((row) => row.id === String(params[0]));
        if (batch) batch.status = "processing";
        return { rowCount: batch ? 1 : 0, rows: [] };
      }

      throw new Error(`Unhandled SQL in test: ${q}`);
    });

    mockConnect.mockResolvedValue({ query: clientQuery, release: vi.fn() });

    const { generateDailyPayoutBatches } = await import("../../src/services/payouts.js");

    const first = await generateDailyPayoutBatches();
    expect(first.createdBatchCount).toBe(1);
    expect(first.createdTotalAmount).toBe(80);

    const second = await generateDailyPayoutBatches();
    expect(second.createdBatchCount).toBe(0);
    expect(second.createdTotalAmount).toBe(0);
    expect(batches).toHaveLength(1);

    vi.useRealTimers();
  });

  it("computes seller balance with pending payout subtraction", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          ledger_balance: "140.00",
          pending_balance: "40.00",
          paid_total: "100.00",
        },
      ],
    });

    const { getSellerBalance } = await import("../../src/services/payouts.js");
    const balance = await getSellerBalance("seller-1");

    expect(balance.availableBalance).toBe(100);
    expect(balance.pendingPayoutBalance).toBe(40);
    expect(balance.paidOutTotal).toBe(100);
    expect(balance.currency).toBe("TRY");
  });
});
