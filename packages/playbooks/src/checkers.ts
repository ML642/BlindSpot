import type { Finding, Evidence, ProfileId, PlaybookResult, Severity, TestStatus } from '@blindspot/shared';
import { getPlaybooks } from './playbooks.js';
import { WCAG } from './wcag.js';
import type { AutomatedAuditResult, AxeResultsLike, AxeRuleLike, BrowserPageLike, CheckerContext, DomSignals, FocusStop, InteractionProbeReport, SignalNode } from './types.js';
import { aggregateFindings } from './aggregate.js';

/** tsx preserves function names using __name; bind it inside serialized probes. */
function evaluateInPage<T>(page: BrowserPageLike, fn: () => T | Promise<T>): Promise<T> {
  return page.evaluate<T>(`((__name) => (${fn.toString()})())((fn) => fn)`);
}

function stableId(prefix: string, input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function signalEvidence(context: CheckerContext, type: Evidence['type'], description: string, signal?: SignalNode, value?: string): Evidence {
  const raw = { type, description, selector: signal?.selector, value };
  const id = stableId('evidence', `${context.pageState.id}|${type}|${description}|${signal?.selector ?? ''}|${value ?? ''}`);
  const evidence = { ...raw, id };
  return context.addEvidence ? context.addEvidence(evidence) : evidence;
}

function finding(
  context: CheckerContext,
  input: Pick<Finding, 'title' | 'description' | 'impact' | 'severity' | 'recommendation' | 'wcag' | 'profileIds'> & Partial<Pick<Finding, 'selector' | 'reproduction' | 'method' | 'status' | 'disposition'>>,
  evidence: Evidence[],
): Finding {
  const selector = input.selector ?? evidence.find(e => e.selector)?.selector;
  return {
    id: stableId('finding', `${context.pageState.id}|${input.title}|${selector ?? ''}`),
    title: input.title,
    description: input.description,
    impact: input.impact,
    severity: input.severity,
    profileIds: input.profileIds,
    pageStateId: context.pageState.id,
    selector,
    evidence,
    reproduction: input.reproduction ?? ['Open the recorded page state and inspect the cited element.'],
    recommendation: input.recommendation,
    wcag: input.wcag,
    method: input.method ?? 'tool',
    status: input.status ?? 'fail',
    disposition: input.disposition,
  };
}

function resultFor(profileId: ProfileId, checks: PlaybookResult['checks']): PlaybookResult {
  const hasFail = checks.some(check => check.status === 'fail');
  const hasReview = checks.some(check => check.status === 'needs_review' || check.status === 'blocked');
  const measured = checks.some(check => check.status === 'pass');
  const status: TestStatus = hasFail ? 'fail' : hasReview ? 'needs_review' : measured ? 'pass' : 'not_applicable';
  return { profileId, status, summary: hasFail ? 'One or more automated checks found issues.' : hasReview ? 'Automated checks require specialist or manual review.' : measured ? 'Automated checks found no failures.' : 'No applicable checks ran.', checks };
}

function check(id: string, title: string, status: TestStatus, method: 'tool' | 'gemini', evidence: Evidence[], notes: string): PlaybookResult['checks'][number] {
  return { id, title, status, method, evidenceIds: evidence.map(e => e.id), notes };
}

function impactFor(rule: AxeRuleLike): string {
  return rule.impact ? `axe reports ${rule.impact} impact` : 'The automated rule reports an accessibility violation.';
}

function severityFor(rule: AxeRuleLike): Severity {
  if (rule.impact === 'critical') return 'critical';
  if (rule.impact === 'serious') return 'serious';
  if (rule.impact === 'moderate') return 'moderate';
  return 'minor';
}

const axeRuleProfiles: Record<string, ProfileId[]> = {
  'aria-hidden-focus': ['blindness', 'motor'],
  'aria-command-name': ['blindness', 'motor'],
  'button-name': ['blindness', 'motor'],
  'input-button-name': ['blindness', 'motor'],
  'link-name': ['blindness', 'motor'],
  'color-contrast': ['low-vision', 'color-vision'],
  'color-contrast-enhanced': ['low-vision', 'color-vision'],
  'link-in-text-block': ['color-vision', 'low-vision'],
  'document-title': ['blindness', 'cognitive'],
  'heading-order': ['blindness', 'cognitive'],
  'empty-heading': ['blindness', 'cognitive'],
  'page-has-heading-one': ['blindness', 'cognitive'],
  label: ['blindness', 'cognitive'],
  'label-title-only': ['blindness', 'cognitive'],
  'select-name': ['blindness', 'cognitive'],
  'autocomplete-valid': ['cognitive'],
  'nested-interactive': ['blindness', 'motor'],
  'scrollable-region-focusable': ['blindness', 'motor'],
  'focus-order-semantics': ['blindness', 'motor'],
  tabindex: ['blindness', 'motor'],
  'target-size': ['motor'],
  'video-caption': ['deafness'],
  'audio-caption': ['deafness'],
  'no-autoplay-audio': ['deafness', 'motion', 'cognitive'],
  blink: ['motion', 'cognitive'],
  marquee: ['motion', 'cognitive'],
  'meta-refresh': ['cognitive', 'motion', 'blindness'],
  'meta-viewport': ['low-vision'],
  'meta-viewport-large': ['low-vision'],
};

const axeCategoryProfiles: Array<[string, ProfileId[]]> = [
  ['cat.color', ['low-vision', 'color-vision']],
  ['cat.keyboard', ['motor', 'blindness']],
  ['cat.forms', ['blindness', 'cognitive']],
  ['cat.time-and-media', ['deafness', 'motion']],
  ['cat.sensory-and-visual-cues', ['color-vision', 'low-vision', 'cognitive']],
  ['cat.language', ['blindness', 'cognitive']],
];

/** Which perspectives an automated rule speaks to. Unknown rules default to the screen-reader profile. */
export function axeProfiles(ruleId: string, tags: readonly string[] = []): ProfileId[] {
  const explicit = axeRuleProfiles[ruleId];
  if (explicit) return explicit;
  for (const [tag, ids] of axeCategoryProfiles) if (tags.includes(tag)) return ids;
  return ['blindness'];
}

/** Run serializable DOM diagnostics in the browser context. */
export async function collectDomSignals(page: BrowserPageLike): Promise<DomSignals> {
  return evaluateInPage(page, () => {
    const selectorFor = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent: HTMLElement | null = current.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const siblings = [...parent.children].filter(child => child.tagName === current!.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
        current = parent;
      }
      return parts.join(' > ');
    };
    const snippet = (element: Element): SignalNode => ({ selector: selectorFor(element), html: element.outerHTML.slice(0, 500), text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 160), tag: element.tagName.toLowerCase() });
    const isVisible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const rect = (element as HTMLElement).getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const name = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const ids = labelledBy ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ') : '';
      const label = element.closest('label')?.textContent ?? (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? '' : '');
      const alt = [...element.querySelectorAll('img[alt], [aria-label]')].map(node => node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? '').join(' ');
      return [element.getAttribute('aria-label') ?? '', ids, label, alt, element.getAttribute('title') ?? '', (element as HTMLInputElement).placeholder ?? '', (element.textContent ?? '')].join(' ').trim();
    };
    const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [tabindex]')].filter(element => !['hidden'].includes((element as HTMLInputElement).type ?? ''));
    const visibleControls = controls.filter(isVisible);
    const images = [...document.images].filter(isVisible);
    const imagesWithoutAlt = images.filter(image => !image.hasAttribute('alt') && image.getAttribute('role') !== 'presentation' && image.getAttribute('aria-hidden') !== 'true').map(snippet);
    const controlsWithoutLabel = visibleControls.filter(element => !name(element) && element.getAttribute('aria-hidden') !== 'true').map(snippet);
    const headingElements = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(isVisible);
    const headings = headingElements.map(heading => ({ level: Number(heading.getAttribute('aria-level') ?? heading.tagName.substring(1)) || 2, text: (heading.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) }));
    const headingJumps: DomSignals['headingJumps'] = [];
    headingElements.forEach((heading, index) => {
      if (!index) return;
      const from = headings[index - 1].level;
      const to = headings[index].level;
      if (to > from + 1) headingJumps.push({ from, to, selector: selectorFor(heading), text: headings[index].text });
    });
    const landmarkSelectors: Array<[string, string]> = [['main', 'main, [role="main"]'], ['navigation', 'nav, [role="navigation"]'], ['banner', 'header:not(article header):not(section header), [role="banner"]'], ['contentinfo', 'footer:not(article footer):not(section footer), [role="contentinfo"]'], ['search', 'search, [role="search"]'], ['complementary', 'aside, [role="complementary"]'], ['form', 'form[aria-label], form[aria-labelledby], [role="form"]'], ['region', '[role="region"][aria-label], [role="region"][aria-labelledby], section[aria-label], section[aria-labelledby]']];
    const landmarks = landmarkSelectors.filter(([, selector]) => document.querySelector(selector)).map(([role]) => role);
    const positiveTabindices = controls.filter(element => Number(element.getAttribute('tabindex')) > 0).map(snippet);
    const smallTargets = visibleControls.filter(element => !['a'].includes(element.tagName.toLowerCase()) || getComputedStyle(element).display !== 'inline').map(element => ({ ...snippet(element), width: Math.round((element as HTMLElement).getBoundingClientRect().width), height: Math.round((element as HTMLElement).getBoundingClientRect().height) })).filter(item => item.width < 24 || item.height < 24);
    const media = [...document.querySelectorAll('audio,video')] as HTMLMediaElement[];
    const mediaInventory = media.map(element => ({
      ...snippet(element),
      kind: (element.tagName.toLowerCase() === 'audio' ? 'audio' : 'video') as 'audio' | 'video',
      src: (element.currentSrc || element.getAttribute('src') || element.querySelector('source')?.getAttribute('src') || undefined)?.slice(0, 200),
      controls: element.hasAttribute('controls'), autoplay: element.hasAttribute('autoplay') || (!element.paused && !element.ended), muted: element.muted, loop: element.hasAttribute('loop'),
      tracks: [...element.querySelectorAll('track')].map(track => ({ kind: track.getAttribute('kind') ?? 'subtitles', label: track.getAttribute('label') ?? '', language: track.getAttribute('srclang') ?? '' })),
    }));
    const mediaWithoutCaptions = mediaInventory.filter(item => item.kind === 'video' && !item.tracks.some(track => ['captions', 'subtitles'].includes(track.kind))).map(({ selector, html, text, tag }) => ({ selector, html, text, tag }));
    const autoplayMedia = mediaInventory.filter(item => item.autoplay || item.loop).map(({ selector, html, text, tag }) => ({ selector, html, text, tag }));
    const transcriptLinks = [...document.querySelectorAll('a, button, summary')].filter(element => /transcript|transkryp/i.test(element.textContent ?? '')).length;
    const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
    const motionInventory = animations.slice(0, 60).map(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
      const timing = animation.effect?.getTiming();
      const duration = typeof timing?.duration === 'number' ? timing.duration : undefined;
      const iterations = timing?.iterations === Infinity ? 'infinite' as const : timing?.iterations;
      const base = target ? snippet(target) : { selector: 'document', html: '', text: '', tag: 'document' };
      return { ...base, type: animation.constructor.name, name: (animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? animation.id ?? undefined, durationMs: duration, iterations, playState: animation.playState };
    });
    const flashCandidates = motionInventory.filter(item => item.playState === 'running' && item.iterations === 'infinite' && item.durationMs !== undefined && item.durationMs > 0 && item.durationMs < 334);
    const styleText = [...document.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n');
    let hasReducedMotionRule = /prefers-reduced-motion\s*:\s*reduce/i.test(styleText);
    try { for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule instanceof CSSMediaRule && /prefers-reduced-motion\s*:\s*reduce/i.test(rule.conditionText)) hasReducedMotionRule = true; } catch { /* cross-origin sheets are unreadable */ }
    const likelyColorOnlyIndicators = [...document.querySelectorAll('[class*="error" i], [class*="success" i], [class*="warning" i], [class*="danger" i], [aria-invalid="true"]')].filter(isVisible).filter(element => {
      const text = (element.textContent ?? '').trim();
      const labelled = element.getAttribute('aria-label') || element.getAttribute('title') || element.querySelector('svg, [role="img"], img');
      return !text && !labelled;
    }).map(snippet);
    const textSpacingRisks = [...document.querySelectorAll('p, li, label, button, a, input, textarea')].filter(isVisible).filter(element => {
      const style = getComputedStyle(element);
      return style.overflow === 'hidden' && (element.textContent ?? '').trim().length > 10;
    }).map(snippet);
    const draggables = [...document.querySelectorAll('[draggable="true"], [aria-grabbed]')].filter(isVisible).map(snippet);
    const personalFields = [...document.querySelectorAll('input, select, textarea')].filter(isVisible).filter(element => {
      const input = element as HTMLInputElement;
      const hint = `${input.type} ${input.name} ${input.id} ${input.getAttribute('placeholder') ?? ''}`.toLowerCase();
      return /email|e-mail|tel|phone|mobile|name|address|street|postal|zip|city|country|birth|cc-|card|organization|username/.test(hint) && !['hidden', 'submit', 'button', 'checkbox', 'radio', 'password'].includes(input.type);
    });
    const autocompleteGaps = personalFields.filter(element => !element.getAttribute('autocomplete')).map(snippet);
    const contextChangeRisks = [
      ...[...document.querySelectorAll('meta[http-equiv="refresh" i]')].map(snippet),
      ...[...document.querySelectorAll('select[onchange]')].filter(element => /location|submit|href/i.test(element.getAttribute('onchange') ?? '')).map(snippet),
    ];
    return {
      title: document.title,
      lang: document.documentElement.getAttribute('lang') ?? undefined,
      landmarks, headings,
      imageCount: images.length, controlCount: visibleControls.length, personalFieldCount: personalFields.length,
      videoCount: mediaInventory.filter(item => item.kind === 'video').length, audioCount: mediaInventory.filter(item => item.kind === 'audio').length,
      imagesWithoutAlt, controlsWithoutLabel, headingJumps, positiveTabindices, smallTargets,
      mediaInventory, mediaWithoutCaptions, autoplayMedia, transcriptLinks,
      motionInventory, flashCandidates, hasReducedMotionRule, likelyColorOnlyIndicators, textSpacingRisks, draggables, autocompleteGaps, contextChangeRisks,
    };
  });
}

/**
 * Run stateful probes in a disposable browser context. The backend should call this
 * before specialist analysis and use a fresh context for each page state when it
 * needs to preserve the user's scenario state.
 */
export async function runInteractionProbes(context: CheckerContext): Promise<InteractionProbeReport> {
  const page = context.page;
  const evidence: Evidence[] = [];
  const keyboard: InteractionProbeReport['keyboard'] = { attempted: Boolean(page.keyboard), focusSequence: [], trace: [], repeatedFocus: false, focusableCount: 0, withoutIndicator: [] };
  if (page.keyboard) {
    try {
      keyboard.focusableCount = await evaluateInPage(page, () => document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]').length);
      for (let i = 0; i < Math.min(40, keyboard.focusableCount + 3); i += 1) {
        await page.keyboard.press('Tab');
        const stop = await evaluateInPage<Omit<FocusStop, 'index'>>(page, () => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return { tag: 'body', name: '', selector: 'body', inViewport: true };
          const selector = element.id ? `#${CSS.escape(element.id)}` : `${element.tagName.toLowerCase()}${element.getAttribute('name') ? `[name="${element.getAttribute('name')}"]` : ''}`;
          const labelledBy = element.getAttribute('aria-labelledby');
          const ids = labelledBy ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ') : '';
          const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? '' : element.closest('label')?.textContent ?? '';
          const name = (element.getAttribute('aria-label') ?? ids ?? label ?? '').trim() || label.trim() || (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) || (element as HTMLInputElement).placeholder || element.getAttribute('title') || '';
          const rect = element.getBoundingClientRect();
          const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
          const snapshot = () => { const style = getComputedStyle(element); return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.borderColor, style.backgroundColor, style.textDecorationLine].join('|'); };
          const focused = snapshot();
          element.blur();
          const blurred = snapshot();
          element.focus({ preventScroll: true });
          return { tag: element.tagName.toLowerCase(), role: element.getAttribute('role') ?? undefined, name, selector, inViewport, indicatorChanged: focused !== blurred };
        });
        keyboard.trace.push({ index: i + 1, ...stop });
        keyboard.focusSequence.push(stop.selector);
      }
      keyboard.repeatedFocus = keyboard.focusSequence.length > 2 && keyboard.focusSequence.every((item, index, array) => index < 2 || item === array[index - 2]);
      keyboard.withoutIndicator = keyboard.trace.filter(stop => stop.tag !== 'body' && stop.indicatorChanged === false);
      evidence.push(signalEvidence(context, 'focus', `Keyboard Tab probe visited ${keyboard.trace.filter(stop => stop.tag !== 'body').length} focus position(s) of ${keyboard.focusableCount} focusable element(s).`, undefined, keyboard.trace.map(stop => `${stop.tag}${stop.name ? ` "${stop.name}"` : ''}${stop.indicatorChanged === false ? ' (no visible change)' : ''}`).join(' → ').slice(0, 2000)));
    } catch {
      keyboard.attempted = false;
    }
  }

  const originalViewport = page.viewportSize?.() ?? null;
  const reflow = { attempted: false, viewport: undefined as { width: number; height: number } | undefined, horizontalOverflow: undefined as number | undefined };
  if (page.setViewportSize) {
    try {
      reflow.attempted = true;
      reflow.viewport = { width: 320, height: originalViewport?.height ?? 640 };
      await page.setViewportSize(reflow.viewport);
      reflow.horizontalOverflow = await evaluateInPage(page, () => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    } catch {
      reflow.attempted = false;
    } finally {
      if (originalViewport) await page.setViewportSize(originalViewport).catch(() => undefined);
    }
  }

  const textResize = { attempted: false, overflowCount: undefined as number | undefined };
  const textSpacing = { attempted: false, overflowCount: undefined as number | undefined };
  try {
    textResize.attempted = true;
    textResize.overflowCount = await evaluateInPage(page, () => {
      const measure = (): number => {
        const root = document.documentElement;
        let count = root.scrollWidth > root.clientWidth + 1 ? 1 : 0;
        for (const element of Array.from(document.querySelectorAll('p,li,label,button,a,input,textarea,select'))) {
          const item = element as HTMLElement;
          if (item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1) count += 1;
        }
        return count;
      };
      const root = document.documentElement;
      const before = root.style.fontSize;
      root.style.fontSize = '200%';
      const count = measure();
      root.style.fontSize = before;
      return count;
    });
    textSpacing.attempted = true;
    textSpacing.overflowCount = await evaluateInPage(page, () => {
      const measure = (): number => {
        const root = document.documentElement;
        let count = root.scrollWidth > root.clientWidth + 1 ? 1 : 0;
        for (const element of Array.from(document.querySelectorAll('p,li,label,button,a,input,textarea,select'))) {
          const item = element as HTMLElement;
          if (item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1) count += 1;
        }
        return count;
      };
      const style = document.createElement('style');
      style.dataset.blindspotProbe = 'text-spacing';
      style.textContent = 'p,li,label,button,a,input,textarea,select { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }';
      document.head.append(style);
      const count = measure();
      style.remove();
      return count;
    });
  } catch {
    textResize.attempted = false;
    textSpacing.attempted = false;
  }

  const reducedMotion = { attempted: false, animatedAfterPreference: undefined as number | undefined };
  if (page.emulateMedia) {
    try {
      reducedMotion.attempted = true;
      await page.emulateMedia({ reducedMotion: 'reduce' });
      reducedMotion.animatedAfterPreference = await evaluateInPage(page, () => {
        const running = typeof document.getAnimations === 'function' ? document.getAnimations().filter(animation => animation.playState === 'running').length : 0;
        const styled = Array.from(document.querySelectorAll('*')).filter(element => {
          const style = getComputedStyle(element);
          return style.animationName !== 'none' && style.animationDuration !== '0s' && style.animationIterationCount === 'infinite';
        }).length;
        return Math.max(running, styled);
      });
    } catch {
      reducedMotion.attempted = false;
    } finally {
      await page.emulateMedia({ reducedMotion: null }).catch(() => undefined);
    }
  }
  if (reflow.horizontalOverflow !== undefined) evidence.push(signalEvidence(context, 'measurement', `At 320px viewport width, measured ${reflow.horizontalOverflow}px horizontal overflow.`, undefined, `${reflow.horizontalOverflow}px`));
  if (textResize.overflowCount !== undefined) evidence.push(signalEvidence(context, 'measurement', `At 200% root text-size probe, measured ${textResize.overflowCount} overflow candidate(s).`, undefined, String(textResize.overflowCount)));
  if (textSpacing.overflowCount !== undefined) evidence.push(signalEvidence(context, 'measurement', `At WCAG text-spacing probe values, measured ${textSpacing.overflowCount} overflow candidate(s).`, undefined, String(textSpacing.overflowCount)));
  if (reducedMotion.animatedAfterPreference !== undefined) evidence.push(signalEvidence(context, 'measurement', `With prefers-reduced-motion: reduce, ${reducedMotion.animatedAfterPreference} animated element(s) remained.`, undefined, String(reducedMotion.animatedAfterPreference)));
  return { keyboard, reflow, textResize, textSpacing, reducedMotion, evidence };
}

async function axeResults(context: CheckerContext): Promise<AxeResultsLike | undefined> {
  if (context.axeResults) return context.axeResults;
  if (context.runAxe) {
    try { return await context.runAxe(); } catch { return undefined; }
  }
  return undefined;
}

function axeWcag(ruleId: string, tags: string[] = []): typeof WCAG[keyof typeof WCAG][] {
  const matching = Object.values(WCAG).filter(ref => tags.includes(`wcag${ref.id.replaceAll('.', '')}`));
  if (matching.length) return matching;
  const map: Record<string, typeof WCAG[keyof typeof WCAG][]> = {
    'area-alt': [WCAG.nonText],
    'button-name': [WCAG.nameRoleValue],
    'color-contrast': [WCAG.contrastMinimum],
    'document-title': [WCAG.pageTitled],
    'heading-order': [],
    'html-has-lang': [WCAG.languageOfPage],
    'image-alt': [WCAG.nonText],
    'input-button-name': [WCAG.nameRoleValue],
    label: [WCAG.labelsInstructions, WCAG.nameRoleValue],
    'link-name': [WCAG.linkPurpose, WCAG.nameRoleValue],
    'select-name': [WCAG.labelsInstructions, WCAG.nameRoleValue],
    'video-caption': [WCAG.captionsPrerecorded],
    'target-size': [WCAG.targetSize],
    'meta-refresh': [WCAG.timingAdjustable],
  };
  return map[ruleId] ?? [];
}

function contrastValue(node: AxeRuleLike['nodes'][number]): string | undefined {
  const data = node.any?.find(item => item.id === 'color-contrast')?.data as { contrastRatio?: number; expectedContrastRatio?: string; fgColor?: string; bgColor?: string; fontSize?: string } | undefined;
  if (!data || typeof data.contrastRatio !== 'number') return undefined;
  return `${data.contrastRatio}:1 measured, ${data.expectedContrastRatio ?? 'minimum'} expected (${data.fgColor ?? '?'} on ${data.bgColor ?? '?'}${data.fontSize ? `, ${data.fontSize}` : ''})`;
}

function addAxeFindings(context: CheckerContext, results: AxeResultsLike | undefined, allowedProfiles?: ReadonlySet<string>): { findings: Finding[]; evidence: Evidence[] } {
  if (!results?.violations?.length) return { findings: [], evidence: [] };
  const findings: Finding[] = [];
  const evidence: Evidence[] = [];
  for (const rule of results.violations) {
    const profileIds = axeProfiles(rule.id, rule.tags).filter(profileId => !allowedProfiles || allowedProfiles.has(profileId));
    if (!profileIds.length) continue;
    const nodes = rule.nodes ?? [];
    const nodeEvidence = nodes.slice(0, 25).map(node => {
      const selector = node.target?.[0];
      const contrast = rule.id.startsWith('color-contrast') ? contrastValue(node) : undefined;
      const item = signalEvidence(context, contrast ? 'measurement' : 'axe', `${rule.help}: ${node.failureSummary ?? 'Automated rule violation'}`, selector ? { selector, html: node.html ?? '' } : undefined, contrast ?? rule.helpUrl);
      evidence.push(item);
      return item;
    });
    findings.push(finding(context, {
      title: rule.help,
      description: rule.description ?? `The automated checker found a violation of ${rule.id}.`,
      impact: impactFor(rule),
      severity: severityFor(rule),
      profileIds,
      recommendation: `Resolve the ${rule.id} issue using the axe guidance and verify the recorded scenario again.`,
      wcag: axeWcag(rule.id, rule.tags),
      status: rule.tags?.includes('best-practice') || rule.id === 'heading-order' || rule.id === 'tabindex' ? 'needs_review' : 'fail',
      disposition: rule.tags?.includes('best-practice') || rule.id === 'heading-order' || rule.id === 'tabindex' ? 'suggestion' : undefined,
      selector: nodeEvidence[0]?.selector,
      reproduction: ['Run the recorded scenario and inspect every element identified by the automated rule.'],
    }, nodeEvidence));
  }
  return { findings, evidence };
}

export async function runAutomatedChecks(context: CheckerContext, requestedProfiles?: readonly ProfileId[]): Promise<AutomatedAuditResult> {
  const profiles = getPlaybooks(requestedProfiles);
  const selected = profiles.length ? profiles : getPlaybooks();
  const selectedIds = new Set<string>(selected.map(p => p.id));
  const pick = (...ids: ProfileId[]) => ids.filter(id => selectedIds.has(id));
  const signals = context.signals ?? await collectDomSignals(context.page);
  const probes = context.skipInteractionProbes ? { keyboard: { attempted: false, repeatedFocus: false, focusSequence: [], trace: [], focusableCount: 0, withoutIndicator: [] }, reflow: { attempted: false, horizontalOverflow: undefined }, textResize: { attempted: false, overflowCount: undefined }, textSpacing: { attempted: false, overflowCount: undefined }, reducedMotion: { attempted: false, animatedAfterPreference: undefined }, evidence: [] } satisfies InteractionProbeReport : await runInteractionProbes({ ...context, page: context.probePage ?? context.page });
  await context.onProbes?.(probes);
  const axeOutput = await axeResults(context);
  const axe = addAxeFindings(context, axeOutput, selectedIds);
  const findings: Finding[] = [...axe.findings];
  const evidence: Evidence[] = [...axe.evidence, ...probes.evidence];
  const checksByProfile = new Map<ProfileId, PlaybookResult['checks']>();
  for (const profile of selected) checksByProfile.set(profile.id, []);
  const record = (profileIds: ProfileId[], item: PlaybookResult['checks'][number]) => {
    for (const profileId of profileIds) checksByProfile.get(profileId)?.push(item);
  };
  const add = (profileIds: ProfileId[], item: Finding, checkId: string, title: string, evidenceItems: Evidence[]) => {
    if (!profileIds.length) return;
    findings.push(item);
    evidence.push(...evidenceItems);
    record(profileIds, check(checkId, title, item.status, item.method, evidenceItems, item.description));
  };
  const pass = (profileIds: ProfileId[], checkId: string, title: string, notes: string, evidenceItems: Evidence[] = []) => {
    if (!profileIds.length) return;
    evidence.push(...evidenceItems);
    record(profileIds, check(checkId, title, 'pass', 'tool', evidenceItems, notes));
  };
  const notApplicable = (profileIds: ProfileId[], checkId: string, title: string, notes: string) => record(profileIds, check(checkId, title, 'not_applicable', 'tool', [], notes));

  for (const profile of selected) {
    const ruleFindings = axe.findings.filter(f => f.profileIds.includes(profile.id));
    for (const item of ruleFindings) checksByProfile.get(profile.id)!.push(check(`axe-${item.id}`, 'Automated axe rules', item.status, 'tool', item.evidence, `${item.title}: ${item.description}`));
  }

  // Structure and names (screen reader).
  for (const rule of axeOutput?.passes ?? []) {
    const applicableProfiles = axeProfiles(rule.id).filter(profileId => selectedIds.has(profileId));
    if (!applicableProfiles.length) continue;
    const passEvidence = signalEvidence(context, 'axe', `${rule.help}: axe reported this rule passed for the captured page state.`, undefined, rule.helpUrl);
    evidence.push(passEvidence);
    for (const profileId of applicableProfiles) {
      checksByProfile.get(profileId)!.push(check(`axe-pass-${rule.id}`, rule.help, 'pass', 'tool', [passEvidence], 'axe found no violations for this rule in the captured page state.'));
    }
  }

  if (signals.imagesWithoutAlt.length) {
    const items = signals.imagesWithoutAlt.slice(0, 25).map(signal => signalEvidence(context, 'dom', 'Visible image has no alt attribute.', signal));
    add(pick('blindness'), finding(context, { title: `${signals.imagesWithoutAlt.length} image(s) are missing alternative text`, description: `${signals.imagesWithoutAlt.length} visible image(s) have no alt attribute, so their purpose is unavailable to screen-reader users. Each is listed in the evidence.`, impact: 'The image is announced as its filename or skipped without conveying its purpose.', severity: 'serious', profileIds: pick('blindness'), recommendation: 'Add concise alt text when the image conveys information, or use alt="" for decorative images.', wcag: [WCAG.nonText] }, items), 'image-alt', 'Alternative text', items);
  } else if (signals.imageCount) pass(pick('blindness'), 'image-alt', 'Alternative text', `All ${signals.imageCount} visible image(s) carry an alt attribute. Alt quality still requires review.`);
  else notApplicable(pick('blindness'), 'image-alt', 'Alternative text', 'No visible images in this state.');
  if (signals.controlsWithoutLabel.length) {
    const p = pick('blindness', 'motor');
    const items = signals.controlsWithoutLabel.slice(0, 25).map(signal => signalEvidence(context, 'dom', 'Interactive control has no detected accessible label.', signal));
    add(p, finding(context, { title: `${signals.controlsWithoutLabel.length} interactive control(s) have no accessible label`, description: `${signals.controlsWithoutLabel.length} focusable control(s) have no detected text, label, aria-label or aria-labelledby. Each is listed in the evidence.`, impact: 'Screen-reader users hear only the role; voice-control users cannot say its name.', severity: 'serious', profileIds: p, recommendation: 'Give each control a persistent visible label and expose the same name through a native label or aria-labelledby.', wcag: [WCAG.nameRoleValue, WCAG.labelsInstructions, WCAG.labelInName] }, items), 'control-label', 'Control labels', items);
  }
  if (!signals.controlsWithoutLabel.length && signals.controlCount) pass(pick('blindness', 'motor'), 'control-label', 'Control labels', `All ${signals.controlCount} visible control(s) have a detected name.`);
  for (const signal of signals.headingJumps) {
    const p = pick('blindness', 'cognitive');
    const e = signalEvidence(context, 'dom', `Heading level jumps from h${signal.from} to h${signal.to}.`, { selector: signal.selector, html: '', text: signal.text });
    add(p, finding(context, { title: 'Heading hierarchy skips a level', description: `The heading sequence jumps from h${signal.from} to h${signal.to}.`, impact: 'A screen-reader user navigating by headings loses the document structure; readers struggle to scan sections.', severity: 'moderate', profileIds: p, selector: signal.selector, recommendation: 'Use heading levels in a logical hierarchy that reflects the content structure.', wcag: [WCAG.infoRelationships, WCAG.headingsLabels], status: 'needs_review' }, [e]), 'heading-order', 'Heading hierarchy', [e]);
  }
  const structureProblems: string[] = [];
  if (!signals.landmarks.includes('main')) structureProblems.push('no main landmark');
  if (!signals.headings.some(heading => heading.level === 1)) structureProblems.push('no level-1 heading');
  if (!signals.lang) structureProblems.push('no document language');
  if (!signals.title.trim()) structureProblems.push('no page title');
  if (structureProblems.length && pick('blindness').length) {
    const e = signalEvidence(context, 'accessibility', `Structure exposed to assistive technology: landmarks ${signals.landmarks.join(', ') || 'none'}; headings ${signals.headings.map(h => `h${h.level}`).join(' ') || 'none'}; lang ${signals.lang ?? 'missing'}.`, undefined, structureProblems.join(', '));
    add(pick('blindness'), finding(context, { title: 'Page structure is incomplete for screen-reader navigation', description: `The state has ${structureProblems.join(', ')}.`, impact: 'Screen-reader users rely on landmarks, a level-1 heading, the title and language to orient and skip repeated content.', severity: 'moderate', profileIds: pick('blindness'), recommendation: 'Provide a main landmark, one descriptive h1, a page title and a lang attribute on the html element.', wcag: [WCAG.infoRelationships, WCAG.bypassBlocks, WCAG.pageTitled, WCAG.languageOfPage], status: 'needs_review' }, [e]), 'structure', 'Headings, landmarks and page language', [e]);
  } else if (pick('blindness').length) {
    const e = signalEvidence(context, 'accessibility', `Structure exposed to assistive technology: landmarks ${signals.landmarks.join(', ')}; headings ${signals.headings.map(h => `h${h.level}`).join(' ')}; lang ${signals.lang}.`);
    pass(pick('blindness'), 'structure', 'Headings, landmarks and page language', 'Main landmark, level-1 heading, page title and document language are present.', [e]);
  }
  for (const signal of signals.positiveTabindices) {
    const p = pick('blindness', 'motor');
    const e = signalEvidence(context, 'dom', 'Element uses a positive tabindex.', signal);
    add(p, finding(context, { title: 'Positive tabindex can disrupt focus order', description: 'A focusable element uses a positive tabindex, which creates a custom order that diverges from the reading order.', impact: 'Keyboard and screen-reader users encounter controls in an unexpected order.', severity: 'moderate', profileIds: p, recommendation: 'Remove positive tabindex values and arrange the DOM in the intended focus order.', wcag: [WCAG.focusOrder, WCAG.keyboard], status: 'needs_review' }, [e]), 'tabindex', 'Focus order', [e]);
  }

  // Keyboard operation (motor, screen reader).
  if (probes.keyboard.attempted && probes.keyboard.trace.length) {
    const traceEvidence = probes.evidence.find(item => item.type === 'focus');
    if (probes.keyboard.repeatedFocus) {
      const p = pick('blindness', 'motor');
      const e = signalEvidence(context, 'focus', 'Keyboard Tab probe repeated a focus position, which may indicate a focus trap.', undefined, probes.keyboard.focusSequence.join(' → ').slice(0, 1000));
      add(p, finding(context, { title: 'Keyboard focus may be trapped', description: 'The Tab probe repeated a focus sequence. This is a runtime signal and requires checking the affected dialog or widget.', impact: 'Keyboard, switch and screen-reader users may be unable to reach the rest of the page.', severity: 'serious', profileIds: p, recommendation: 'Ensure focus can enter, operate and leave each component with the keyboard; contain focus only inside an open modal dialog.', wcag: [WCAG.noKeyboardTrap], status: 'needs_review' }, [e]), 'keyboard-trap', 'Keyboard reachability and traps', [e]);
    } else pass(pick('blindness', 'motor'), 'keyboard-trap', 'Keyboard reachability and traps', `The Tab probe moved through ${probes.keyboard.trace.filter(stop => stop.tag !== 'body').length} focus position(s) without repeating a sequence.`, traceEvidence ? [traceEvidence] : []);
    if (probes.keyboard.withoutIndicator.length) {
      const p = pick('motor');
      for (const stop of probes.keyboard.withoutIndicator.slice(0, 20)) {
        const e = signalEvidence(context, 'focus', `Focused ${stop.tag}${stop.name ? ` "${stop.name}"` : ''} showed no change in outline, shadow, border or background.`, { selector: stop.selector, html: '', text: stop.name });
        add(p, finding(context, { title: 'Focused control shows no visible focus indicator', description: 'Computed outline, box-shadow, border and background were identical in the focused and unfocused state.', impact: 'Sighted keyboard users cannot tell which control will be activated.', severity: 'serious', profileIds: p, selector: stop.selector, recommendation: 'Provide a visible focus style with at least 3:1 contrast against the adjacent colours, and never remove the outline without a replacement.', wcag: [WCAG.focusVisible], status: 'needs_review' }, [e]), 'focus-visible', 'Visible focus indicator', [e]);
      }
    } else pass(pick('motor'), 'focus-visible', 'Visible focus indicator', 'Every focused control changed its computed outline, shadow, border or background.', traceEvidence ? [traceEvidence] : []);
  }
  if (signals.smallTargets.length) {
    const p = pick('motor');
    const items = signals.smallTargets.slice(0, 25).map(signal => signalEvidence(context, 'measurement', `Interactive target measures ${signal.width}×${signal.height}px; the WCAG 2.2 minimum is 24×24px unless an exception applies.`, signal, `${signal.width}x${signal.height}px`));
    add(p, finding(context, { title: `${signals.smallTargets.length} interactive target(s) may be too small`, description: `${signals.smallTargets.length} target(s) measure under 24×24px in the captured viewport. Inline links in text and targets with sufficient spacing are exceptions that need review; each is listed in the evidence.`, impact: 'People with tremors or limited dexterity activate adjacent controls by accident.', severity: 'moderate', profileIds: p, recommendation: 'Make targets at least 24×24 CSS pixels or provide sufficient spacing and document applicable exceptions.', wcag: [WCAG.targetSize], status: 'needs_review' }, items), 'target-size', 'Target size', items);
  }
  if (!signals.smallTargets.length && signals.controlCount) pass(pick('motor'), 'target-size', 'Target size', `All ${signals.controlCount} visible control(s) measure at least 24×24px.`);
  for (const signal of signals.draggables) {
    const p = pick('motor');
    const e = signalEvidence(context, 'dom', 'Element is draggable.', signal);
    add(p, finding(context, { title: 'Draggable widget needs a single-pointer or keyboard alternative', description: 'The element is marked draggable; WCAG 2.2 requires an alternative that does not need dragging.', impact: 'People with limited dexterity cannot perform press-hold-move gestures.', severity: 'moderate', profileIds: p, recommendation: 'Offer buttons, a menu or keyboard operation that achieves the same result without dragging.', wcag: [WCAG.dragging], status: 'needs_review' }, [e]), 'dragging', 'Dragging and pointer-only patterns', [e]);
  }

  // Vision (low vision, colour).
  if (probes.reflow.attempted && probes.reflow.horizontalOverflow !== undefined) {
    const e = probes.evidence.find(item => item.description.startsWith('At 320px viewport width'))!;
    if (probes.reflow.horizontalOverflow > 0) add(pick('low-vision'), finding(context, { title: 'Page has horizontal overflow at narrow width', description: `The document was ${probes.reflow.horizontalOverflow}px wider than the viewport at 320px. Exceptions and the affected content still require human review.`, impact: 'People using high zoom need two-dimensional scrolling to complete the task.', severity: 'serious', profileIds: pick('low-vision'), recommendation: 'Make content reflow into one dimension at narrow widths and inspect any intentional exceptions.', wcag: [WCAG.reflow], status: 'needs_review' }, [e]), 'reflow', 'Reflow at 320px', [e]);
    else pass(pick('low-vision'), 'reflow', 'Reflow at 320px', 'No horizontal overflow at a 320px-wide viewport.', [e]);
  }
  if (probes.textResize.attempted && probes.textResize.overflowCount !== undefined) {
    const e = probes.evidence.find(item => item.description.startsWith('At 200% root text-size'))!;
    if (probes.textResize.overflowCount > 0) add(pick('low-vision'), finding(context, { title: 'Content may clip when text is enlarged', description: `The 200% text-size probe found ${probes.textResize.overflowCount} overflow candidate(s).`, impact: 'People who enlarge text lose content or controls.', severity: 'serious', profileIds: pick('low-vision'), recommendation: 'Allow text and controls to resize and reflow without clipping or overlap.', wcag: [WCAG.resizeText], status: 'needs_review' }, [e]), 'text-resize', 'Text resize and spacing', [e]);
    else pass(pick('low-vision'), 'text-resize', 'Text resize and spacing', 'No clipping candidates at 200% root text size.', [e]);
  }
  if (probes.textSpacing.attempted && probes.textSpacing.overflowCount !== undefined && probes.textSpacing.overflowCount > 0) {
    const p = pick('low-vision', 'cognitive');
    const e = probes.evidence.find(item => item.description.startsWith('At WCAG text-spacing'))!;
    add(p, finding(context, { title: 'Content may clip at text-spacing settings', description: `The text-spacing probe found ${probes.textSpacing.overflowCount} overflow candidate(s).`, impact: 'People using custom text spacing lose content or controls.', severity: 'serious', profileIds: p, recommendation: 'Allow content to expand and reflow at the WCAG text-spacing values.', wcag: [WCAG.textSpacing], status: 'needs_review' }, [e]), 'text-spacing-probe', 'Text resize and spacing', [e]);
  }
  if (signals.textSpacingRisks.length) {
    const p = pick('low-vision', 'cognitive');
    const items = signals.textSpacingRisks.slice(0, 25).map(signal => signalEvidence(context, 'dom', 'Text container clips overflow and may fail user-applied text spacing.', signal));
    add(p, finding(context, { title: `${signals.textSpacingRisks.length} text container(s) may clip when spacing is increased`, description: `${signals.textSpacingRisks.length} text-bearing element(s) hide overflow, which can hide content when users increase line, paragraph, word or letter spacing. Each is listed in the evidence.`, impact: 'People with low vision or dyslexia lose content or controls.', severity: 'moderate', profileIds: p, recommendation: 'Allow text to reflow and expand when users apply WCAG text-spacing adjustments.', wcag: [WCAG.textSpacing], status: 'needs_review' }, items), 'text-spacing', 'Text resize and spacing', items);
  }
  for (const signal of signals.likelyColorOnlyIndicators) {
    const p = pick('color-vision', 'low-vision');
    const e = signalEvidence(context, 'dom', 'Status/error candidate has no detected text or accessible icon alternative.', signal);
    add(p, finding(context, { title: 'Status may rely on color alone', description: 'An error/success/warning candidate has no detected textual or accessible alternative.', impact: 'Users who cannot distinguish colours miss the status or instruction.', severity: 'moderate', profileIds: p, recommendation: 'Add visible text, an accessible icon or another non-colour cue in addition to colour.', wcag: [WCAG.useOfColor, WCAG.errorIdentification], status: 'needs_review' }, [e]), 'color-only', 'Colour-only status candidates', [e]);
  }

  // Hearing.
  if (signals.mediaWithoutCaptions.length) {
    for (const signal of signals.mediaWithoutCaptions) {
      const e = signalEvidence(context, 'media', 'Video has no captions/subtitles track detected in its markup.', signal);
      add(pick('deafness'), finding(context, { title: 'Video has no captions track', description: 'The video element does not contain a captions or subtitles track.', impact: 'Deaf and hard-of-hearing users miss spoken information.', severity: 'serious', profileIds: pick('deafness'), recommendation: 'Provide synchronised captions and verify their accuracy, timing and completeness.', wcag: [WCAG.captionsPrerecorded], status: 'needs_review' }, [e]), 'captions', 'Captions and transcripts', [e]);
    }
  } else if (signals.videoCount) pass(pick('deafness'), 'captions', 'Captions and transcripts', `All ${signals.videoCount} video element(s) declare a captions or subtitles track. Caption quality requires review.`);
  else notApplicable(pick('deafness'), 'captions', 'Captions and transcripts', signals.audioCount ? `${signals.audioCount} audio element(s) found; ${signals.transcriptLinks} transcript link(s) detected.` : 'No audio or video elements in this state.');
  if (signals.autoplayMedia.length) {
    for (const signal of signals.autoplayMedia) {
      const p = pick('deafness', 'motion', 'cognitive');
      const e = signalEvidence(context, 'media', 'Media uses autoplay or loop.', signal);
      add(p, finding(context, { title: 'Media starts or loops automatically', description: 'The captured media markup includes autoplay or loop, or the media was playing when captured.', impact: 'Unexpected audio or movement obscures information and creates sensory barriers.', severity: 'moderate', profileIds: p, recommendation: 'Do not autoplay meaningful media; provide clear controls and a pause/stop mechanism.', wcag: [WCAG.audioControl, WCAG.pauseStopHide], status: 'needs_review' }, [e]), 'autoplay', 'Autoplaying media', [e]);
    }
  } else if (signals.videoCount + signals.audioCount) pass(pick('deafness', 'motion'), 'autoplay', 'Autoplaying media', 'No media element autoplays or loops.');

  // Motion.
  const running = signals.motionInventory.filter(item => item.playState === 'running');
  if (running.length) {
    const p = pick('motion', 'cognitive');
    const e = signalEvidence(context, 'motion', `${running.length} animation(s) were running when the state was captured.`, running[0], running.slice(0, 8).map(item => `${item.type}${item.name ? ` ${item.name}` : ''} ${item.durationMs ?? '?'}ms × ${item.iterations ?? 1}`).join('; '));
    add(p, finding(context, { title: 'Animated content needs motion review', description: `${running.length} animation(s) were running in the browser: ${running.slice(0, 5).map(item => item.name ?? item.type).join(', ')}.`, impact: 'Motion distracts users and can trigger vestibular symptoms; anything longer than five seconds needs a pause, stop or hide control.', severity: 'moderate', profileIds: p, recommendation: 'Respect prefers-reduced-motion, avoid forced movement and provide a way to pause or hide non-essential motion.', wcag: [WCAG.pauseStopHide], status: 'needs_review' }, [e]), 'running-animations', 'Animations running in the browser', [e]);
  } else pass(pick('motion'), 'running-animations', 'Animations running in the browser', 'No animation was running when the state was captured.');
  if (signals.flashCandidates.length) {
    const p = pick('motion');
    const e = signalEvidence(context, 'motion', `${signals.flashCandidates.length} infinite animation(s) cycle faster than three times per second.`, signals.flashCandidates[0], signals.flashCandidates.slice(0, 8).map(item => `${item.name ?? item.type} ${item.durationMs}ms`).join('; '));
    add(p, finding(context, { title: 'Fast repeating animation is a flash candidate', description: 'An infinite animation completes a cycle in under 334ms, so it may flash more than three times per second.', impact: 'Flashing above the general flash threshold can trigger seizures in people with photosensitive epilepsy.', severity: 'critical', profileIds: p, recommendation: 'Slow or remove the animation, keep flashing areas small and dim, and confirm with a frame-by-frame flash analysis.', wcag: [WCAG.threeFlashes], status: 'needs_review' }, [e]), 'flash-candidates', 'Flash candidates', [e]);
  } else pass(pick('motion'), 'flash-candidates', 'Flash candidates', 'No infinite animation cycles faster than three times per second.');
  if (probes.reducedMotion.attempted && probes.reducedMotion.animatedAfterPreference !== undefined) {
    const e = probes.evidence.find(item => item.description.startsWith('With prefers-reduced-motion'))!;
    if (probes.reducedMotion.animatedAfterPreference > 0) add(pick('motion'), finding(context, { title: 'Animation continues with reduced motion requested', description: `${probes.reducedMotion.animatedAfterPreference} animated element(s) remained after prefers-reduced-motion: reduce.`, impact: 'Motion remains unavoidable for people who need reduced motion.', severity: 'moderate', profileIds: pick('motion'), recommendation: 'Provide a reduced-motion presentation and preserve task information without forced animation.', wcag: [WCAG.pauseStopHide], status: 'needs_review' }, [e]), 'reduced-motion', 'Reduced-motion support', [e]);
    else pass(pick('motion'), 'reduced-motion', 'Reduced-motion support', signals.hasReducedMotionRule ? 'A prefers-reduced-motion rule exists and no infinite animation remained.' : 'No infinite animation remained with reduced motion requested.', [e]);
  }

  // Cognition.
  if (signals.autocompleteGaps.length) {
    const items = signals.autocompleteGaps.slice(0, 20).map(signal => signalEvidence(context, 'dom', 'Personal-data field has no autocomplete token.', signal));
    add(pick('cognitive'), finding(context, { title: `${signals.autocompleteGaps.length} personal-data field(s) cannot be autofilled`, description: `${signals.autocompleteGaps.length} field(s) that appear to collect personal data have no autocomplete attribute. Each is listed in the evidence.`, impact: 'People with memory or attention difficulties must recall and retype information the browser could fill in.', severity: 'moderate', profileIds: pick('cognitive'), recommendation: 'Add the matching autocomplete token (for example email, tel, given-name, postal-code).', wcag: [WCAG.identifyInputPurpose, WCAG.redundantEntry], status: 'needs_review' }, items), 'input-purpose', 'Autofill and redundant entry', items);
  } else if (signals.personalFieldCount) pass(pick('cognitive'), 'input-purpose', 'Autofill and redundant entry', `All ${signals.personalFieldCount} personal-data field(s) declare an autocomplete token.`);
  else notApplicable(pick('cognitive'), 'input-purpose', 'Autofill and redundant entry', 'No personal-data fields in this state.');
  for (const signal of signals.contextChangeRisks) {
    const p = pick('cognitive', 'blindness', 'motion');
    const e = signalEvidence(context, 'dom', 'Automatic refresh or navigation on input change detected.', signal);
    add(p, finding(context, { title: 'Page may change context without a user request', description: 'A meta refresh or an input-change handler that navigates was detected.', impact: 'Unexpected reloads and navigation disorient users and interrupt screen-reader reading and typing.', severity: 'moderate', profileIds: p, recommendation: 'Remove automatic refresh, or let the user trigger the change with an explicit control and warn in advance.', wcag: [WCAG.onInput, WCAG.timingAdjustable], status: 'needs_review' }, [e]), 'context-change', 'Unexpected changes of context', [e]);
  }

  for (const profile of selected) {
    const checks = checksByProfile.get(profile.id)!;
    if (!checks.length) checks.push(check('specialist-review', 'Perspective review', 'needs_review', 'gemini', [], 'No deterministic signal was observed; the specialist reviews this state from its perspective.'));
  }
  const outputProfiles = selected.map(profile => resultFor(profile.id, checksByProfile.get(profile.id)!));
  const aggregated = aggregateFindings(findings);
  return { findings: aggregated, profiles: outputProfiles, evidence: [...new Map([...evidence, ...aggregated.flatMap(f => f.evidence)].map(item => [item.id, item])).values()], limitations: [...new Set(selected.flatMap(profile => profile.limitations))] };
}

/** Compatibility aliases for the browser worker adapter. */
export const runAuditChecks = runAutomatedChecks;
export const runBrowserCheckers = runAutomatedChecks;
