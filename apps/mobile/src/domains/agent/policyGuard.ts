import type { AgentAction, ConversationState } from './types';

const HIGH_RISK_ACTIONS = new Set<AgentAction['type']>(['place_order']);

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
  idempotencyKey: string;
};

export function buildIdempotencyKey(conversation: ConversationState, action: AgentAction): string {
  return `${conversation.conversationId}:${conversation.turnId}:${action.type}`;
}

export function evaluatePolicy(action: AgentAction, conversation: ConversationState, confirmed: boolean): PolicyDecision {
  const requiresConfirmation = HIGH_RISK_ACTIONS.has(action.type);
  const idempotencyKey = buildIdempotencyKey(conversation, action);

  if (requiresConfirmation && !confirmed) {
    return {
      allowed: false,
      reason: 'Confirmation required for high-risk action.',
      requiresConfirmation: true,
      idempotencyKey,
    };
  }

  return {
    allowed: true,
    requiresConfirmation,
    idempotencyKey,
  };
}
