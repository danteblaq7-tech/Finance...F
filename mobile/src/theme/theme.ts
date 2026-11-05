// Design tokens ported from the original Finesse mobile app (theme.js).
// Two palettes with the same brand (teal + orange). "Midnight" is dark, "Daylight" is light.
// In Daylight the teal/orange/status colours are darker shades so text on white stays readable (WCAG AA).
export const DARK = {
  bg_primary: '#0A0D14', bg_secondary: '#0F1220', bg_tertiary: '#151929', bg_input: '#1A1F2E', bg_nav: '#0D1018',
  accent_teal: '#1B7A8A', accent_teal_lt: '#2BA8BF', accent_orange: '#E07B2A', accent_amber: '#F59E0B',
  accent_green: '#22C55E', accent_red: '#EF4444', accent_purple: '#7C3AED', accent_cyan: '#06B6D4',
  text_primary: '#F1F5F9', text_secondary: '#A8B0C4', text_muted: '#78839C', text_label: '#8C94A8',
  border: '#262E42', border_active: '#2BA8BF', overlay: 'rgba(0,0,0,0.6)',
  // bottom tab bar
  nav_text: '#78839C', nav_text_active: '#2BA8BF', nav_border: '#262E42',
};

export type Palette = typeof DARK;

export const LIGHT: Palette = {
  // page, cards and inputs
  bg_primary: '#F3F6FA', bg_secondary: '#FFFFFF', bg_tertiary: '#E9EFF5', bg_input: '#F1F5F9',
  // the tab bar is deep teal-navy (like the web side panel) so the app has a strong anchor on a light page
  bg_nav: '#0C2F3B',
  accent_teal: '#1B7A8A', accent_teal_lt: '#136E7E', accent_orange: '#B4560E', accent_amber: '#B45309',
  accent_green: '#15803D', accent_red: '#B91C1C', accent_purple: '#7C3AED', accent_cyan: '#0E7490',
  text_primary: '#0B1F2A', text_secondary: '#3F5566', text_muted: '#5B6F7E', text_label: '#5B6F7E',
  border: '#D5DEE7', border_active: '#136E7E', overlay: 'rgba(11,31,42,0.45)',
  nav_text: '#A7C4CE', nav_text_active: '#78E0F0', nav_border: '#164555',
};

// Lexend: reading text and form inputs.  Orbitron: headings, navigation (tab bar / headers) and buttons.
export const FONTS = {
  display: 'Orbitron_900Black', // logo
  heading: 'Orbitron_700Bold', // titles, headings, navigation headers
  button: 'Orbitron_700Bold', // buttons and button-like chips
  body: 'Lexend_400Regular', // normal text and text inputs
  bold: 'Lexend_600SemiBold', // emphasised normal text, field labels
} as const;

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;
