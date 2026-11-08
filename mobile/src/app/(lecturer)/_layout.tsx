import { Stack } from 'expo-router';

// Lecturers: no finance screens. Their tool is the card scanner in the Finesse web app (works in a phone browser).
export default function LecturerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
