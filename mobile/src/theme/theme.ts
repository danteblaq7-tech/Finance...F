// Design tokens ported from the original Finesse mobile app (theme.js).
export const DARK = {
  bg_primary: '#0A0D14', bg_secondary: '#0F1220', bg_tertiary: '#151929', bg_input: '#1A1F2E', bg_nav: '#0D1018',
  accent_teal: '#1B7A8A', accent_teal_lt: '#2BA8BF', accent_orange: '#E07B2A', accent_amber: '#F59E0B',
  accent_green: '#22C55E', accent_red: '#EF4444', accent_purple: '#7C3AED', accent_cyan: '#06B6D4',
  text_primary: '#F1F5F9', text_secondary: '#A8B0C4', text_muted: '#78839C', text_label: '#8C94A8',
  border: '#262E42', border_active: '#2BA8BF', overlay: 'rgba(0,0,0,0.6)',
};

export type Palette = typeof DARK;

export const LIGHT: Palette = {
  bg_primary: '#F0F4F8', bg_secondary: '#FFFFFF', bg_tertiary: '#E8EDF5', bg_input: '#EDF1F7', bg_nav: '#FFFFFF',
  accent_teal: '#1B7A8A', accent_teal_lt: '#2BA8BF', accent_orange: '#E07B2A', accent_amber: '#F59E0B',
  accent_green: '#16A34A', accent_red: '#DC2626', accent_purple: '#7C3AED', accent_cyan: '#0891B2',
  text_primary: '#0F172A', text_secondary: '#475569', text_muted: '#64748B', text_label: '#64748B',
  border: '#CBD5E1', border_active: '#2BA8BF', overlay: 'rgba(0,0,0,0.4)',
};

export const FONTS = {
  display: 'Orbitron_900Black',
  heading: 'Orbitron_700Bold',
  body: 'SpaceMono_400Regular',
  bold: 'SpaceMono_700Bold',
} as const;

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;
