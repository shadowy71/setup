import { notFound } from 'next/navigation';
import { OnboardingForm } from '@/components/auth/OnboardingForm';
import '@/app/styles/login.css';
import '@/app/styles/onboarding.css';

export const metadata = { title: 'Onboarding preview', robots: { index: false, follow: false } };
export default function OnboardingPreview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <OnboardingForm preview />;
}
