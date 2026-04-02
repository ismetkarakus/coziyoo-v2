import type { AppActorRole } from "../middleware/app-role.js";

export type OrderStatus =
  | "pending_seller_approval"
  | "seller_approved"
  | "awaiting_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "in_delivery"
  | "approaching"
  | "at_door"
  | "delivered"
  | "completed"
  | "rejected"
  | "cancelled";

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending_seller_approval: ["cancelled"],
  seller_approved: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["preparing", "cancelled"],
  preparing: ["ready", "in_delivery"],
  ready: ["in_delivery"],
  in_delivery: ["at_door", "approaching"],
  approaching: ["at_door"],
  at_door: ["delivered", "completed"],
  delivered: ["completed"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function canActorSetStatus(
  actorRole: AppActorRole,
  to: OrderStatus,
  deliveryType?: string
): boolean {
  if (actorRole === "seller") {
    if (deliveryType === "pickup") {
      return ["preparing", "ready"].includes(to);
    }
    return ["preparing", "ready", "in_delivery", "at_door", "delivered", "completed"].includes(to);
  }
  if (actorRole === "buyer") {
    if (deliveryType === "pickup") {
      return ["in_delivery", "approaching", "at_door", "completed", "cancelled"].includes(to);
    }
    return ["completed", "cancelled"].includes(to);
  }
  return false;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return ["completed", "rejected", "cancelled"].includes(status);
}
