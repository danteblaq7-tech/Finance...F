import { Tabs } from 'expo-router';
import { tabIcon } from '@/components/TabIcon';
import { useNavOptions } from '@/theme/navOptions';

export default function StudentTabs() {
  const nav = useNavOptions();
  return (
    <Tabs screenOptions={nav.tabs}>
      <Tabs.Screen name="tickets" options={{ title: 'Tickets', tabBarIcon: tabIcon('chatbubbles-outline') }} />
      <Tabs.Screen name="exam" options={{ title: 'Exam Card', tabBarIcon: tabIcon('card-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person-outline') }} />
    </Tabs>
  );
}
