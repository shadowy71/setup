import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { submitResource } from '@/lib/actions/campus';
import { BRANCHES, YEARS, SEMESTERS, RESOURCE_TYPES, LIMITS } from '@/lib/constants';

export const metadata = { title: 'Submit a resource' };

/** Submit a resource (spec §34). Safe external URLs only; staff approve official ones. */
export default async function NewResourcePage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'submit_resources')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Submit a resource" back={{ href: '/explore/resources', label: 'Resources' }} />
        <Notice tone="warning" icon="lock">Your account cannot submit resources right now.</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Submit a resource"
        description="A public link to notes, a paper or reference material. Nothing is hosted on Campus+."
        back={{ href: '/explore/resources', label: 'Resources' }}
      />
      <ActionForm
        action={submitResource}
        submitLabel="Submit for review"
        successMessage="Submitted. Staff review community submissions before they are published."
        redirectTo="/explore/resources"
        resetOnSuccess={false}
        cancelHref="/explore/resources"
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: LIMITS.resource.title.max },
          { name: 'url', label: 'Link', required: true, placeholder: 'https://…', hint: 'Must be a public https link. Nothing is downloaded or re-hosted.' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: LIMITS.resource.description.max },
          { name: 'type', label: 'Type', type: 'select', required: true, defaultValue: RESOURCE_TYPES[0]?.value || 'notes', options: RESOURCE_TYPES.map((type) => ({ value: type.value, label: type.label })) },
          { name: 'branch', label: 'Branch', type: 'select', options: BRANCHES.map((branch) => ({ value: branch, label: branch })) },
          { name: 'year', label: 'Year', type: 'select', options: YEARS.map((year) => ({ value: year, label: year })) },
          { name: 'semester', label: 'Semester', type: 'select', options: SEMESTERS.map((semester) => ({ value: semester, label: semester })) },
          { name: 'subject', label: 'Subject', maxLength: 120 },
        ]}
      />
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Contribution policy</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-2xs text-muted">
          <li>Share links you have the right to share — no pirated material or paywalled content.</li>
          <li>Resources are text-first: a working link plus a short note about what it is.</li>
          <li>Student submissions stay labelled community — staff approval never makes them official.</li>
          <li>Flag broken or inappropriate entries with the report link on the resource page.</li>
        </ul>
      </Card>
    </div>
  );
}
