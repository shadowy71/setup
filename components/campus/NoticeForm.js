import { ActionForm } from '@/components/forms/ActionForm';
import { saveNotice } from '@/lib/actions/campus';
import { NOTICE_CATEGORIES } from '@/lib/constants';
export function NoticeForm({ notice = null, username = null }) {
  return <ActionForm action={saveNotice} noticeAttachments={!notice ? username : null} hidden={notice ? { id: notice.id } : {}} resetOnSuccess={false} cancelHref="/campus/noticeboard/manage" fields={[
    { name: 'title', label: 'Title', required: true, maxLength: 140, defaultValue: notice?.title || '' },
    { name: 'body', label: 'Notice', type: 'textarea', required: true, maxLength: 4000, defaultValue: notice?.body || '' },
    { name: 'category', label: 'Category', type: 'select', required: true, options: NOTICE_CATEGORIES, defaultValue: notice?.category || 'general' },
    { name: 'importance', label: 'Importance', type: 'select', options: ['low','normal','high','critical'].map((value) => ({ value, label: value })), defaultValue: notice?.importance || 'normal' },
    { name: 'expires_at', label: 'Expires', type: 'date', defaultValue: notice?.expires_at?.slice(0, 10) || '' },
    { name: 'pinned', label: 'Pin notice', type: 'checkbox', defaultChecked: notice?.pinned === true },
    { name: 'status', label: 'Status', type: 'select', options: ['draft','published','archived'].map((value) => ({ value, label: value })), defaultValue: notice?.status || 'published' },
  ]} />;
}
