import { View } from 'react-native';
import { AppText } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import type { MyUnit } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { RADIUS, SPACING } from '@/theme/theme';

/**
 * The student's units as a checklist. A unit ticks itself the moment a lecturer scans the card for it
 * (the screen refreshes live, see lib/realtime.ts). Units the student may not sit show why.
 */
export function UnitChecklist({ units }: { units: MyUnit[] }) {
  const { colors } = useTheme();
  if (units.length === 0) {
    return (
      <View style={{ marginBottom: SPACING.sm }}>
        <AppText variant="label">Your units</AppText>
        <AppText variant="muted" style={{ fontSize: 11 }}>No units are registered for you in this exam period yet. If that looks wrong, ask your department or the finance office.</AppText>
      </View>
    );
  }
  const sat = units.filter((u) => u.signed_at).length;
  const eligible = units.filter((u) => u.allowed || u.signed_at).length;
  return (
    <View accessibilityLabel="Your units" style={{ marginBottom: SPACING.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <AppText variant="label">Your units</AppText>
        <AppText variant="bold" style={{ fontSize: 12 }}>{sat} of {eligible} sat</AppText>
      </View>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.md, overflow: 'hidden' }}>
        {units.map((u, i) => {
          const state = u.signed_at ? 'sat' : u.allowed ? 'todo' : 'barred';
          const tone = state === 'sat' ? colors.accent_green : state === 'barred' ? colors.accent_red : colors.text_muted;
          const when = [u.exam_date ? formatDate(u.exam_date) : '', u.start_time?.slice(0, 5) ?? '', u.venue ?? ''].filter(Boolean).join(' · ');
          return (
            <View
              key={u.id}
              accessibilityLabel={`${u.unit_code} ${u.unit_name}, ${state === 'sat' ? 'sat' : state === 'barred' ? 'not allowed' : 'not yet'}`}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, padding: SPACING.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: tone, backgroundColor: state === 'todo' ? 'transparent' : tone, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <AppText style={{ color: '#fff', fontSize: 12, lineHeight: 14 }}>{state === 'sat' ? '✓' : state === 'barred' ? '✕' : ''}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 12 }}><AppText variant="bold" style={{ fontSize: 12 }}>{u.unit_code}</AppText> {u.unit_name}</AppText>
                {when ? <AppText variant="muted" style={{ fontSize: 11 }}>{when}</AppText> : null}
              </View>
              <View style={{ alignItems: 'flex-end', maxWidth: '40%' }}>
                <AppText variant="bold" style={{ fontSize: 11, color: tone }}>{state === 'sat' ? 'Sat' : state === 'barred' ? 'Not allowed' : 'Not yet'}</AppText>
                {state === 'sat' ? <AppText variant="muted" style={{ fontSize: 10 }}>{formatDateTime(u.signed_at)}</AppText> : null}
                {state === 'barred' && u.block_reason ? <AppText style={{ fontSize: 10, color: tone }}>{u.block_reason}</AppText> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
