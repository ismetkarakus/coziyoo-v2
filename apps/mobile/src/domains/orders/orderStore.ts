import { create } from 'zustand';

type DraftItem = {
  productId: string;
  quantity: number;
};

type OrderStatus = 'idle' | 'draft' | 'pending_confirmation' | 'placed' | 'failed';

type OrderState = {
  draftId?: string;
  items: DraftItem[];
  status: OrderStatus;
  lastPlacedOrderId?: string;
  highlightedProductId?: string;
  addItem: (productId: string, quantity?: number) => void;
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  markPendingConfirmation: () => void;
  placeOrder: () => void;
  setFailed: () => void;
  setHighlightedProductId: (productId?: string) => void;
};

function newDraftId() {
  return `draft_${Date.now()}`;
}

export const useOrderStore = create<OrderState>((set) => ({
  draftId: undefined,
  items: [],
  status: 'idle',
  lastPlacedOrderId: undefined,
  highlightedProductId: undefined,
  addItem: (productId, quantity = 1) =>
    set((state) => {
      const existing = state.items.find((it) => it.productId === productId);
      const items = existing
        ? state.items.map((it) => (it.productId === productId ? { ...it, quantity: it.quantity + quantity } : it))
        : [...state.items, { productId, quantity }];

      return {
        items,
        status: 'draft',
        draftId: state.draftId ?? newDraftId(),
      };
    }),
  removeItem: (productId) =>
    set((state) => ({
      items: state.items.filter((it) => it.productId !== productId),
      status: state.items.length > 1 ? 'draft' : 'idle',
    })),
  setQuantity: (productId, quantity) =>
    set((state) => ({
      items: state.items.map((it) => (it.productId === productId ? { ...it, quantity: Math.max(1, quantity) } : it)),
      status: 'draft',
      draftId: state.draftId ?? newDraftId(),
    })),
  markPendingConfirmation: () => set({ status: 'pending_confirmation' }),
  placeOrder: () =>
    set((state) => ({
      status: 'placed',
      lastPlacedOrderId: state.draftId ? `order_${state.draftId}` : `order_${Date.now()}`,
      draftId: undefined,
      items: [],
    })),
  setFailed: () => set({ status: 'failed' }),
  setHighlightedProductId: (productId) => set({ highlightedProductId: productId }),
}));
