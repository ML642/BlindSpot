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
 { id: 'speech', name: 'Speech impairments', group: 'Communication', description: 'Alternatives to voice-only interactions.' },
 { id: 'cognitive', name: 'Cognitive disabilities', group: 'Cognition', description: 'Clear instructions, predictable flows and helpful errors.' },
 { id: 'dyslexia', name: 'Learning & dyslexia', group: 'Cognition', description: 'Readable content, hierarchy and low memory demands.' },
 { id: 'adhd', name: 'Attention & ADHD', group: 'Cognition', description: 'Clear tasks, preserved progress and fewer distractions.' },
 { id: 'memory', name: 'Memory impairments', group: 'Cognition', description: 'Visible context, copy/paste and autofill support.' },
 { id: 'autism', name: 'Sensory sensitivities', group: 'Sensory', description: 'Predictable interactions without unexpected sensory load.' },
 { id: 'photosensitive', name: 'Photosensitivity', group: 'Sensory', description: 'Flashing content and seizure-related risks.' },
 { id: 'vestibular', name: 'Motion sensitivity', group: 'Sensory', description: 'Reduced motion and alternatives to forced movement.' },
 { id: 'temporary', name: 'Temporary impairments', group: 'Context', description: 'Short-term limitations such as an injury or migraine.' },
 { id: 'situational', name: 'Situational limitations', group: 'Context', description: 'One-handed use, muted audio and difficult environments.' },
] as const;
export type ProfileId = typeof profiles[number]['id'];
export const profileIds = profiles.map(p => p.id) as [ProfileId, ...ProfileId[]];
export const auditRequestSchema = z.object({
 url: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS URL'),
 scenario: z.string().trim().min(10).max(2000),
 profileIds: z.array(z.enum(profileIds)).min(1).max(18).transform(ids => [...new Set(ids)]),
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
