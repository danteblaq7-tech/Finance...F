import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Spinner } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { RADIUS, SPACING } from '@/theme/theme';

/**
 * Live camera that reads QR codes and reports each one through onCode (the screen decides what to do and ignores repeats).
 * The camera only runs while the screen is on show, so it never keeps the lens open in the background.
 */
export function CardScanner({ onCode, paused = false }: { onCode: (text: string) => void; paused?: boolean }) {
  const { colors } = useTheme();
  const [permission, askPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));

  if (!permission) return <Spinner label="Starting camera…" />;
  if (!permission.granted) {
    return (
      <Card style={{ alignItems: 'center', gap: SPACING.sm }}>
        <Ionicons name="camera-outline" size={28} color={colors.text_secondary} />
        <AppText variant="muted" style={{ textAlign: 'center' }}>
          {permission.canAskAgain ? 'Finesse needs the camera to read exam-card QR codes.' : 'Camera access is switched off. Turn it on for Finesse in your phone settings.'}
        </AppText>
        {permission.canAskAgain ? <Button title="Allow camera" onPress={() => void askPermission()} /> : null}
        <AppText variant="muted" style={{ fontSize: 12, textAlign: 'center' }}>You can still paste a card code below.</AppText>
      </Card>
    );
  }
  return (
    <View style={{ height: 270, borderRadius: RADIUS.lg, overflow: 'hidden', backgroundColor: '#000' }}>
      {focused ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={paused ? undefined : ({ data }) => onCode(data)}
        />
      ) : null}
      <View pointerEvents="none" style={{ position: 'absolute', top: 32, bottom: 32, left: 32, right: 32, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)' }} />
    </View>
  );
}
