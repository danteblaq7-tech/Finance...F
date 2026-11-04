import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthProvider';

/** The app's "/" entry: send each person to the right home screen for their role. */
export default function Index() {
  const { user } = useAuth();
  const href = !user ? '/login' : user.role === 'student' ? '/tickets' : '/queue';
  return <Redirect href={href} />;
}
