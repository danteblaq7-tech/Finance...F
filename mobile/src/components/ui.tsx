import { type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useTheme } from '@/theme/ThemeProvider';
import { FONTS, RADIUS, SPACING } from '@/theme/theme';

type Variant = 'body' | 'title' | 'heading' | 'label' | 'muted' | 'bold';

export function AppText({
  variant = 'body', style, ...rest
}: { variant?: Variant; style?: StyleProp<TextStyle>; children?: ReactNode; numberOfLines?: number; selectable?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles: Record<Variant, TextStyle> = {
    body: { fontFamily: FONTS.body, fontSize: 13, color: colors.text_primary },
    bold: { fontFamily: FONTS.bold, fontSize: 13, color: colors.text_primary },
    muted: { fontFamily: FONTS.body, fontSize: 12, color: colors.text_secondary },
    label: { fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.text_label },
    heading: { fontFamily: FONTS.heading, fontSize: 15, color: colors.text_primary },
    title: { fontFamily: FONTS.heading, fontSize: 20, letterSpacing: 0.5, color: colors.text_primary },
  };
  return <Text {...rest} style={[styles[variant], style]} />;
}

/** Page container: safe area + themed background + optional scroll and pull-to-refresh. */
export function Screen({
  children, scroll = true, onRefresh, refreshing = false, edges = ['top'], padded = true,
}: {
  children: ReactNode; scroll?: boolean; onRefresh?: () => void; refreshing?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[]; padded?: boolean;
}) {
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && { padding: SPACING.md }, { paddingBottom: SPACING.xl }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent_teal_lt} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: SPACING.md }]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg_primary }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <AppText variant="title">{title}</AppText>
        {subtitle ? <AppText variant="muted" style={{ marginTop: 4 }}>{subtitle}</AppText> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { colors } = useTheme();
  const base: ViewStyle = { backgroundColor: colors.bg_secondary, borderColor: colors.border, borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACING.md };
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { borderColor: colors.border_active }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title, onPress, variant = 'primary', loading, disabled, style, testID,
}: { title: string; onPress: () => void; variant?: BtnVariant; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { colors } = useTheme();
  const bg: Record<BtnVariant, string> = { primary: colors.accent_teal, secondary: colors.bg_tertiary, danger: colors.accent_red, ghost: 'transparent' };
  const fg = variant === 'secondary' || variant === 'ghost' ? colors.text_primary : '#FFFFFF';
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn, { backgroundColor: bg[variant], borderColor: variant === 'secondary' ? colors.border : 'transparent', opacity: off ? 0.5 : pressed ? 0.85 : 1 }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : null}
      <Text style={{ color: fg, fontFamily: FONTS.bold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <AppText variant="label" style={{ marginBottom: 6 }}>{label}</AppText>
      {children}
      {hint && !error ? <AppText variant="muted" style={{ marginTop: 4 }}>{hint}</AppText> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.accent_red, fontFamily: FONTS.body, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export function TextField({
  label, error, hint, ...input
}: { label: string; error?: string; hint?: string } & TextInputProps) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <Field label={label} error={error} hint={hint}>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.text_muted}
        {...input}
        onFocus={(e) => { setFocus(true); input.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
        style={[
          s.input,
          { backgroundColor: colors.bg_input, color: colors.text_primary, borderColor: error ? colors.accent_red : focus ? colors.border_active : colors.border },
          input.multiline && { minHeight: 110, textAlignVertical: 'top' },
          input.style,
        ]}
      />
    </Field>
  );
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <View style={{ borderColor: color, backgroundColor: `${color}1F`, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.2 }}>{children}</Text>
    </View>
  );
}

/** Single-select pill group (used instead of a native picker for short enums). */
export function ChipGroup<T extends string>({
  options, value, onChange, disabledValues = [],
}: { options: { label: string; value: T }[]; value: T | ''; onChange: (v: T) => void; disabledValues?: T[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const active = o.value === value;
        const off = disabledValues.includes(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: off }}
            disabled={off}
            onPress={() => onChange(o.value)}
            style={{
              borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 7, opacity: off ? 0.35 : 1,
              borderColor: active ? colors.border_active : colors.border, backgroundColor: active ? `${colors.accent_teal}33` : colors.bg_tertiary,
            }}
          >
            <Text style={{ color: active ? colors.accent_teal_lt : colors.text_secondary, fontFamily: FONTS.bold, fontSize: 11 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="progressbar" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: SPACING.lg }}>
      <ActivityIndicator color={colors.accent_teal_lt} />
      <AppText variant="muted">{label}</AppText>
    </View>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const { colors } = useTheme();
  if (!error) return null;
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <View accessibilityRole="alert" style={{ borderColor: `${colors.accent_red}66`, backgroundColor: `${colors.accent_red}1A`, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.sm + 4, marginBottom: SPACING.md }}>
      <Text style={{ color: colors.accent_red, fontFamily: FONTS.body, fontSize: 12 }}>{msg}</Text>
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed', borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center' }}>
      <AppText variant="muted" style={{ textAlign: 'center' }}>{children}</AppText>
    </View>
  );
}

/** Modal that collects a required note (reason for an override, etc). */
export function NoteModal({
  visible, title, description, confirmLabel, busy, onConfirm, onCancel,
}: { visible: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; onConfirm: (note: string) => void; onCancel: () => void }) {
  const { colors } = useTheme();
  const [note, setNote] = useState('');
  const valid = note.trim().length >= 5;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: SPACING.md }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Card>
            <AppText variant="heading" style={{ marginBottom: 6 }}>{title}</AppText>
            <AppText variant="muted" style={{ marginBottom: SPACING.md }}>{description}</AppText>
            <TextField label="Reason" value={note} onChangeText={setNote} multiline placeholder="At least 5 characters" autoFocus />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Cancel" variant="ghost" onPress={() => { setNote(''); onCancel(); }} />
              <Button title={confirmLabel} loading={busy} disabled={!valid} onPress={() => { onConfirm(note.trim()); setNote(''); }} />
            </View>
          </Card>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.lg, gap: 12 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1,
    borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: SPACING.md, minHeight: 44,
  },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONTS.body, fontSize: 14, minHeight: 44 },
});
