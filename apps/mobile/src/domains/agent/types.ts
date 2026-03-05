import type { Dish } from '../catalog/types';

export type UserIntent =
  | 'browse'
  | 'compare'
  | 'add_item'
  | 'modify_order'
  | 'checkout'
  | 'support'
  | 'unknown';

export type ScreenContext = {
  screenName: string;
  routeParams?: Record<string, unknown>;
  visibleProducts: Array<Pick<Dish, 'id' | 'title'>>;
  selectedProductId?: string;
  sessionCapabilities: {
    canPlaceOrder: boolean;
    hasAddress: boolean;
    paymentAvailable: boolean;
  };
};

export type IntentContext = {
  intent: UserIntent;
  confidence: number;
  entities: Record<string, unknown>;
  lastUserGoal?: string;
};

export type ConversationState = {
  conversationId: string;
  turnId: number;
  pendingConfirmation: 'none' | 'place_order' | 'cancel_order' | 'change_address' | 'change_payment';
  activeOrderDraftId?: string;
};

export type AgentAction =
  | { type: 'navigate'; screen: 'Home' | 'ProductDetail' | 'OrderStatus'; params?: Record<string, unknown> }
  | { type: 'highlight_product'; productId: string }
  | { type: 'add_item'; productId: string; quantity: number }
  | { type: 'remove_item'; productId: string }
  | { type: 'set_quantity'; productId: string; quantity: number }
  | { type: 'place_order' }
  | { type: 'track_order' };

export type N8nTurnRequest = {
  conversation: ConversationState;
  screenContext: ScreenContext;
  intentContext: IntentContext;
  catalogSnapshotRef: string;
  userProfileRef: string;
  audioMeta?: {
    roomName?: string;
    language?: string;
  };
  userText: string;
};

export type N8nTurnResponse = {
  assistantText: string;
  ttsInstruction?: {
    voice?: string;
    style?: string;
  };
  actions: AgentAction[];
  memoryPatch?: Record<string, unknown>;
  requiresConfirmation?: boolean;
};
