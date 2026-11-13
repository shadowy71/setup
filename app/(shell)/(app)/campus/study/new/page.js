import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { PageHeader, Notice, Card } from '@/components/ui';
import { StudyPostForm } from '@/components/study/StudyPostForm';

export const metadata = { title: 'Post a study request' };

/** Publish an opt-in study partner request. Nothing is listed until posted. */
export default async function NewStudyPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'create_study_posts')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Post a study request" back={{ href: ROUTES.study, label: 'Study finder' }} />
        <Notice tone="warning" icon="lock">Your account cannot post study requests right now.</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Post a study request"
        description="Say what you want to study and roughly when you are free."
        back={{ href: ROUTES.study, label: 'Study finder' }}
      />
      <Card className="p-4 text-[0.8125rem] leading-relaxed text-muted">
        <strong className="text-ink">Stay coarse, stay safe.</strong> Share your subject and rough
        availability — never exact meeting times, room numbers, phone numbers or links to personal
        calendars. Interested students message you here on Campus+, and you can close the request
        any time.
      </Card>
      <StudyPostForm />
    </div>
  );
}
