import type { ProfileId } from '@blindspot/shared';
import type { PlaybookDefinition, PlaybookCheckDefinition, WcagReference } from './types.js';
import { WCAG, wcag } from './wcag.js';

const tool = (id: string, title: string, purpose: string, ...refs: WcagReference[]): PlaybookCheckDefinition => ({ id, title, purpose, wcag: refs, method: 'tool' });
const gemini = (id: string, title: string, purpose: string, ...refs: WcagReference[]): PlaybookCheckDefinition => ({ id, title, purpose, wcag: refs, method: 'gemini' });

const commonLimitations = [
  'Automated evidence is a signal for review, not a declaration of WCAG conformance.',
  'The specialist must review screenshots, DOM and accessibility-tree evidence in the context of the requested scenario.',
  'A real screen reader, switch, voice-control system, or assistive technology is not emulated by this audit.',
];

function definition(
  id: ProfileId,
  name: string,
  group: string,
  description: string,
  goal: string,
  checks: PlaybookCheckDefinition[],
  refs: WcagReference[],
  extraLimitations: string[] = [],
): PlaybookDefinition {
  const prompt = `You are the ${name} accessibility specialist.\n\nGoal: ${goal}\n\nReview the supplied page states, screenshots, DOM, accessibility tree, tool output, and user scenario. Assess only evidence that is present. For each issue, explain the user impact, exact state and element, WCAG 2.2 criterion when applicable, and a practical fix. Use needs_review when a real assistive-technology or human judgment is required. Do not infer a pass from missing evidence.\n\nChecks:\n${checks.map(c => `- ${c.title}: ${c.purpose} (${c.wcag.map(r => `${r.id} ${r.title}`).join(', ') || 'best practice'})`).join('\n')}\n\nLimitations:\n${[...commonLimitations, ...extraLimitations].map(x => `- ${x}`).join('\n')}`;
  return { id, name, group, description, prompt, checks, wcag: refs, limitations: [...commonLimitations, ...extraLimitations] };
}

const defs: Record<ProfileId, PlaybookDefinition> = {
  blindness: definition('blindness', 'Blindness', 'Vision', 'Screen readers, semantic structure, labels and reading order.', 'A blind person can understand and complete the scenario with a screen reader and keyboard.', [
    tool('semantic-structure', 'Semantic structure and landmarks', 'Check headings, landmarks, lists, tables and relationships exposed in the DOM.', WCAG.infoRelationships, WCAG.headingsLabels),
    tool('names-and-labels', 'Meaningful names and labels', 'Find images, controls and links without useful accessible names.', WCAG.nonText, WCAG.nameRoleValue, WCAG.labelsInstructions),
    tool('reading-order', 'Logical reading order', 'Compare DOM order with the visual and task order of content.', WCAG.meaningfulSequence, WCAG.focusOrder),
    gemini('screen-reader-flow', 'Screen-reader task flow', 'Review whether announcements, focus, errors and dynamic states make the scenario understandable.', WCAG.statusMessages, WCAG.errorIdentification),
  ], wcag(WCAG.nonText, WCAG.infoRelationships, WCAG.meaningfulSequence, WCAG.nameRoleValue, WCAG.statusMessages)),
  'low-vision': definition('low-vision', 'Low vision', 'Vision', 'Contrast, text resizing, zoom and responsive reflow.', 'A person with partial sight can read and operate the scenario at high zoom and increased text size.', [
    tool('contrast-and-nontext', 'Text and non-text contrast', 'Measure text and UI contrast where tooling provides values, and flag unmeasurable visual states for review.', WCAG.contrastMinimum, WCAG.nonTextContrast),
    tool('reflow', 'Zoom and responsive reflow', 'Inspect narrow viewports, overflow and clipped content; do not treat a narrow viewport as proof of browser zoom.', WCAG.resizeText, WCAG.reflow),
    tool('text-spacing', 'Text spacing resilience', 'Check whether user-applied text spacing causes clipping or overlapping.', WCAG.textSpacing),
    gemini('visual-readability', 'Visual readability', 'Review scale, line length, focus visibility and layout at 200–400% equivalent conditions.', WCAG.resizeText, WCAG.focusAppearance),
  ], wcag(WCAG.contrastMinimum, WCAG.nonTextContrast, WCAG.resizeText, WCAG.reflow, WCAG.textSpacing)),
  'color-vision': definition('color-vision', 'Color vision deficiency', 'Vision', 'Information that does not depend on color alone.', 'A person who cannot distinguish some colors can understand status, errors and controls.', [
    tool('color-only-signals', 'Color-only information', 'Locate likely status and error indicators whose text, icon or pattern alternative needs review.', WCAG.useOfColor, WCAG.errorIdentification),
    tool('contrast', 'Contrast and UI states', 'Measure contrast of text and meaningful controls where available.', WCAG.contrastMinimum, WCAG.nonTextContrast),
    gemini('color-meaning', 'Visual meaning alternatives', 'Review screenshots for red/green-only meanings, charts, focus and selected states.', WCAG.useOfColor),
  ], wcag(WCAG.useOfColor, WCAG.contrastMinimum, WCAG.nonTextContrast)),
  deafness: definition('deafness', 'Deafness', 'Hearing', 'Captions, transcripts and visual notifications.', 'A Deaf user can understand all important audio information and system feedback visually.', [
    tool('media-captions', 'Captions and transcripts', 'Find audio/video without caption tracks or an adjacent transcript; report as a review signal.', WCAG.captionsPrerecorded, WCAG.audioVideoOnly),
    tool('visual-status', 'Visual alternatives for sound', 'Find audio-dependent notifications and inspect status-message alternatives.', WCAG.statusMessages),
    gemini('media-equivalence', 'Equivalent media information', 'Review whether captions and transcripts convey speech, speakers and meaningful sounds.', WCAG.captionsPrerecorded, WCAG.audioDescription),
  ], wcag(WCAG.captionsPrerecorded, WCAG.audioVideoOnly, WCAG.audioDescription, WCAG.statusMessages), ['Caption accuracy, synchronization and completeness require human review.']),
  'hard-of-hearing': definition('hard-of-hearing', 'Hard of hearing', 'Hearing', 'Information available independently of audio volume.', 'A user with reduced hearing can complete the scenario without relying on loudness or subtle sound cues.', [
    tool('captions', 'Captions for media', 'Find media without caption tracks and audio-only content without an alternative.', WCAG.captionsPrerecorded, WCAG.audioVideoOnly),
    tool('audio-control', 'Controllable audio', 'Detect autoplaying media and missing independent audio controls.', WCAG.audioControl),
    gemini('auditory-cues', 'Audio cue alternatives', 'Review whether warnings and confirmations have clear visual or textual equivalents.', WCAG.statusMessages),
  ], wcag(WCAG.captionsPrerecorded, WCAG.audioControl, WCAG.statusMessages)),
  motor: definition('motor', 'Motor and dexterity impairments', 'Movement', 'Keyboard access, generous targets and alternatives to dragging.', 'A user with limited dexterity can complete the scenario without precision, dragging or tight timing.', [
    tool('keyboard-access', 'Keyboard access', 'Inspect focusable controls, tabindex and keyboard-reachable names; runtime traversal is recommended.', WCAG.keyboard, WCAG.noKeyboardTrap),
    tool('target-size', 'Target size and spacing', 'Find actionable targets below 24×24 CSS pixels, excluding applicable exceptions.', WCAG.targetSize),
    tool('dragging', 'Dragging alternatives', 'Identify draggable widgets and request a keyboard or single-pointer alternative.', WCAG.dragging, WCAG.pointerGestures),
    gemini('motor-flow', 'Forgiving interaction flow', 'Review timing, accidental activation, undo and destructive-action spacing.', WCAG.pointerCancellation, WCAG.errorPrevention),
  ], wcag(WCAG.keyboard, WCAG.noKeyboardTrap, WCAG.targetSize, WCAG.dragging, WCAG.pointerCancellation)),
  paralysis: definition('paralysis', 'Limited limb movement', 'Movement', 'Keyboard, switch and voice-control compatibility.', 'A user who cannot use a mouse can operate every action with keyboard, switch-like input or voice control.', [
    tool('keyboard', 'Complete keyboard operation', 'Inspect focusability, visible focus and sequential navigation signals.', WCAG.keyboard, WCAG.focusVisible, WCAG.focusOrder),
    tool('label-in-name', 'Visible labels in accessible names', 'Compare visible button/link text with its accessible name for voice-control compatibility.', WCAG.labelInName),
    tool('no-trap', 'No keyboard traps', 'Inspect dialogs and custom widgets for focus containment signals requiring runtime review.', WCAG.noKeyboardTrap),
    gemini('pointer-independence', 'Pointer-independent completion', 'Review whether any scenario action requires a pointer gesture, hover or precise coordinate.', WCAG.keyboard, WCAG.pointerGestures),
  ], wcag(WCAG.keyboard, WCAG.focusOrder, WCAG.focusVisible, WCAG.labelInName, WCAG.noKeyboardTrap)),
  tremors: definition('tremors', 'Tremors and involuntary movement', 'Movement', 'Target spacing, forgiving actions and hover alternatives.', 'A user with tremors can select controls without accidental activation and recover from mistakes.', [
    tool('target-size', 'Large, separated targets', 'Find very small targets and destructive controls with insufficient separation.', WCAG.targetSize),
    tool('pointer-cancellation', 'Safe activation', 'Review controls for down-event activation signals and lack of cancellation/undo.', WCAG.pointerCancellation),
    tool('hover-only', 'Hover and focus alternatives', 'Find hover-dependent content that may be inaccessible to keyboard and imprecise pointer use.', WCAG.hoverFocusContent),
    gemini('forgiving-errors', 'Forgiving recovery', 'Review confirmation, undo, timing and destructive-action placement.', WCAG.errorPrevention, WCAG.pointerCancellation),
  ], wcag(WCAG.targetSize, WCAG.pointerCancellation, WCAG.hoverFocusContent, WCAG.errorPrevention)),
  cognitive: definition('cognitive', 'Cognitive disabilities', 'Cognition', 'Clear instructions, predictable flows and helpful errors.', 'A user with cognitive disabilities can predict what happens, understand instructions and recover from errors.', [
    tool('labels-errors', 'Labels and error identification', 'Inspect labels, required hints, inline errors and status regions.', WCAG.labelsInstructions, WCAG.errorIdentification, WCAG.errorSuggestion),
    tool('predictable-input', 'Predictable interaction', 'Find input-change handlers and focus-driven navigation signals needing review.', WCAG.onFocus, WCAG.onInput),
    gemini('plain-predictable', 'Plain, predictable task flow', 'Review wording, step order, confirmations, progress and recovery in the supplied scenario.', WCAG.headingsLabels, WCAG.errorPrevention),
  ], wcag(WCAG.labelsInstructions, WCAG.errorIdentification, WCAG.errorSuggestion, WCAG.onFocus, WCAG.onInput)),
  dyslexia: definition('dyslexia', 'Learning disabilities and dyslexia', 'Cognition', 'Readable content, hierarchy and low memory demands.', 'A user with dyslexia can read and follow content with clear structure, plain language and forgiving presentation.', [
    tool('text-structure', 'Readable structure', 'Inspect heading hierarchy, text spacing risks and long unlabelled regions.', WCAG.headingsLabels, WCAG.textSpacing),
    tool('images-of-text', 'Text alternatives to images of text', 'Find image content that appears to convey text without a text alternative.', WCAG.imagesOfText, WCAG.nonText),
    gemini('readability', 'Content readability', 'Review line length, wording, hierarchy and whether instructions require remembering information.', WCAG.headingsLabels, WCAG.labelsInstructions),
  ], wcag(WCAG.headingsLabels, WCAG.textSpacing, WCAG.imagesOfText, WCAG.labelsInstructions), ['WCAG reading-level criterion 3.1.5 is AAA; report readability as a best-practice review unless the user requests AAA.']),
  adhd: definition('adhd', 'Attention limitations and ADHD', 'Cognition', 'Clear tasks, preserved progress and fewer distractions.', 'A user with attention limitations can see the current state, keep progress and finish without avoidable distraction.', [
    tool('motion-signals', 'Motion and animation signals', 'Find moving or animated elements and check whether a reduced-motion rule exists; a human must determine whether Pause, Stop, Hide applies.', WCAG.pauseStopHide),
    tool('status-progress', 'Visible progress and status', 'Inspect status regions and live updates that should preserve context.', WCAG.statusMessages),
    gemini('attention-flow', 'Attention-friendly flow', 'Review distractions, arbitrary timeouts, progress preservation and task-state clarity.', WCAG.onInput, WCAG.statusMessages),
  ], wcag(WCAG.statusMessages, WCAG.hoverFocusContent, WCAG.onInput), ['Timeout adequacy depends on the scenario and cannot be inferred from static DOM alone.']),
  memory: definition('memory', 'Memory impairments', 'Cognition', 'Visible context, copy/paste and autofill support.', 'A user with memory impairments can keep necessary context visible and avoid re-entering or memorizing details.', [
    tool('input-purpose', 'Input purpose and autofill', 'Inspect autocomplete tokens on common personal-data fields.', WCAG.identifyInputPurpose, WCAG.redundantEntry),
    tool('labels-context', 'Persistent labels and context', 'Find unlabeled fields and controls whose context exists only in a prior step.', WCAG.labelsInstructions, WCAG.redundantEntry),
    gemini('memory-flow', 'Memory-supporting flow', 'Review visible summaries, copy/paste, code entry, autofill and repeated-entry demands.', WCAG.redundantEntry, WCAG.accessibleAuth),
  ], wcag(WCAG.identifyInputPurpose, WCAG.labelsInstructions, WCAG.redundantEntry, WCAG.accessibleAuth)),
  autism: definition('autism', 'Autism and sensory sensitivities', 'Sensory', 'Predictable interactions without unexpected sensory load.', 'A user with sensory sensitivities can use predictable controls without unexpected sound, flashing or disruptive motion.', [
    tool('reduced-motion', 'Reduced-motion support', 'Detect animation and whether a prefers-reduced-motion rule is present; this is a review signal.', WCAG.pauseStopHide),
    tool('autoplay', 'Unexpected audio', 'Find autoplaying media and missing audio controls.', WCAG.audioControl),
    gemini('sensory-load', 'Predictability and sensory load', 'Review unexpected sounds, flashing, parallax, modal behavior and changes of context.', WCAG.onFocus, WCAG.onInput),
  ], wcag(WCAG.audioControl, WCAG.onFocus, WCAG.onInput, WCAG.hoverFocusContent)),
  photosensitive: definition('photosensitive', 'Photosensitivity and seizure risk', 'Sensory', 'Flashing content and seizure-related risks.', 'The page does not expose flashing or rapidly changing visual content likely to trigger seizures.', [
    tool('flashing-signals', 'Flashing content signals', 'Find CSS animation and visual elements requiring a temporal-flash review.', WCAG.threeFlashes),
    tool('motion-preference', 'Reduced-motion preference', 'Detect whether a reduced-motion alternative is present for animated content.', WCAG.pauseStopHide),
    gemini('flash-review', 'Temporal and flashing review', 'Review evidence for flashes, rapid transitions and large high-contrast animated regions; do not certify thresholds from static DOM.', WCAG.threeFlashes),
  ], wcag(WCAG.threeFlashes), ['Flash frequency and area thresholds require frame-by-frame or specialist testing; static analysis can only flag candidates.']),
  vestibular: definition('vestibular', 'Vestibular and motion sensitivity', 'Sensory', 'Reduced motion and alternatives to forced movement.', 'A user with motion sensitivity can complete the scenario without forced motion, parallax or disorienting transitions.', [
    tool('reduced-motion', 'prefers-reduced-motion support', 'Detect animation and reduced-motion CSS coverage; report it as a review signal.', WCAG.pauseStopHide),
    tool('forced-movement', 'Motion-triggered interaction', 'Find likely scroll, transform and autoplay motion candidates for review.', WCAG.onFocus, WCAG.onInput),
    gemini('motion-alternative', 'Motion alternatives', 'Review parallax, zooming, spinning, auto-scroll and unexpected viewport movement.', WCAG.pauseStopHide),
  ], wcag(WCAG.pauseStopHide, WCAG.onFocus, WCAG.onInput)),
  temporary: definition('temporary', 'Temporary impairments', 'Context', 'Short-term limitations such as an injury or migraine.', 'A person with a temporary limitation can use the same resilient keyboard, visual, audio and motion alternatives.', [
    tool('keyboard-and-targets', 'Keyboard and target resilience', 'Check keyboard access and minimum targets for one-handed or injured use.', WCAG.keyboard, WCAG.targetSize),
    tool('media-alternatives', 'Independent media alternatives', 'Find audio, video and motion without equivalent controls or text.', WCAG.captionsPrerecorded, WCAG.audioControl),
    gemini('temporary-context', 'Temporary limitation scenario', 'Review the supplied scenario for one-handed, reduced-vision, muted-audio or migraine-friendly completion.', WCAG.keyboard, WCAG.reflow),
  ], wcag(WCAG.keyboard, WCAG.targetSize, WCAG.captionsPrerecorded, WCAG.audioControl, WCAG.reflow)),
};

export const PLAYBOOKS = defs;
export const PLAYBOOK_LIST = Object.values(PLAYBOOKS);
export const PLAYBOOK_IDS = Object.keys(PLAYBOOKS) as ProfileId[];

export function getPlaybook(profileId: ProfileId): PlaybookDefinition {
  return PLAYBOOKS[profileId];
}

export function getPlaybooks(profileIds?: readonly ProfileId[]): PlaybookDefinition[] {
  if (!profileIds) return PLAYBOOK_LIST;
  return profileIds.map(id => PLAYBOOKS[id]).filter((value): value is PlaybookDefinition => Boolean(value));
}

export function getPlaybookPrompt(profileId: ProfileId): string {
  return PLAYBOOKS[profileId].prompt;
}
