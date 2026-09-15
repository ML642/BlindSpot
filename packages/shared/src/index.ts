import { z } from 'zod';

export const profiles = [
 { id: 'blindness', name: 'Blindness', group: 'Vision', description: 'Screen readers, semantics, labels and reading order.' },
 { id: 'low-vision', name: 'Low vision', group: 'Vision', description: 'Contrast, text resizing, zoom and responsive reflow.' },
 { id: 'color-vision', name: 'Color vision', group: 'Vision', description: 'Information that does not depend on color alone.' },
 { id: 'deafness', name: 'Deafness', group: 'Hearing', description: 'Captions, transcripts and visual notifications.' },
 { id: 'hard-of-hearing', name: 'Hard of hearing', group: 'Hearing', description: 'Information available independently of audio volume.' },
 { id: 'motor', name: 'Motor & dexterity', group: 'Movement', description: 'Keyboard access, generous targets and alternatives to dragging.' },
 { id: 'paralysis', name: 'Limited limb movement', group: 'Movement', description: 'Keyboard, switch and voice-control compatibility.' },
 { id: 'tremors', name: 'Tremors', group: 'Movement', description: 'Target spacing, forgiving actions and hover alternatives.' },
 { id: 'cognitive', name: 'Cognitive disabilities', group: 'Cognition', description: 'Clear instructions, predictable flows and helpful errors.' },
 { id: 'dyslexia', name: 'Learning & dyslexia', group: 'Cognition', description: 'Readable content, hierarchy and low memory demands.' },
 { id: 'adhd', name: 'Attention & ADHD', group: 'Cognition', description: 'Clear tasks, preserved progress and fewer distractions.' },
 { id: 'memory', name: 'Memory impairments', group: 'Cognition', description: 'Visible context, copy/paste and autofill support.' },
 { id: 'autism', name: 'Sensory sensitivities', group: 'Sensory', description: 'Predictable interactions without unexpected sensory load.' },
 { id: 'photosensitive', name: 'Photosensitivity', group: 'Sensory', description: 'Flashing content and seizure-related risks.' },
 { id: 'vestibular', name: 'Motion sensitivity', group: 'Sensory', description: 'Reduced motion and alternatives to forced movement.' },
 { id: 'temporary', name: 'Temporary impairments', group: 'Context', description: 'Short-term limitations such as an injury or migraine.' },
] as const;
export type ProfileId = typeof profiles[number]['id'];
export const profileIds = profiles.map(p => p.id) as [ProfileId, ...ProfileId[]];
export const auditRequestSchema = z.object({
 url: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS URL'),
 scenario: z.string().trim().min(10).max(2000),
 profileIds: z.array(z.enum(profileIds)).min(1).max(profiles.length).transform(ids => [...new Set(ids)]),
});
export type AuditRequest = z.infer<typeof auditRequestSchema>;
export type AuditStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type TestStatus = 'pass' | 'fail' | 'needs_review' | 'not_applicable' | 'blocked';
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';
export interface Evidence { id: string; type: 'screenshot' | 'dom' | 'accessibility' | 'measurement' | 'axe'; artifactId?: string; description: string; selector?: string; value?: string; }
export interface PageState { id: string; url: string; title: string; capturedAt: string; screenshotArtifactId?: string; domArtifactId?: string; accessibilityArtifactId?: string; description: string; }
export interface Finding { id: string; title: string; description: string; impact: string; severity: Severity; profileIds: ProfileId[]; pageStateId: string; selector?: string; evidence: Evidence[]; reproduction: string[]; recommendation: string; wcag: { id: string; title: string; url: string }[]; method: 'tool' | 'gemini'; status: 'fail' | 'needs_review'; }
export interface PlaybookResult { profileId: ProfileId; status: TestStatus; summary: string; checks: { id: string; title: string; status: TestStatus; method: 'tool' | 'gemini'; evidenceIds: string[]; notes: string }[]; }
export interface AuditEvent { id: number; timestamp: string; type: 'status' | 'navigation' | 'tool' | 'profile' | 'warning' | 'error'; message: string; profileId?: ProfileId; pageStateId?: string; }
export interface AuditReport { summary: string; scenarioOutcome: 'completed' | 'blocked' | 'partial'; findings: Finding[]; profiles: PlaybookResult[]; limitations: string[]; evidence?: Evidence[]; }
export interface Audit { id: string; request: AuditRequest; status: AuditStatus; createdAt: string; updatedAt: string; progress: { phase: string; completedProfiles: number; totalProfiles: number }; pageStates: PageState[]; report?: AuditReport; error?: string; demo?: boolean; }
export const terminalStatuses: AuditStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

export type FindingDisposition = 'confirmed' | 'review' | 'suggestion' | 'unverified';
/** Certainty is independent of severity. Legacy agent opinions stay unverified. */
export function findingDisposition(finding: Finding): FindingDisposition {
  if (!finding.evidence.length) return 'unverified';
  if (finding.status === 'fail' && finding.method === 'tool') return 'confirmed';
  if (finding.disposition === 'unverified') return 'unverified';
  if (finding.method === 'tool' && ['Heading hierarchy skips a level', 'Positive tabindex can disrupt focus order', 'Heading levels should only increase by one', 'Elements should not have tabindex greater than zero'].includes(finding.title)) return 'suggestion';
  if (finding.method === 'tool' && finding.title === 'Animated content needs motion review') return 'unverified';
  if (finding.disposition === 'suggestion') return 'suggestion';
  if (finding.method === 'tool' || finding.observation?.trim()) return 'review';
  return 'unverified';
}

export interface Finding {
  disposition?: 'review' | 'suggestion' | 'unverified';
  /** Specific observed condition, not simply a reference to a screenshot. */
  observation?: string;
}

/** Explain common scanner messages without hiding the original technical result. */
export function findingCopy(finding: Finding) {
  const copy: Record<string, { title: string; impact: string; recommendation: string }> = {
    'Buttons must have discernible text': { title: 'A button has no accessible name', impact: 'A screen-reader user may hear “button” without knowing what it does.', recommendation: 'Give this button a name that describes its action, preferably with visible text. Verify the name in the accessibility tree.' },
    'Elements must meet minimum color contrast ratio thresholds': { title: 'Text contrast is too low', impact: 'People with low vision may struggle to read this text against its background.', recommendation: 'Adjust the text or background color to meet the contrast threshold recorded in the evidence, then check it again.' },
    'Form elements must have labels': { title: 'A form field has no accessible label', impact: 'A screen-reader user may not know what information this field expects.', recommendation: 'Associate a descriptive label with the field. Keep the instructions visible while the user types.' },
    'Links must have discernible text': { title: 'A link has no accessible name', impact: 'A screen-reader user may not know where this link leads.', recommendation: 'Give the link a descriptive accessible name that explains its destination.' },
  };
  return copy[finding.title] ?? finding;
}
