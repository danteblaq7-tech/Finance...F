import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, BackHandler, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '@/context/AuthProvider';
import { activeItem, type NavItem } from '@/lib/nav';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, SPACING } from '@/theme/theme';
import { InShellContext } from './ShellContext';

const NOTCH = 28; // radius of the curves above and below the active tab (same as the web's .nav-active)
const TAB_H = 52;
const MENU_INSET = 20; // left padding of the menu list

/**
 * The app frame, laid out like the web app. A teal top bar carries the brand and the menu button; the page sits on a
 * white panel under it. The menu is the web's side panel: it slides in from the left BEHIND the page, and the
 * active item joins the page panel with curved corners, exactly as on the web.
 */
export function Shell({ items, children }: { items: NavItem[]; children: ReactNode }) {
  const { colors, isDark, toggle } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const W = Math.min(310, Math.round(width * 0.82));

  const x = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // the menu only exists while it is open or sliding

  const slide = useCallback((to: number) => {
    Animated.timing(x, { toValue: to, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && to === 0) setMounted(false);
    });
  }, [x]);
  const openMenu = useCallback(() => { setMounted(true); setOpen(true); slide(W); }, [slide, W]);
  const closeMenu = useCallback(() => { setOpen(false); slide(0); }, [slide]);

  // The Android back button closes the menu first.
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeMenu(); return true; });
    return () => sub.remove();
  }, [open, closeMenu]);

  // Swipe right from the left edge to open; swipe left to close.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2 && (open ? g.dx < 0 : g.x0 < 24 && g.dx > 0),
    onPanResponderGrant: () => setMounted(true),
    onPanResponderMove: (_e, g) => x.setValue(Math.max(0, Math.min(W, (open ? W : 0) + g.dx))),
    onPanResponderRelease: (_e, g) => {
      const goOpen = (open ? W + g.dx : g.dx) > W / 2;
      if (goOpen) { setOpen(true); slide(W); } else { setOpen(false); slide(0); }
    },
  }), [open, W, x, slide]);

  const active = activeItem(items, pathname);
  const onTopLevel = !!active && pathname === active.href;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace((active?.href ?? items[0]!.href) as never);
  };
  const go = (item: NavItem) => {
    closeMenu();
    if (pathname !== item.href) router.replace(item.href as never);
  };
  const confirmSignOut = () => Alert.alert('Sign out?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.side_bg }}>
      {mounted ? (
        <Menu W={W} items={items} active={active} onSelect={go} onSignOut={confirmSignOut} />
      ) : null}

      <Animated.View {...pan.panHandlers} style={{ flex: 1, backgroundColor: colors.side_bg, transform: [{ translateX: x }] }}>
        <View style={{ backgroundColor: colors.side_bg, paddingTop: insets.top }}>
          <View style={s.bar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={onTopLevel ? 'Open menu' : 'Go back'}
              hitSlop={8}
              onPress={onTopLevel ? openMenu : goBack}
              style={s.barBtn}
            >
              <Ionicons name={onTopLevel ? 'menu' : 'arrow-back'} size={26} color={colors.side_text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[s.brand, { color: colors.side_active_text }]}>FINESSE</Text>
              <Text style={[s.tagline, { color: colors.side_muted }]}>CAMPUS FINANCE</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Switch theme" hitSlop={8} onPress={toggle} style={s.barBtn}>
              <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.side_text} />
            </Pressable>
          </View>
        </View>

        <View style={{ flex: 1, backgroundColor: colors.bg_secondary, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', paddingBottom: insets.bottom }}>
          <InShellContext.Provider value>{children}</InShellContext.Provider>
          {/* Invisible on purpose: tapping the page closes the menu, but no tint, so the active tab and the page stay one colour. */}
          {open ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={closeMenu} style={StyleSheet.absoluteFill} />
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

function Menu({ W, items, active, onSelect, onSignOut }: { W: number; items: NavItem[]; active?: NavItem; onSelect: (i: NavItem) => void; onSignOut: () => void }) {
  const { colors, isDark, toggle } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: W, backgroundColor: colors.side_bg, paddingTop: insets.top + 14, paddingBottom: insets.bottom }}>
      <View style={{ paddingHorizontal: 32, paddingBottom: SPACING.sm }}>
        <Text style={[s.brand, { color: colors.side_active_text, fontSize: 21 }]}>FINESSE</Text>
        <Text style={[s.tagline, { color: colors.side_muted, marginTop: 6 }]}>CAMPUS FINANCE</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: NOTCH + 8, paddingLeft: MENU_INSET, gap: 8 }} showsVerticalScrollIndicator={false}>
        {items.map((item) => {
          const on = item.href === active?.href;
          return (
            <Pressable
              key={item.href}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: on }}
              onPress={() => onSelect(item)}
              style={({ pressed }) => [
                s.item,
                on
                  ? { backgroundColor: colors.bg_secondary, marginRight: 0 }
                  : { marginRight: 22, backgroundColor: pressed ? colors.side_hover : 'transparent' },
              ]}
            >
              {on ? <Notch position="top" color={colors.bg_secondary} /> : null}
              {on && isDark ? <TabOutline width={W - MENU_INSET} color="rgba(43,168,191,0.7)" /> : null}
              <Ionicons name={item.icon} size={20} color={on ? colors.accent_teal_lt : colors.side_muted} />
              <Text style={{ fontFamily: on ? FONTS.bold : FONTS.body, fontSize: 15, color: on ? colors.accent_teal_lt : colors.side_muted }}>{item.label}</Text>
              {on ? <Notch position="bottom" color={colors.bg_secondary} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.side_line, paddingHorizontal: 32, paddingTop: 16, paddingBottom: 14 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONTS.bold, fontSize: 14, color: colors.side_text }}>{user?.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: FONTS.body, fontSize: 12, color: colors.side_muted, marginTop: 2 }}>{user?.email}</Text>
        <Text style={{ fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 2.5, color: colors.side_accent, marginTop: 8, textTransform: 'uppercase' }}>{user?.role}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Switch theme" onPress={toggle} style={[s.chip, { width: 44, borderColor: colors.side_line }]}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={18} color={colors.side_text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onSignOut} style={[s.chip, { flex: 1, borderColor: colors.side_line, flexDirection: 'row', gap: 8 }]}>
            <Ionicons name="log-out-outline" size={18} color={colors.side_text} />
            <Text style={{ fontFamily: FONTS.button, fontSize: 11, letterSpacing: 1, color: colors.side_text, textTransform: 'uppercase' }}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** One of the two concave curves that join the active tab to the page panel (the web's box-shadow trick, drawn as a shape). */
function Notch({ position, color }: { position: 'top' | 'bottom'; color: string }) {
  const d = position === 'top' ? `M${NOTCH} 0 L${NOTCH} ${NOTCH} L0 ${NOTCH} A${NOTCH} ${NOTCH} 0 0 0 ${NOTCH} 0 Z` : `M${NOTCH} ${NOTCH} L${NOTCH} 0 L0 0 A${NOTCH} ${NOTCH} 0 0 1 ${NOTCH} ${NOTCH} Z`;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 0, [position]: -NOTCH }}>
      <Svg width={NOTCH} height={NOTCH} viewBox={`0 0 ${NOTCH} ${NOTCH}`}><Path d={d} fill={color} /></Svg>
    </View>
  );
}

/** Dark mode: a lighter teal line traces the active tab and its two curves so it stands out (the web's --nav-edge). */
function TabOutline({ width: R, color }: { width: number; color: string }) {
  const r = TAB_H / 2;
  const H = TAB_H + NOTCH * 2;
  const d = `M${R} 0 A${NOTCH} ${NOTCH} 0 0 1 ${R - NOTCH} ${NOTCH} L${r} ${NOTCH} A${r} ${r} 0 0 0 ${r} ${NOTCH + TAB_H} L${R - NOTCH} ${NOTCH + TAB_H} A${NOTCH} ${NOTCH} 0 0 1 ${R} ${H}`;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: -NOTCH }}>
      <Svg width={R} height={H} viewBox={`0 0 ${R} ${H}`}><Path d={d} stroke={color} strokeWidth={1.2} fill="none" /></Svg>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  barBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: FONTS.display, fontSize: 18, letterSpacing: 3 },
  tagline: { fontFamily: FONTS.body, fontSize: 8, letterSpacing: 2.6 },
  item: { height: TAB_H, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 22, borderTopLeftRadius: TAB_H / 2, borderBottomLeftRadius: TAB_H / 2 },
  chip: { height: 40, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
