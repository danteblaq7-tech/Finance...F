import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthProvider';
import { homeFor } from '@/lib/nav';

/** The app's "/" entry: send each person to the right home screen for their role. */
export default function Index() {
  const { user } = useAuth();
  const href = !user ? '/login' : homeFor(user.role);
  return <Redirect href={href} />;
}
