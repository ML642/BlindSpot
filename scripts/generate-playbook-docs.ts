import fs from 'node:fs/promises';
import { PLAYBOOK_LIST } from '@blindspot/playbooks';
import { profiles } from '@blindspot/shared';

const dir = new URL('../packages/playbooks/playbooks/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
for (const entry of await fs.readdir(dir)) {
  if (entry.endsWith('.md') && !PLAYBOOK_LIST.some(playbook => `${playbook.id}.md` === entry)) await fs.rm(new URL(entry, dir));
}
for (const playbook of PLAYBOOK_LIST) {
  const profile = profiles.find(item => item.id === playbook.id);
  const perspective = playbook.perspective;
  const lines = [
    `# ${playbook.name}`, '',
    `Profile: \`${playbook.id}\` · ${playbook.group}`, '',
    playbook.description, '',
    '## Perspective', '',
    `Journey: **${perspective.interaction}**. ${profile?.lens ?? ''}`.trim(), '',
    perspective.persona, '',
    perspective.forbidden, '',
    `Evidence channels: ${perspective.channels.join(', ')}.`,
    ...(perspective.renderings.length ? ['', `Additional renderings per page state: ${perspective.renderings.join(', ')}.`] : []), '',
    '## Agent instructions', '',
    playbook.prompt, '',
    '## Procedure and evidence', '',
  ];
  for (const check of playbook.checks) {
    lines.push(`### ${check.title}`, '', check.purpose, '', `Method: ${check.method}. Record the page-state identifier, the element as it appears in the perspective's evidence, the measured value or exact observation, and the cited evidence. Mark unexecuted checks blocked; interpretive checks need review.`, '');
    for (const ref of check.wcag) lines.push(`- [${ref.id} — ${ref.title}](${ref.url})`);
    if (check.wcag.length) lines.push('');
  }
  lines.push(
    '## Result policy', '',
    'Use `fail` only for verified checker violations; use `needs_review` for model interpretation or unverified exceptions. A passing rule does not establish profile-wide or WCAG conformance. Conditions such as disability or sensory sensitivity are test perspectives, not diagnoses of the user.', '',
    'The typed execution catalog is maintained in `src/playbooks.ts`; regenerate this file with `npm run docs:playbooks` after changing it.', '',
  );
  await fs.writeFile(new URL(`${playbook.id}.md`, dir), lines.join('\n'));
}
console.log(`Wrote ${PLAYBOOK_LIST.length} playbook documents.`);
