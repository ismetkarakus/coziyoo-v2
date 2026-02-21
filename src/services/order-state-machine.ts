import type { AppActorRole } from "../middleware/app-role.js";

export type OrderStatus =
  | "pending_seller_approval"
  | "seller_approved"
  | "awaiting_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "in_delivery"
  | "delivered"
  | "completed"
  | "rejected"
  | "cancelled";

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending_seller_approval: ["seller_approved", "rejected", "cancelled"],
  seller_approved: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["preparing", "cancelled"],
  preparing: ["ready"],
  ready: ["in_delivery", "delivered"],
  in_delivery: ["delivered"],
  delivered: ["completed"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function canActorSetStatus(actorRole: AppActorRole, to: OrderStatus): boolean {
  if (actorRole === "seller") {
    return ["seller_approved", "rejected", "awaiting_payment", "preparing", "ready", "in_delivery", "delivered"].includes(
      to
    );
  }
  if (actorRole === "buyer") {
    return ["completed", "cancelled"].includes(to);
  }
  return false;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return ["completed", "rejected", "cancelled"].includes(status);
}

