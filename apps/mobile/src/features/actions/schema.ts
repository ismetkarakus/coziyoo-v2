import { z } from 'zod';

const NavigateActionSchema = z.object({
  name: z.literal('navigate'),
  params: z.object({
    screen: z.enum(['Home', 'Settings', 'Profile', 'Notes']),
    prefill: z.string().optional(),
  }),
  policy: z.object({ requiresConfirmation: z.boolean().optional() }).optional(),
});

const OpenProfileActionSchema = z.object({
  name: z.literal('open_profile'),
  params: z.object({ userId: z.string().optional() }),
  policy: z.object({ requiresConfirmation: z.boolean().optional() }).optional(),
});

const AppendNoteActionSchema = z.object({
  name: z.literal('append_note'),
  params: z.object({ text: z.string().min(1).max(2000) }),
  policy: z.object({ requiresConfirmation: z.boolean().optional() }).optional(),
});

const SettingsHintActionSchema = z.object({
  name: z.literal('set_settings_hint'),
  params: z.object({ message: z.string().min(1).max(300) }),
  policy: z.object({ requiresConfirmation: z.boolean().optional() }).optional(),
});

const ActionSchema = z.discriminatedUnion('name', [
  NavigateActionSchema,
  OpenProfileActionSchema,
  AppendNoteActionSchema,
  SettingsHintActionSchema,
]);

export const AgentActionEnvelopeSchema = z.object({
  type: z.literal('action'),
  version: z.literal('1.0'),
  requestId: z.string().min(1),
  timestamp: z.string().datetime(),
  action: ActionSchema,
});

export type ValidAgentActionEnvelope = z.infer<typeof AgentActionEnvelopeSchema>;
