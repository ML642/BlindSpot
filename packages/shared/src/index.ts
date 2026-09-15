import { z } from 'zod';

/** How the navigation agent operates the browser during a journey. */
export const interactionModes = ['screen-reader', 'keyboard', 'pointer'] as const;
export type InteractionMode = typeof interactionModes[number];

/**
 * Impairment profiles are grouped by how a person perceives and operates a page,
 * because that decides what evidence the agent is allowed to use.
 */
export const profiles = [
  { id: 'blindness', name: 'Blindness', group: 'Vision', interaction: 'screen-reader', description: 'Screen reader and keyboard only; the agent never sees the screen or the code.', lens: 'Screen-reader speech and a keyboard. No screenshots, HTML or CSS selectors.' },
  { id: 'low-vision', name: 'Low vision', group: 'Vision', interaction: 'pointer', description: 'Magnification, contrast, reflow and text spacing.', lens: 'Screenshots, blurred and reduced-contrast simulations, measured contrast and page code.' },
  { id: 'color-vision', name: 'Color vision deficiency', group: 'Vision', interaction: 'pointer', description: 'Information that must not depend on color alone.', lens: 'Screenshots rendered with protanopia, deuteranopia, tritanopia and achromatopsia, plus page code.' },
  { id: 'deafness', name: 'Deaf and hard of hearing', group: 'Hearing', interaction: 'pointer', description: 'Captions, transcripts and visual alternatives to sound.', lens: 'Screenshots, a media inventory and page code. No audio is available.' },
  { id: 'motor', name: 'Motor and dexterity', group: 'Movement', interaction: 'keyboard', description: 'Keyboard-only operation, target size, and no dragging or tight timing.', lens: 'Screenshots with the keyboard focus trace, measured target sizes and page code. The agent never uses a mouse.' },
  { id: 'cognitive', name: 'Cognitive, learning and attention', group: 'Cognition', interaction: 'pointer', description: 'Plain language, predictable flows, memory support and helpful errors.', lens: 'Screenshots and visible text only, as a sighted person without code access.' },
  { id: 'motion', name: 'Motion and flashing sensitivity', group: 'Sensory', interaction: 'pointer', description: 'Animation, autoplay, flashing and reduced-motion support.', lens: 'Screenshots, an inventory of running animations, reduced-motion measurements and page code.' },
] as const;
export type ProfileId = typeof profiles[number]['id'];
export const profileIds = profiles.map(p => p.id) as [ProfileId, ...ProfileId[]];
export function profileInteraction(profileId: ProfileId): InteractionMode {
  return profiles.find(profile => profile.id === profileId)?.interaction ?? 'pointer';
}
export const auditRequestSchema = z.object({
 url: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS URL'),
 scenario: z.string().trim().min(10).max(2000),
 profileIds: z.array(z.enum(profileIds)).min(1).max(profiles.length).transform(ids => [...new Set(ids)]),
});
export type AuditRequest = z.infer<typeof auditRequestSchema>;
export type AuditStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type TestStatus = 'pass' | 'fail' | 'needs_review' | 'not_applicable' | 'blocked';
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';
export type EvidenceType = 'screenshot' | 'dom' | 'accessibility' | 'measurement' | 'axe' | 'speech' | 'focus' | 'simulation' | 'media' | 'motion';
export interface Evidence { id: string; type: EvidenceType; artifactId?: string; description: string; selector?: string; value?: string; }
export interface SimulationArtifact { kind: string; artifactId: string; description: string; }
export interface PageState {
  id: string; url: string; title: string; capturedAt: string; description: string;
  /** Which journey captured this state; specialists only see states from their own journey. */
  journey: InteractionMode;
  screenshotArtifactId?: string; domArtifactId?: string; accessibilityArtifactId?: string;
  /** Compressed, height-capped JPEG of the state used for model review; the PNG stays for people. */
  previewArtifactId?: string;
  /** Full screen-reader read-through of the state (screen-reader journeys). */
  speechArtifactId?: string;
  /** Sequential keyboard focus trace with focus-visibility measurements. */
  focusTraceArtifactId?: string;
  simulations?: SimulationArtifact[];
}
export interface Finding { id: string; title: string; description: string; impact: string; severity: Severity; profileIds: ProfileId[]; pageStateId: string; selector?: string; evidence: Evidence[]; reproduction: string[]; recommendation: string; wcag: { id: string; title: string; url: string }[]; method: 'tool' | 'gemini'; status: 'fail' | 'needs_review'; }
export interface PlaybookResult { profileId: ProfileId; status: TestStatus; summary: string; checks: { id: string; title: string; status: TestStatus; method: 'tool' | 'gemini'; evidenceIds: string[]; notes: string }[]; }
export interface AuditEvent { id: number; timestamp: string; type: 'status' | 'navigation' | 'tool' | 'profile' | 'warning' | 'error'; message: string; profileId?: ProfileId; journey?: InteractionMode; pageStateId?: string; }
export interface JourneyStep { turn: number; action: string; detail: string; observation: string; pageStateId?: string; }
export interface JourneySummary { mode: InteractionMode; profileIds: ProfileId[]; outcome: 'completed' | 'blocked' | 'partial'; summary: string; usedGemini: boolean; steps: JourneyStep[]; }
export interface AuditReport { summary: string; scenarioOutcome: 'completed' | 'blocked' | 'partial'; findings: Finding[]; profiles: PlaybookResult[]; limitations: string[]; evidence?: Evidence[]; journeys?: JourneySummary[]; }
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
