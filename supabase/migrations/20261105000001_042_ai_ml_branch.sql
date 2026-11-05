-- Rename only complete, structured branch values. Identifiers, divisions,
-- permissions, free text, subjects and historical migrations remain intact.
-- Text columns have only length checks; no enum or foreign key is involved.
-- Normalized spellings cover historic selector values and common variants.
update public.profiles
set branch = 'AI & ML'
where regexp_replace(lower(branch), '[^a-z0-9]', '', 'g') in (
  'aids', 'aiandds', 'aidatascience', 'aianddatascience',
  'artificialintelligencedatascience', 'artificialintelligenceanddatascience',
  'aiml', 'aiandml', 'aimachinelearning', 'aiandmachinelearning',
  'artificialintelligencemachinelearning', 'artificialintelligenceandmachinelearning'
) and branch <> 'AI & ML';

update public.communities
set branch = 'AI & ML'
where regexp_replace(lower(branch), '[^a-z0-9]', '', 'g') in (
  'aids', 'aiandds', 'aidatascience', 'aianddatascience',
  'artificialintelligencedatascience', 'artificialintelligenceanddatascience',
  'aiml', 'aiandml', 'aimachinelearning', 'aiandmachinelearning',
  'artificialintelligencemachinelearning', 'artificialintelligenceandmachinelearning'
) and branch <> 'AI & ML';

update public.official_resources
set branch = 'AI & ML'
where regexp_replace(lower(branch), '[^a-z0-9]', '', 'g') in (
  'aids', 'aiandds', 'aidatascience', 'aianddatascience',
  'artificialintelligencedatascience', 'artificialintelligenceanddatascience',
  'aiml', 'aiandml', 'aimachinelearning', 'aiandmachinelearning',
  'artificialintelligencemachinelearning', 'artificialintelligenceandmachinelearning'
) and branch <> 'AI & ML';

update public.study_partner_posts
set branch = 'AI & ML'
where regexp_replace(lower(branch), '[^a-z0-9]', '', 'g') in (
  'aids', 'aiandds', 'aidatascience', 'aianddatascience',
  'artificialintelligencedatascience', 'artificialintelligenceanddatascience',
  'aiml', 'aiandml', 'aimachinelearning', 'aiandmachinelearning',
  'artificialintelligencemachinelearning', 'artificialintelligenceandmachinelearning'
) and branch <> 'AI & ML';
