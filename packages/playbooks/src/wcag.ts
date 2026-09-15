import type { WcagReference } from './types.js';

const base = 'https://www.w3.org/TR/WCAG22/';

/** WCAG 2.2 success criteria used by the automated and specialist playbooks. */
export const WCAG = {
  nonText: { id: '1.1.1', title: 'Non-text Content', url: `${base}#non-text-content` },
  infoRelationships: { id: '1.3.1', title: 'Info and Relationships', url: `${base}#info-and-relationships` },
  meaningfulSequence: { id: '1.3.2', title: 'Meaningful Sequence', url: `${base}#meaningful-sequence` },
  sensoryCharacteristics: { id: '1.3.3', title: 'Sensory Characteristics', url: `${base}#sensory-characteristics` },
  orientation: { id: '1.3.4', title: 'Orientation', url: `${base}#orientation` },
  identifyInputPurpose: { id: '1.3.5', title: 'Identify Input Purpose', url: `${base}#identify-input-purpose` },
  useOfColor: { id: '1.4.1', title: 'Use of Color', url: `${base}#use-of-color` },
  audioControl: { id: '1.4.2', title: 'Audio Control', url: `${base}#audio-control` },
  contrastMinimum: { id: '1.4.3', title: 'Contrast (Minimum)', url: `${base}#contrast-minimum` },
  resizeText: { id: '1.4.4', title: 'Resize Text', url: `${base}#resize-text` },
  imagesOfText: { id: '1.4.5', title: 'Images of Text', url: `${base}#images-of-text` },
  reflow: { id: '1.4.10', title: 'Reflow', url: `${base}#reflow` },
  nonTextContrast: { id: '1.4.11', title: 'Non-text Contrast', url: `${base}#non-text-contrast` },
  textSpacing: { id: '1.4.12', title: 'Text Spacing', url: `${base}#text-spacing` },
  hoverFocusContent: { id: '1.4.13', title: 'Content on Hover or Focus', url: `${base}#content-on-hover-or-focus` },
  pauseStopHide: { id: '2.2.2', title: 'Pause, Stop, Hide', url: `${base}#pause-stop-hide` },
  threeFlashes: { id: '2.3.1', title: 'Three Flashes or Below Threshold', url: `${base}#three-flashes-or-below-threshold` },
  audioVideoOnly: { id: '1.2.1', title: 'Audio-only and Video-only (Prerecorded)', url: `${base}#audio-only-and-video-only-prerecorded` },
  captionsPrerecorded: { id: '1.2.2', title: 'Captions (Prerecorded)', url: `${base}#captions-prerecorded` },
  audioDescription: { id: '1.2.3', title: 'Audio Description or Media Alternative (Prerecorded)', url: `${base}#audio-description-or-media-alternative-prerecorded` },
  captionsLive: { id: '1.2.4', title: 'Captions (Live)', url: `${base}#captions-live` },
  audioDescriptionPrerecorded: { id: '1.2.5', title: 'Audio Description (Prerecorded)', url: `${base}#audio-description-prerecorded` },
  keyboard: { id: '2.1.1', title: 'Keyboard', url: `${base}#keyboard` },
  noKeyboardTrap: { id: '2.1.2', title: 'No Keyboard Trap', url: `${base}#no-keyboard-trap` },
  characterShortcuts: { id: '2.1.4', title: 'Character Key Shortcuts', url: `${base}#character-key-shortcuts` },
  focusOrder: { id: '2.4.3', title: 'Focus Order', url: `${base}#focus-order` },
  linkPurpose: { id: '2.4.4', title: 'Link Purpose (In Context)', url: `${base}#link-purpose-in-context` },
  headingsLabels: { id: '2.4.6', title: 'Headings and Labels', url: `${base}#headings-and-labels` },
  focusVisible: { id: '2.4.7', title: 'Focus Visible', url: `${base}#focus-visible` },
  focusAppearance: { id: '2.4.11', title: 'Focus Not Obscured (Minimum)', url: `${base}#focus-not-obscured-minimum` },
  pageTitled: { id: '2.4.2', title: 'Page Titled', url: `${base}#page-titled` },
  languageOfPage: { id: '3.1.1', title: 'Language of Page', url: `${base}#language-of-page` },
  pointerGestures: { id: '2.5.1', title: 'Pointer Gestures', url: `${base}#pointer-gestures` },
  pointerCancellation: { id: '2.5.2', title: 'Pointer Cancellation', url: `${base}#pointer-cancellation` },
  labelInName: { id: '2.5.3', title: 'Label in Name', url: `${base}#label-in-name` },
  dragging: { id: '2.5.7', title: 'Dragging Movements', url: `${base}#dragging-movements` },
  targetSize: { id: '2.5.8', title: 'Target Size (Minimum)', url: `${base}#target-size-minimum` },
  onFocus: { id: '3.2.1', title: 'On Focus', url: `${base}#on-focus` },
  onInput: { id: '3.2.2', title: 'On Input', url: `${base}#on-input` },
  errorIdentification: { id: '3.3.1', title: 'Error Identification', url: `${base}#error-identification` },
  labelsInstructions: { id: '3.3.2', title: 'Labels or Instructions', url: `${base}#labels-or-instructions` },
  errorSuggestion: { id: '3.3.3', title: 'Error Suggestion', url: `${base}#error-suggestion` },
  errorPrevention: { id: '3.3.4', title: 'Error Prevention (Legal, Financial, Data)', url: `${base}#error-prevention-legal-financial-data` },
  redundantEntry: { id: '3.3.7', title: 'Redundant Entry', url: `${base}#redundant-entry` },
  accessibleAuth: { id: '3.3.8', title: 'Accessible Authentication (Minimum)', url: `${base}#accessible-authentication-minimum` },
  nameRoleValue: { id: '4.1.2', title: 'Name, Role, Value', url: `${base}#name-role-value` },
  statusMessages: { id: '4.1.3', title: 'Status Messages', url: `${base}#status-messages` },
} as const satisfies Record<string, WcagReference>;

export type WcagId = (typeof WCAG)[keyof typeof WCAG]['id'];

export function wcag(...refs: WcagReference[]): WcagReference[] {
  return refs;
}
