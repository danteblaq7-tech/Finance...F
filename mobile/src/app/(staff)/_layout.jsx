import { Tabs } from 'expo-router';
import { tabIcon } from '@/components/TabIcon';
import { useNavOptions } from '@/theme/navOptions';

// Route names differ from the student group's ("account" vs "profile') because group names
// don't appear in URLs: two groups must never define the same path.
export default function StaffTabs() {
  const nav = useNavOptions();
  return (
    <Tabs screenOptions={nav.tabs}>
      <Tabs.Screen name="queue" options={{ title: 'Queue', tabBarIcon: tabIcon('file-tray-full-outline') }} />
      <Tabs.Screen name="applications" options={{ title: 'Exam Cards', tabBarIcon: tabIcon('school-outline') }} />
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: tabIcon('cash-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: tabIcon('person-circle-outline') }} />
    </Tabs>
  );
}
