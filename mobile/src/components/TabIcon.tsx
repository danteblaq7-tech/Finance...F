import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Tab bar icon factory. React Navigation types the colour loosely; at runtime it is always a string. */
export function tabIcon(name: IconName) {
  function TabBarIcon({ color, size }: { color: unknown; size: number }) {
    return <Ionicons name={name} size={size} color={color as string} />;
  }
  return TabBarIcon;
}
