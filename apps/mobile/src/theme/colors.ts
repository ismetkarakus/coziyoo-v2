export const theme = {
  background: '#F4F6F8',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  primary: '#7FAF9A',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  error: '#DC3545',
  tabActive: '#7FAF9A',
  tabInactive: '#94A3B8',
  onPrimary: '#FFFFFF',
  shadow: '#0F172A',
} as const;

export type ThemeTokens = typeof theme;
