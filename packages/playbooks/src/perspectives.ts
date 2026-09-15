import type { InteractionMode, ProfileId } from '@blindspot/shared';
import { profileInteraction } from '@blindspot/shared';
import type { EvidenceChannel, Perspective, Rendering } from './types.js';

const noVisuals = 'You have no screenshots, no HTML, no CSS selectors and no automated rule output. Never describe layout, colours or code, and never guess what a sighted person would see.';

/**
 * A perspective decides which evidence each profile may use. Captures always store
 * everything; the worker filters what reaches the model according to this table.
 */
export const PERSPECTIVES: Record<ProfileId, Perspective> = {
  blindness: {
    interaction: 'screen-reader',
    channels: ['speech', 'journey-transcript'],
    renderings: [],
    persona: 'You perceive the page only through a screen reader. Your evidence is the speech log of a virtual screen reader (roles, names, states, live-region announcements) and the transcript of a navigation agent that operated the page with screen-reader commands and a keyboard.',
    forbidden: noVisuals,
  },
  'low-vision': {
    interaction: 'pointer',
    channels: ['screenshot', 'simulation', 'measurements', 'dom', 'axe', 'journey-transcript'],
    renderings: ['blurredVision', 'reducedContrast', 'narrow-viewport', 'large-text'],
    persona: 'You review the page as a person with low vision: high magnification, reduced acuity and reduced contrast sensitivity. You receive the standard screenshot, a blurred-vision simulation, a reduced-contrast simulation, a 320px-wide reflow rendering, a 200% text-size rendering, measured contrast ratios and the page code.',
    forbidden: 'Do not report on screen-reader behaviour or audio; those belong to other profiles.',
  },
  'color-vision': {
    interaction: 'pointer',
    channels: ['screenshot', 'simulation', 'measurements', 'dom', 'axe', 'journey-transcript'],
    renderings: ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'],
    persona: 'You review the page as a person with a colour vision deficiency. You receive the standard screenshot and the same state rendered with protanopia, deuteranopia, tritanopia and achromatopsia emulation, measured contrast ratios and the page code. Compare the renderings: what information disappears when colour is removed or shifted?',
    forbidden: 'Do not report general layout, screen-reader or keyboard issues that do not depend on colour perception.',
  },
  deafness: {
    interaction: 'pointer',
    channels: ['screenshot', 'visible-text', 'media-inventory', 'dom', 'journey-transcript'],
    renderings: [],
    persona: 'You review the page as a Deaf or hard-of-hearing person. You receive screenshots, visible text, an inventory of audio and video elements with their caption tracks and controls, and the page code. You cannot hear anything.',
    forbidden: 'Do not assess caption accuracy or audio content you were not given; presence of a track is not proof of quality.',
  },
  motor: {
    interaction: 'keyboard',
    channels: ['screenshot', 'focus-trace', 'measurements', 'dom', 'axe', 'journey-transcript'],
    renderings: [],
    persona: 'You review the page as a person who cannot use a mouse and relies on the keyboard, a switch or voice control. You receive screenshots, a sequential Tab focus trace with focus-indicator measurements, measured target sizes, the page code and the transcript of a navigation agent that used only the keyboard.',
    forbidden: 'Do not report screen-reader announcements or colour issues; judge reachability, operability, focus visibility and forgiving interaction.',
  },
  cognitive: {
    interaction: 'pointer',
    channels: ['screenshot', 'visible-text', 'journey-transcript'],
    renderings: [],
    persona: 'You review the page as a sighted person with cognitive, learning, attention or memory difficulties. You receive only what such a person sees: screenshots, the visible text and the transcript of a sighted navigation agent. You do not see the code.',
    forbidden: 'Do not comment on HTML, ARIA or CSS. Judge wording, structure, predictability, error help and memory load from what is visible.',
  },
  motion: {
    interaction: 'pointer',
    channels: ['screenshot', 'motion-inventory', 'measurements', 'dom', 'journey-transcript'],
    renderings: [],
    persona: 'You review the page for people with vestibular disorders, photosensitive epilepsy and sensory sensitivities. You receive screenshots, an inventory of animations that were actually running in the browser, autoplaying media, reduced-motion measurements and the page code.',
    forbidden: 'Do not certify flash thresholds from static evidence; flag candidates and state what a frame-by-frame test must confirm.',
  },
};

export function getPerspective(profileId: ProfileId): Perspective {
  return PERSPECTIVES[profileId];
}

/** Distinct journeys needed for the requested profiles, in a stable order. */
export function journeyModes(profileIds: readonly ProfileId[]): InteractionMode[] {
  const order: InteractionMode[] = ['screen-reader', 'keyboard', 'pointer'];
  const wanted = new Set(profileIds.map(profileInteraction));
  return order.filter(mode => wanted.has(mode));
}

export function profilesForMode(profileIds: readonly ProfileId[], mode: InteractionMode): ProfileId[] {
  return profileIds.filter(id => profileInteraction(id) === mode);
}

/** Renderings that any of the requested profiles needs for a captured state. */
export function renderingsFor(profileIds: readonly ProfileId[]): Rendering[] {
  return [...new Set(profileIds.flatMap(id => PERSPECTIVES[id].renderings))];
}

export function hasChannel(profileId: ProfileId, channel: EvidenceChannel): boolean {
  return PERSPECTIVES[profileId].channels.includes(channel);
}
