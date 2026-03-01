import { describe, expect, it } from "vitest";
import {
  canActorSetStatus,
  canTransition,
  isTerminalStatus,
  type OrderStatus,
} from "../../src/services/order-state-machine.js";

describe("order-state-machine", () => {
  it("allows valid transitions", () => {
    expect(canTransition("pending_seller_approval", "seller_approved")).toBe(true);
    expect(canTransition("awaiting_payment", "paid")).toBe(true);
    expect(canTransition("delivered", "completed")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransition("pending_seller_approval", "completed")).toBe(false);
    expect(canTransition("paid", "seller_approved")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
  });

  it("enforces actor permissions", () => {
    expect(canActorSetStatus("seller", "preparing")).toBe(true);
    expect(canActorSetStatus("seller", "completed")).toBe(false);
    expect(canActorSetStatus("buyer", "completed")).toBe(true);
    expect(canActorSetStatus("buyer", "preparing")).toBe(false);
  });

  it("detects terminal states", () => {
    const terminal: OrderStatus[] = ["completed", "rejected", "cancelled"];
    for (const status of terminal) expect(isTerminalStatus(status)).toBe(true);
    expect(isTerminalStatus("paid")).toBe(false);
  });
});
