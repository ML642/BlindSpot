import type { ProfileId } from '@blindspot/shared';
import type { PlaybookDefinition, PlaybookCheckDefinition, WcagReference } from './types.js';
import { PERSPECTIVES } from './perspectives.js';
import { WCAG, wcag } from './wcag.js';

const tool = (id: string, title: string, purpose: string, ...refs: WcagReference[]): PlaybookCheckDefinition => ({ id, title, purpose, wcag: refs, method: 'tool' });
const gemini = (id: string, title: string, purpose: string, ...refs: WcagReference[]): PlaybookCheckDefinition => ({ id, title, purpose, wcag: refs, method: 'gemini' });

const commonLimitations = [
  'Automated evidence is a signal for review, not a declaration of WCAG conformance.',
  'Each specialist reviews only the evidence its perspective allows; findings outside that perspective belong to another profile.',
];

const channelLabels: Record<string, string> = {
  speech: 'the virtual screen reader speech log for each page state',
  'journey-transcript': 'the transcript of the navigation agent for this perspective',
  'focus-trace': 'a sequential Tab focus trace with focus-indicator measurements',
  screenshot: 'the standard screenshot of each page state',
  simulation: 'alternative renderings of the same state',
  'visible-text': 'the visible text of the page',
  dom: 'the rendered HTML',
  'accessibility-tree': 'the accessibility tree',
  axe: 'automated rule results relevant to this profile',
  measurements: 'measured values such as contrast ratios, target sizes and overflow',
  'media-inventory': 'an inventory of audio and video elements',
  'motion-inventory': 'an inventory of running animations',
};

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
  const perspective = PERSPECTIVES[id];
  const evidence = perspective.channels.map(channel => channelLabels[channel] ?? channel).join('; ');
  const prompt = [
    `You are the ${name} accessibility specialist.`,
    '',
    `Goal: ${goal}`,
    '',
    `Perspective: ${perspective.persona}`,
    `Evidence you receive: ${evidence}.`,
    perspective.forbidden,
    '',
    'Assess only evidence that is present. For each issue explain the user impact, the exact page state and element as it appears in your evidence, the WCAG 2.2 criterion when applicable, and a practical fix. Use needs_review when a real assistive technology or human judgement is required. Do not infer a pass from missing evidence.',
    '',
    'Checks:',
    ...checks.map(c => `- ${c.title}: ${c.purpose} (${c.wcag.map(r => `${r.id} ${r.title}`).join(', ') || 'best practice'})`),
    '',
    'Limitations:',
    ...[...commonLimitations, ...extraLimitations].map(x => `- ${x}`),
  ].join('\n');
  return { id, name, group, description, perspective, prompt, checks, wcag: refs, limitations: [...commonLimitations, ...extraLimitations] };
}

const defs: Record<ProfileId, PlaybookDefinition> = {
  blindness: definition('blindness', 'Blindness', 'Vision', 'Screen reader and keyboard only; the agent never sees the screen or the code.', 'A blind person can understand and complete the scenario using only a screen reader and a keyboard.', [
    tool('names-and-labels', 'Meaningful names and labels', 'Find images, controls and links without a useful accessible name.', WCAG.nonText, WCAG.nameRoleValue, WCAG.labelsInstructions),
    tool('structure', 'Headings, landmarks and page language', 'Check the heading outline, landmark regions, page title and document language exposed to assistive technology.', WCAG.infoRelationships, WCAG.headingsLabels, WCAG.pageTitled, WCAG.languageOfPage, WCAG.bypassBlocks),
    tool('focus-order', 'Focus order and keyboard traps', 'Detect positive tabindex, repeated focus positions and focusable content hidden from assistive technology.', WCAG.focusOrder, WCAG.keyboard, WCAG.noKeyboardTrap),
    gemini('screen-reader-journey', 'Screen-reader task completion', 'From the transcript, judge whether the scenario could be completed with screen-reader commands alone: where the agent got lost, what it could not find or operate, and what it had to guess.', WCAG.keyboard, WCAG.meaningfulSequence, WCAG.nameRoleValue),
    gemini('announcements', 'Announcements of state, status and errors', 'Judge whether dialogs, status messages, validation errors and dynamic changes were announced in the speech log at the moment they happened.', WCAG.statusMessages, WCAG.errorIdentification, WCAG.onInput),
    gemini('spoken-names', 'Names that make sense when spoken', 'Judge whether link, button and field names in the speech log are understandable out of visual context and whether the heading outline describes the page.', WCAG.linkPurpose, WCAG.headingsLabels, WCAG.labelsInstructions),
  ], wcag(WCAG.nonText, WCAG.infoRelationships, WCAG.meaningfulSequence, WCAG.nameRoleValue, WCAG.statusMessages, WCAG.keyboard), [
    'The speech log comes from a virtual screen reader that follows the ARIA and HTML-AAM specifications. NVDA, JAWS and VoiceOver differ in verbosity and browser pairing; confirm significant findings with a real screen reader.',
  ]),
  'low-vision': definition('low-vision', 'Low vision', 'Vision', 'Magnification, contrast, reflow and text spacing.', 'A person with partial sight can read and operate the scenario at high zoom, large text and reduced contrast sensitivity.', [
    tool('contrast', 'Text and non-text contrast', 'Report measured contrast ratios below the minimum for text and meaningful UI components.', WCAG.contrastMinimum, WCAG.nonTextContrast),
    tool('reflow', 'Reflow at 320px', 'Measure horizontal overflow when the viewport is 320 CSS pixels wide; this stands in for 400% zoom but is not browser zoom.', WCAG.reflow),
    tool('text-resize-and-spacing', 'Text resize and spacing', 'Measure clipping and overflow at 200% root text size and at the WCAG text-spacing values.', WCAG.resizeText, WCAG.textSpacing),
    gemini('magnified-readability', 'Readability when magnified', 'Compare the standard, 320px and 200%-text renderings: is content lost, clipped or unreachable, and does the task remain understandable?', WCAG.reflow, WCAG.resizeText, WCAG.focusAppearance),
    gemini('degraded-vision', 'Visibility with blurred and low-contrast vision', 'Using the blurred-vision and reduced-contrast renderings, judge whether controls, focus, boundaries and status information remain perceivable.', WCAG.contrastMinimum, WCAG.nonTextContrast, WCAG.focusVisible),
  ], wcag(WCAG.contrastMinimum, WCAG.nonTextContrast, WCAG.resizeText, WCAG.reflow, WCAG.textSpacing), [
    'Viewport and text-size probes approximate browser zoom; they do not replace 200 to 400% browser zoom testing.',
  ]),
  'color-vision': definition('color-vision', 'Color vision deficiency', 'Vision', 'Information that must not depend on color alone.', 'A person who cannot distinguish some colours can understand status, errors, links and controls.', [
    tool('contrast', 'Contrast of text and controls', 'Report measured contrast ratios that fall below the minimum.', WCAG.contrastMinimum, WCAG.nonTextContrast),
    tool('color-only-signals', 'Colour-only status candidates', 'Locate status and error indicators with no text, icon or pattern alternative.', WCAG.useOfColor, WCAG.errorIdentification),
    gemini('simulated-color-review', 'Information lost under colour simulation', 'Compare the standard screenshot with the protanopia, deuteranopia, tritanopia and achromatopsia renderings: which statuses, links, chart series, selections or errors become indistinguishable?', WCAG.useOfColor, WCAG.sensoryCharacteristics),
  ], wcag(WCAG.useOfColor, WCAG.contrastMinimum, WCAG.nonTextContrast, WCAG.sensoryCharacteristics), [
    'Colour simulations use Chromium\'s vision-deficiency emulation, which approximates the most common deficiencies.',
  ]),
  deafness: definition('deafness', 'Deaf and hard of hearing', 'Hearing', 'Captions, transcripts and visual alternatives to sound.', 'A Deaf or hard-of-hearing person receives every important audio message visually.', [
    tool('captions', 'Captions and transcripts', 'Find video without caption tracks and audio-only content without a nearby transcript.', WCAG.captionsPrerecorded, WCAG.audioVideoOnly),
    tool('autoplay-and-control', 'Autoplaying and controllable media', 'Detect autoplaying media and media without visible controls.', WCAG.audioControl),
    gemini('sound-alternatives', 'Visual alternatives to sound', 'From the media inventory and screenshots, judge whether spoken content, alerts and confirmations have equivalent captions, transcripts or visual messages.', WCAG.captionsPrerecorded, WCAG.audioDescription, WCAG.statusMessages),
  ], wcag(WCAG.captionsPrerecorded, WCAG.audioVideoOnly, WCAG.audioDescription, WCAG.audioControl, WCAG.statusMessages), [
    'Caption accuracy, synchronisation and completeness require human review.',
  ]),
  motor: definition('motor', 'Motor and dexterity', 'Movement', 'Keyboard-only operation, target size, and no dragging or tight timing.', 'A person who cannot use a mouse and has limited precision can complete the scenario with the keyboard alone, without dragging or accidental activation.', [
    tool('keyboard-reachability', 'Keyboard reachability and traps', 'Compare focusable controls with the Tab trace; detect repeated focus positions and controls never reached.', WCAG.keyboard, WCAG.noKeyboardTrap, WCAG.focusOrder),
    tool('focus-visible', 'Visible focus indicator', 'Measure whether the focused element changes outline, shadow, border or background compared with its unfocused state.', WCAG.focusVisible),
    tool('target-size', 'Target size', 'Find actionable targets smaller than 24 by 24 CSS pixels.', WCAG.targetSize),
    tool('dragging-and-pointer', 'Dragging and pointer-only patterns', 'Identify draggable widgets and controls without an accessible name for voice control.', WCAG.dragging, WCAG.pointerGestures, WCAG.labelInName),
    gemini('keyboard-journey', 'Keyboard-only task completion', 'From the keyboard transcript and screenshots, judge whether every step of the scenario could be reached and operated by keyboard, whether focus was visible at each step, and whether any step needed hover, drag or precise timing.', WCAG.keyboard, WCAG.focusOrder, WCAG.focusVisible, WCAG.dragging, WCAG.pointerCancellation),
  ], wcag(WCAG.keyboard, WCAG.noKeyboardTrap, WCAG.focusOrder, WCAG.focusVisible, WCAG.targetSize, WCAG.dragging, WCAG.labelInName), [
    'Switch access and voice control are approximated by keyboard operation and accessible-name checks.',
  ]),
  cognitive: definition('cognitive', 'Cognitive, learning and attention', 'Cognition', 'Plain language, predictable flows, memory support and helpful errors.', 'A person with cognitive, learning, attention or memory difficulties can predict what happens, understand every instruction and recover from errors without remembering information.', [
    tool('labels-and-errors', 'Labels, instructions and error text', 'Inspect visible labels, required hints, inline errors and status regions.', WCAG.labelsInstructions, WCAG.errorIdentification, WCAG.errorSuggestion),
    tool('input-purpose', 'Autofill and redundant entry', 'Find personal-data fields without autocomplete tokens.', WCAG.identifyInputPurpose, WCAG.redundantEntry),
    tool('predictability-signals', 'Unexpected changes of context', 'Detect automatic refresh, navigation on input change and time limits.', WCAG.onInput, WCAG.onFocus, WCAG.timingAdjustable),
    gemini('plain-predictable-flow', 'Plain, predictable task flow', 'From screenshots and visible text, judge wording, step order, headings, confirmations, progress indication and whether errors say what to do.', WCAG.headingsLabels, WCAG.labelsInstructions, WCAG.errorSuggestion, WCAG.errorPrevention),
    gemini('memory-and-attention-load', 'Memory and attention load', 'Judge whether the scenario requires remembering codes or earlier information, resists distraction, and avoids time pressure.', WCAG.redundantEntry, WCAG.accessibleAuth, WCAG.timingAdjustable),
  ], wcag(WCAG.labelsInstructions, WCAG.errorIdentification, WCAG.errorSuggestion, WCAG.identifyInputPurpose, WCAG.redundantEntry, WCAG.onInput, WCAG.timingAdjustable), [
    'Reading level (3.1.5) is AAA; report readability as best practice unless AAA is requested.',
  ]),
  motion: definition('motion', 'Motion and flashing sensitivity', 'Sensory', 'Animation, autoplay, flashing and reduced-motion support.', 'A person with vestibular disorder, photosensitivity or sensory sensitivities can use the scenario without forced motion, flashing or unexpected media.', [
    tool('running-animations', 'Animations running in the browser', 'List CSS and script animations that were actually running when the state was captured.', WCAG.pauseStopHide),
    tool('reduced-motion', 'Reduced-motion support', 'Measure how many animations continue with prefers-reduced-motion: reduce.', WCAG.pauseStopHide),
    tool('autoplay-media', 'Autoplaying media', 'Detect autoplaying or looping audio and video.', WCAG.audioControl, WCAG.pauseStopHide),
    tool('flash-candidates', 'Flash candidates', 'Flag infinite animations faster than three cycles per second for a frame-by-frame flash test.', WCAG.threeFlashes),
    gemini('motion-review', 'Motion and flashing review', 'From the animation inventory and screenshots, judge parallax, auto-scrolling, spinning, large moving regions and flashing candidates, and whether the user can pause or avoid them.', WCAG.pauseStopHide, WCAG.threeFlashes),
  ], wcag(WCAG.pauseStopHide, WCAG.threeFlashes, WCAG.audioControl), [
    'Flash frequency and area thresholds require frame-by-frame testing; the inventory only flags candidates.',
  ]),
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
