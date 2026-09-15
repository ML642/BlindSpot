import type { Finding, Evidence, ProfileId, PlaybookResult, Severity, TestStatus } from '@blindspot/shared';
import { getPlaybooks } from './playbooks.js';
import { WCAG } from './wcag.js';
import type { AutomatedAuditResult, AxeResultsLike, AxeRuleLike, BrowserPageLike, CheckerContext, DomSignals, InteractionProbeReport, SignalNode } from './types.js';
import { aggregateFindings } from './aggregate.js';


/** tsx preserves function names using __name; bind it inside serialized probes. */
function evaluateInPage<T>(page: BrowserPageLike, fn: () => T | Promise<T>): Promise<T> {
  return page.evaluate<T>(`((__name) => (${fn.toString()})())((fn) => fn)`);
}

const allProfileIds: ProfileId[] = getPlaybooks().map(playbook => playbook.id);

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
  const status: TestStatus = hasFail ? 'fail' : hasReview ? 'needs_review' : checks.length ? 'pass' : 'not_applicable';
  return { profileId, status, summary: hasFail ? 'One or more automated checks found issues.' : hasReview ? 'Automated checks require specialist or manual review.' : checks.length ? 'Automated checks found no failures.' : 'No applicable checks ran.', checks };
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

function axeProfiles(ruleId: string): ProfileId[] {
  const map: Record<string, ProfileId[]> = {
    'area-alt': ['blindness', 'low-vision'],
    'aria-allowed-attr': ['blindness', 'paralysis'],
    'aria-command-name': ['blindness', 'paralysis'],
    'aria-hidden-body': ['blindness'],
    'aria-hidden-focus': ['blindness', 'paralysis'],
    'aria-input-field-name': ['blindness'],
    'aria-required-attr': ['blindness'],
    'aria-roles': ['blindness'],
    'aria-valid-attr-value': ['blindness'],
    'aria-valid-attr': ['blindness'],
    'button-name': ['blindness', 'paralysis'],
    'color-contrast': ['low-vision', 'color-vision'],
    'document-title': ['blindness', 'low-vision'],
    'heading-order': ['blindness', 'dyslexia'],
    'html-has-lang': ['blindness', 'dyslexia'],
    'image-alt': ['blindness', 'low-vision'],
    'input-button-name': ['blindness', 'paralysis'],
    label: ['blindness', 'cognitive', 'memory'],
    'link-name': ['blindness', 'paralysis'],
    'nested-interactive': ['blindness', 'motor'],
    'select-name': ['blindness', 'cognitive'],
    tabindex: ['blindness', 'paralysis'],
    'video-caption': ['deafness', 'hard-of-hearing'],
  };
  return map[ruleId] ?? allProfileIds;
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
      return [element.getAttribute('aria-label') ?? '', ids, label, (element as HTMLInputElement).placeholder ?? '', (element.textContent ?? '')].join(' ').trim();
    };
    const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [tabindex]')];
    const imagesWithoutAlt = [...document.images].filter(image => isVisible(image) && !image.hasAttribute('alt') && image.getAttribute('role') !== 'presentation' && image.getAttribute('aria-hidden') !== 'true').map(snippet);
    const controlsWithoutLabel = controls.filter(element => isVisible(element) && !name(element) && element.getAttribute('aria-hidden') !== 'true').map(snippet);
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(isVisible);
    const headingJumps: DomSignals['headingJumps'] = [];
    headings.forEach((heading, index) => {
      if (!index) return;
      const from = Number(headings[index - 1].tagName.substring(1));
      const to = Number(heading.tagName.substring(1));
      if (to > from + 1) headingJumps.push({ from, to, selector: selectorFor(heading), text: (heading.textContent ?? '').trim().slice(0, 160) });
    });
    const positiveTabindices = controls.filter(element => Number(element.getAttribute('tabindex')) > 0).map(snippet);
    const smallTargets = controls.filter(element => isVisible(element)).map(element => ({ ...snippet(element), width: Math.round((element as HTMLElement).getBoundingClientRect().width), height: Math.round((element as HTMLElement).getBoundingClientRect().height) })).filter(item => item.width < 24 || item.height < 24);
    const media = [...document.querySelectorAll('audio,video')].filter(isVisible);
    const mediaWithoutCaptions = media.filter(element => element.tagName.toLowerCase() === 'video' && !element.querySelector('track[kind="captions"], track[kind="subtitles"]')).map(snippet);
    const autoplayMedia = media.filter(element => element.hasAttribute('autoplay') || element.hasAttribute('loop')).map(snippet);
    const animatedElements = [...document.querySelectorAll('*')].filter(element => {
      if (!isVisible(element)) return false;
      const style = getComputedStyle(element);
      return style.animationName !== 'none' || style.transitionDuration !== '0s' || style.scrollBehavior === 'smooth';
    }).slice(0, 100).map(snippet);
    const styleText = [...document.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n');
    const hasReducedMotionRule = /prefers-reduced-motion\s*:\s*reduce/i.test(styleText);
    const likelyColorOnlyIndicators = [...document.querySelectorAll('[class*="error" i], [class*="success" i], [class*="warning" i], [aria-invalid="true"]')].filter(isVisible).filter(element => {
      const text = (element.textContent ?? '').trim();
      const labelled = element.getAttribute('aria-label') || element.getAttribute('title') || element.querySelector('svg, [role="img"]');
      return !text && !labelled;
    }).map(snippet);
    const textSpacingRisks = [...document.querySelectorAll('p, li, label, button, a, input, textarea')].filter(isVisible).filter(element => {
      const style = getComputedStyle(element);
      return style.overflow === 'hidden' && (element.textContent ?? '').trim().length > 10;
    }).map(snippet);
    return { imagesWithoutAlt, controlsWithoutLabel, headingJumps, positiveTabindices, smallTargets, mediaWithoutCaptions, autoplayMedia, animatedElements, hasReducedMotionRule, likelyColorOnlyIndicators, textSpacingRisks };
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
  const keyboard = { attempted: Boolean(page.keyboard), focusSequence: [] as string[], repeatedFocus: false, focusableCount: 0 };
  if (page.keyboard) {
    try {
      keyboard.focusableCount = await evaluateInPage(page, () => document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])').length);
      for (let i = 0; i < Math.min(40, keyboard.focusableCount + 3); i += 1) {
        await page.keyboard.press('Tab');
        const focus = await evaluateInPage(page, () => {
          const element = document.activeElement;
          if (!element || element === document.body) return 'body';
          if ((element as HTMLElement).id) return `#${(element as HTMLElement).id}`;
          return `${element.tagName.toLowerCase()}${element.getAttribute('name') ? `[name="${element.getAttribute('name')}"]` : ''}`;
        });
        keyboard.focusSequence.push(focus);
      }
      keyboard.repeatedFocus = keyboard.focusSequence.length > 2 && keyboard.focusSequence.every((item, index, array) => index < 2 || item === array[index - 2]);
      evidence.push(signalEvidence(context, 'accessibility', `Keyboard Tab probe visited ${keyboard.focusSequence.length} focus position(s).`, undefined, keyboard.focusSequence.join(' → ')));
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
      reducedMotion.animatedAfterPreference = await evaluateInPage(page, () => Array.from(document.querySelectorAll('*')).filter(element => {
        const style = getComputedStyle(element);
        return style.animationName !== 'none' && style.animationDuration !== '0s';
      }).length);
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
  };
  return map[ruleId] ?? [];
}

function addAxeFindings(context: CheckerContext, results: AxeResultsLike | undefined, allowedProfiles?: ReadonlySet<string>): { findings: Finding[]; evidence: Evidence[] } {
  if (!results?.violations?.length) return { findings: [], evidence: [] };
  const findings: Finding[] = [];
  const evidence: Evidence[] = [];
  for (const rule of results.violations) {
    const profileIds = axeProfiles(rule.id).filter(profileId => !allowedProfiles || allowedProfiles.has(profileId));
    if (!profileIds.length) continue;
    const nodes = rule.nodes ?? [];
    const nodeEvidence = nodes.slice(0, 25).map(node => {
      const selector = node.target?.[0];
      const item = signalEvidence(context, 'axe', `${rule.help}: ${node.failureSummary ?? 'Automated rule violation'}`, selector ? { selector, html: node.html ?? '' } : undefined, rule.helpUrl);
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
  const signals = await collectDomSignals(context.page);
  const probes = context.skipInteractionProbes ? { keyboard: { attempted: false, repeatedFocus: false, focusSequence: [], focusableCount: 0 }, reflow: { attempted: false, horizontalOverflow: undefined }, textResize: { attempted: false, overflowCount: undefined }, textSpacing: { attempted: false, overflowCount: undefined }, reducedMotion: { attempted: false, animatedAfterPreference: undefined }, evidence: [] } : await runInteractionProbes({ ...context, page: context.probePage ?? context.page });
  const axe = addAxeFindings(context, await axeResults(context), selectedIds);
  const findings: Finding[] = [...axe.findings];
  const evidence: Evidence[] = [...axe.evidence, ...probes.evidence];
  const checksByProfile = new Map<ProfileId, PlaybookResult['checks']>();
  for (const profile of selected) checksByProfile.set(profile.id, []);
  const add = (profileIds: ProfileId[], item: Finding, checkId: string, title: string, evidenceItems: Evidence[]) => {
    findings.push(item);
    evidence.push(...evidenceItems);
    for (const profileId of profileIds) {
      const checks = checksByProfile.get(profileId);
      if (checks) checks.push(check(checkId, title, item.status, item.method, evidenceItems, item.description));
    }
  };
  for (const profile of selected) {
    const ruleFindings = axe.findings.filter(f => f.profileIds.includes(profile.id));
    for (const item of ruleFindings) checksByProfile.get(profile.id)!.push(check(`axe-${item.id}`, 'Automated axe rules', item.status, 'tool', item.evidence, `${item.title}: ${item.description}`));
  }
  if (probes.keyboard.repeatedFocus) {
    const p = ['blindness', 'motor', 'paralysis'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) {
      const e = signalEvidence(context, 'accessibility', 'Keyboard Tab probe repeated a focus position, which may indicate a focus trap.', undefined, probes.keyboard.focusSequence.join(' → '));
      add(p, finding(context, { title: 'Keyboard focus may be trapped', description: 'The Tab probe repeated a focus sequence. This is a runtime signal and requires checking the affected dialog or widget.', impact: 'Keyboard and switch users may be unable to reach the rest of the page.', severity: 'serious', profileIds: p, recommendation: 'Ensure focus can enter, operate and leave each component with the keyboard; verify dialogs intentionally contain focus only while open.', wcag: [WCAG.noKeyboardTrap], status: 'needs_review' }, [e]), 'keyboard-trap', 'Keyboard traversal', [e]);
    }
  }
  if (probes.reflow.horizontalOverflow && probes.reflow.horizontalOverflow > 0) {
    const p = ['low-vision', 'temporary'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) {
      const e = probes.evidence.find(item => item.description.startsWith('At 320px viewport width'))!;
      add(p, finding(context, { title: 'Page has horizontal overflow at narrow width', description: `The document was ${probes.reflow.horizontalOverflow}px wider than the viewport at 320px. Exceptions and the affected content still require human review.`, impact: 'People using high zoom or a narrow device may need two-dimensional scrolling to complete the task.', severity: 'serious', profileIds: p, recommendation: 'Make content reflow into one dimension at narrow widths and inspect any intentional exceptions.', wcag: [WCAG.reflow], status: 'needs_review' }, [e]), 'reflow', 'Responsive reflow', [e]);
    }
  }
  if (probes.textResize.overflowCount && probes.textResize.overflowCount > 0) {
    const p = ['low-vision', 'dyslexia'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) {
      const e = probes.evidence.find(item => item.description.startsWith('At 200% root text-size'))!;
      add(p, finding(context, { title: 'Content may clip when text is enlarged', description: `The 200% text-size probe found ${probes.textResize.overflowCount} overflow candidate(s).`, impact: 'People who enlarge text may lose content or controls.', severity: 'serious', profileIds: p, recommendation: 'Allow text and controls to resize and reflow without clipping or overlap.', wcag: [WCAG.resizeText], status: 'needs_review' }, [e]), 'text-resize', 'Text resize', [e]);
    }
  }
  if (probes.textSpacing.overflowCount && probes.textSpacing.overflowCount > 0) {
    const p = ['low-vision', 'dyslexia'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) {
      const e = probes.evidence.find(item => item.description.startsWith('At WCAG text-spacing'))!;
      add(p, finding(context, { title: 'Content may clip at text-spacing settings', description: `The text-spacing probe found ${probes.textSpacing.overflowCount} overflow candidate(s).`, impact: 'People using custom text spacing may lose content or controls.', severity: 'serious', profileIds: p, recommendation: 'Allow content to expand and reflow at the WCAG text-spacing values.', wcag: [WCAG.textSpacing], status: 'needs_review' }, [e]), 'text-spacing-probe', 'Text spacing', [e]);
    }
  }
  if (probes.reducedMotion.animatedAfterPreference && probes.reducedMotion.animatedAfterPreference > 0) {
    const p = ['autism', 'adhd', 'photosensitive', 'vestibular'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) {
      const e = probes.evidence.find(item => item.description.startsWith('With prefers-reduced-motion'))!;
      add(p, finding(context, { title: 'Animation continues with reduced motion requested', description: `${probes.reducedMotion.animatedAfterPreference} animated element(s) remained after prefers-reduced-motion: reduce.`, impact: 'Motion may remain unavoidable for people who need reduced motion; flashing candidates require specialist review.', severity: 'moderate', profileIds: p, recommendation: 'Provide a reduced-motion presentation and preserve task information without forced animation.', wcag: [WCAG.pauseStopHide], status: 'needs_review' }, [e]), 'reduced-motion', 'Reduced motion', [e]);
    }
  }
  if (signals.imagesWithoutAlt.length) {
    for (const signal of signals.imagesWithoutAlt) {
      const p = ['blindness', 'low-vision'].filter(id => selectedIds.has(id)) as ProfileId[];
      if (!p.length) continue;
      const e = signalEvidence(context, 'dom', 'Visible image has no alt attribute.', signal);
      add(p, finding(context, { title: 'Image is missing alternative text', description: 'A visible image has no alt attribute, so its purpose may be unavailable to screen-reader users.', impact: 'The image may be announced as its filename or omitted without conveying its purpose.', severity: 'serious', profileIds: p, recommendation: 'Add concise alt text when the image conveys information, or use alt="" for decorative images.', wcag: [WCAG.nonText] }, [e]), 'image-alt', 'Alternative text', [e]);
    }
  }
  if (signals.controlsWithoutLabel.length) {
    for (const signal of signals.controlsWithoutLabel) {
      const p = ['blindness', 'cognitive', 'memory', 'paralysis'].filter(id => selectedIds.has(id)) as ProfileId[];
      if (!p.length) continue;
      const e = signalEvidence(context, 'dom', 'Interactive control has no detected accessible label.', signal);
      add(p, finding(context, { title: 'Interactive control has no accessible label', description: 'A focusable control has no detected text, label, aria-label or aria-labelledby.', impact: 'People using screen readers or voice control may not know what the control does.', severity: 'serious', profileIds: p, recommendation: 'Give the control a persistent visible label where possible and expose the same name through a native label or aria-labelledby.', wcag: [WCAG.nameRoleValue, WCAG.labelsInstructions, WCAG.labelInName] }, [e]), 'control-label', 'Control labels', [e]);
    }
  }
  if (signals.headingJumps.length) {
    const p = ['blindness', 'dyslexia'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.headingJumps) {
      const e = signalEvidence(context, 'dom', `Heading level jumps from h${signal.from} to h${signal.to}.`, { selector: signal.selector, html: '', text: signal.text });
      add(p, finding(context, { title: 'Heading hierarchy skips a level', description: `The heading sequence jumps from h${signal.from} to h${signal.to}.`, impact: 'A screen-reader user may lose the document structure and a reader may struggle to scan sections.', severity: 'moderate', profileIds: p, selector: signal.selector, recommendation: 'Use heading levels in a logical hierarchy that reflects the content structure.', wcag: [WCAG.infoRelationships, WCAG.headingsLabels], status: 'needs_review' }, [e]), 'heading-order', 'Heading hierarchy', [e]);
    }
  }
  if (signals.positiveTabindices.length) {
    const p = ['blindness', 'paralysis'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.positiveTabindices) {
      const e = signalEvidence(context, 'dom', 'Element uses a positive tabindex.', signal);
      add(p, finding(context, { title: 'Positive tabindex can disrupt focus order', description: 'A focusable element uses a positive tabindex, which can create a custom order that diverges from the DOM.', impact: 'Keyboard and assistive-technology users may encounter controls in an unexpected order.', severity: 'moderate', profileIds: p, recommendation: 'Remove positive tabindex values and arrange the DOM in the intended focus order.', wcag: [WCAG.focusOrder, WCAG.keyboard], status: 'needs_review' }, [e]), 'tabindex', 'Focus order', [e]);
    }
  }
  if (signals.smallTargets.length) {
    const p = ['motor', 'paralysis', 'tremors', 'temporary'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.smallTargets.slice(0, 30)) {
      const e = signalEvidence(context, 'measurement', `Interactive target measures ${signal.width}×${signal.height}px; automated check uses the WCAG 2.2 24×24px minimum signal.`, signal, `${signal.width}x${signal.height}px`);
      add(p, finding(context, { title: 'Interactive target may be too small', description: `The target is ${signal.width}×${signal.height}px in the captured viewport.`, impact: 'People with tremors or limited dexterity may activate adjacent controls accidentally.', severity: 'moderate', profileIds: p, recommendation: 'Make the target at least 24×24 CSS pixels or provide sufficient spacing and an applicable exception.', wcag: [WCAG.targetSize], status: 'needs_review' }, [e]), 'target-size', 'Target size', [e]);
    }
  }
  if (signals.mediaWithoutCaptions.length) {
    const p = ['deafness', 'hard-of-hearing', 'temporary'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.mediaWithoutCaptions) {
      const e = signalEvidence(context, 'dom', 'Video has no captions/subtitles track detected in its markup.', signal);
      add(p, finding(context, { title: 'Video has no captions track', description: 'The video element does not contain a captions or subtitles track.', impact: 'Deaf and hard-of-hearing users may miss spoken information.', severity: 'serious', profileIds: p, recommendation: 'Provide synchronized captions and verify their accuracy, timing and completeness.', wcag: [WCAG.captionsPrerecorded], status: 'needs_review' }, [e]), 'captions', 'Media captions', [e]);
    }
  }
  if (signals.autoplayMedia.length) {
    const p = ['deafness', 'hard-of-hearing', 'autism', 'temporary'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.autoplayMedia) {
      const e = signalEvidence(context, 'dom', 'Media uses autoplay or loop.', signal);
      add(p, finding(context, { title: 'Media starts or loops automatically', description: 'The captured media markup includes autoplay or loop.', impact: 'Unexpected audio or movement can obscure information and create sensory barriers.', severity: 'moderate', profileIds: p, recommendation: 'Do not autoplay meaningful media; provide clear controls and a pause/stop mechanism.', wcag: [WCAG.audioControl], status: 'needs_review' }, [e]), 'autoplay', 'Autoplay media', [e]);
    }
  }
  if (signals.animatedElements.length) {
    const p = ['adhd', 'autism', 'photosensitive', 'vestibular'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) {
      const e = signalEvidence(context, 'dom', `${signals.animatedElements.length} visible element(s) use animation or transition styles.`, signals.animatedElements[0], signals.hasReducedMotionRule ? 'prefers-reduced-motion rule detected' : 'no prefers-reduced-motion rule detected');
      add(p, finding(context, { title: 'Animated content needs motion review', description: 'Visible elements use CSS animation, transition or smooth scrolling.', impact: 'Motion may distract users or cause vestibular symptoms; flashing candidates require specialist review.', severity: 'moderate', profileIds: p, recommendation: 'Offer a reduced-motion presentation, avoid forced movement and review animation frequency and area.', wcag: [WCAG.pauseStopHide], status: 'needs_review' }, [e]), 'motion', 'Motion and reduced motion', [e]);
    }
  }
  if (signals.likelyColorOnlyIndicators.length) {
    const p = ['color-vision', 'low-vision', 'cognitive'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.likelyColorOnlyIndicators) {
      const e = signalEvidence(context, 'dom', 'Status/error candidate has no detected text or accessible icon alternative.', signal);
      add(p, finding(context, { title: 'Status may rely on color alone', description: 'An error/success/warning candidate has no detected textual or accessible alternative.', impact: 'Users who cannot distinguish colors may miss the status or instruction.', severity: 'moderate', profileIds: p, recommendation: 'Add visible text, an accessible icon or another non-color cue in addition to color.', wcag: [WCAG.useOfColor, WCAG.errorIdentification], status: 'needs_review' }, [e]), 'color-only', 'Color-independent information', [e]);
    }
  }
  if (signals.textSpacingRisks.length) {
    const p = ['low-vision', 'dyslexia'].filter(id => selectedIds.has(id)) as ProfileId[];
    if (p.length) for (const signal of signals.textSpacingRisks) {
      const e = signalEvidence(context, 'dom', 'Text container clips overflow and may fail user-applied text spacing.', signal);
      add(p, finding(context, { title: 'Text may clip when spacing is increased', description: 'A text-bearing element has hidden overflow, which can hide content when users increase line, paragraph, word or letter spacing.', impact: 'People with low vision or dyslexia may lose content or controls.', severity: 'moderate', profileIds: p, recommendation: 'Allow text to reflow and expand when users apply WCAG text-spacing adjustments.', wcag: [WCAG.textSpacing], status: 'needs_review' }, [e]), 'text-spacing', 'Text spacing', [e]);
    }
  }
  for (const profile of selected) {
    const checks = checksByProfile.get(profile.id)!;
    if (!checks.length) checks.push(check('specialist-review', 'Scenario and assistive-technology review', 'needs_review', 'gemini', [], 'No deterministic failure was observed; review the scenario with the profile playbook and human assistive technology.'));
  }
  const outputProfiles = selected.map(profile => resultFor(profile.id, checksByProfile.get(profile.id)!));
  const aggregated = aggregateFindings(findings);
  return { findings: aggregated, profiles: outputProfiles, evidence: [...new Map([...evidence, ...aggregated.flatMap(f => f.evidence)].map(item => [item.id, item])).values()], limitations: [...new Set(selected.flatMap(profile => profile.limitations))] };
}

/** Compatibility aliases for the browser worker adapter. */
export const runAuditChecks = runAutomatedChecks;
export const runBrowserCheckers = runAutomatedChecks;
