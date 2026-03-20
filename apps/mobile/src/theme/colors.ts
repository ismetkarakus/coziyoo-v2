export const theme = {
  background: '#F5F1EB',
  surface: '#FFFDF9',
  card: '#FFFDF9',
  primary: '#4A7C59',
  text: '#3D3229',
  textSecondary: '#A89B8C',
  sellerText: '#7A8B6E',
  priceText: '#5B7A4A',
  starGold: '#C4953A',
  border: '#EDE8E0',
  error: '#DC3545',
  tabActive: '#4A7C59',
  tabInactive: '#A89B8C',
  onPrimary: '#FFFFFF',
  shadow: '#3D3229',
  buttonActive: '#4A7C59',
  buttonPassiveBg: '#EDE8E0',
  buttonPassiveText: '#6B5D4F',
} as const;

export type ThemeTokens = typeof theme;
