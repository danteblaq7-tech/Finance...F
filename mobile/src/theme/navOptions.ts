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
      tabBarStyle: { backgroundColor: colors.bg_nav, borderTopColor: colors.border },
      tabBarActiveTintColor: colors.accent_teal_lt,
      tabBarInactiveTintColor: colors.text_muted,
      tabBarLabelStyle: { fontFamily: FONTS.bold, fontSize: 10 },
    },
  } as const;
}
