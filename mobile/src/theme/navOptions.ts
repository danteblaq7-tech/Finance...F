import { useTheme } from './ThemeProvider';
import { FONTS } from './theme';

/** Shared React Navigation styling so headers and tab bars follow the Finesse theme. */
export function useNavOptions() {
  const { colors } = useTheme();
  return {
    stack: {
      headerStyle: { backgroundColor: colors.bg_secondary },
      headerTintColor: colors.accent_teal_lt,
      headerTitleStyle: { fontFamily: FONTS.heading, fontSize: 14, color: colors.text_primary },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.bg_primary },
    },
    tabs: {
      headerShown: false,
      tabBarStyle: { backgroundColor: colors.bg_nav, borderTopColor: colors.nav_border },
      tabBarActiveTintColor: colors.nav_text_active,
      tabBarInactiveTintColor: colors.nav_text,
      tabBarLabelStyle: { fontFamily: FONTS.button, fontSize: 9 },
    },
  } as const;
}
