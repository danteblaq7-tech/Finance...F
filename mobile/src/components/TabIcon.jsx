import Ionicons from '@expo/vector-icons/Ionicons';

/** Tab bar icon factory. React Navigation types the colour loosely; at runtime it is always a string. */
export function tabIcon(name) {
  function TabBarIcon({ color, size }) {
    return <Ionicons name={name} size={size} color={color} />;
  }
  return TabBarIcon;
}
