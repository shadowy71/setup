import { ActionForm } from '@/components/forms/ActionForm';
import { saveProfileAchievement } from '@/lib/actions/achievements';
export function AchievementForm({ item = null }) {
  return <ActionForm action={saveProfileAchievement} hidden={item ? { id: item.id } : {}} resetOnSuccess={false} cancelHref="/profile" fields={[
    { name: 'title', label: 'Achievement', required: true, maxLength: 140, defaultValue: item?.title || '' },
    { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 1000, defaultValue: item?.description || '' },
    { name: 'category', label: 'Category', type: 'select', required: true, defaultValue: item?.category || 'other', options: ['academic','competition','community','creative','sport','other'].map((value) => ({ value, label: value })) },
    { name: 'achieved_on', label: 'Date (optional)', type: 'date', defaultValue: item?.achieved_on || '' },
  ]} />;
}
