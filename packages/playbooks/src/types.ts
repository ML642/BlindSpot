import type { Finding, PageState, PlaybookResult, ProfileId, Evidence } from '@blindspot/shared';

/** The small portion of Playwright's Page used by the checker package.
 * Keeping this structural means the browser package can own its Playwright dependency.
 */
export interface BrowserPageLike {
  url(): string;
  title(): Promise<string>;
  evaluate<T, A = unknown>(
    pageFunction: ((arg: A) => T | Promise<T>) | string,
    arg?: A,
  ): Promise<T>;
  keyboard?: { press(key: string): Promise<void> };
  viewportSize?: () => { width: number; height: number } | null;
  setViewportSize?: (size: { width: number; height: number }) => Promise<void>;
  emulateMedia?: (options: { reducedMotion?: 'reduce' | 'no-preference' | null }) => Promise<void>;
  screenshot?: (options?: { fullPage?: boolean }) => Promise<Uint8Array>;
}

export interface AxeNodeLike {
  any?: Array<{ id?: string; data?: unknown; message?: string }>;
  all?: Array<{ id?: string; data?: unknown; message?: string }>;
  none?: Array<{ id?: string; data?: unknown; message?: string }>;
  incomplete?: Array<{ id?: string; data?: unknown; message?: string }>;
  html?: string;
  target?: string[];
  failureSummary?: string;
}

export interface AxeRuleLike {
  id: string;
  tags?: string[];
  impact?: string | null;
  description?: string;
  help: string;
  helpUrl?: string;
  nodes: AxeNodeLike[];
}

export interface AxeResultsLike {
  violations?: AxeRuleLike[];
  incomplete?: AxeRuleLike[];
  passes?: AxeRuleLike[];
}

export interface CheckerContext {
  page: BrowserPageLike;
  probePage?: BrowserPageLike;
  skipInteractionProbes?: boolean;
  pageState: PageState;
  /** The backend may inject the result of AxeBuilder({ page }).analyze(). */
  axeResults?: AxeResultsLike;
  /** Or inject a lazy runner; this keeps axe optional for local/demo use. */
  runAxe?: () => Promise<AxeResultsLike>;
  /** Capture is optional; diagnostics remain useful without artifact storage. */
  addEvidence?: (evidence: Omit<Evidence, 'id'> & { id?: string }) => Evidence;
}

export interface PlaybookCheckDefinition {
  id: string;
  title: string;
  purpose: string;
  wcag: WcagReference[];
  method: 'tool' | 'gemini';
}

export interface WcagReference {
  id: string;
  title: string;
  url: string;
}

export interface PlaybookDefinition {
  id: ProfileId;
  name: string;
  group: string;
  description: string;
  prompt: string;
  checks: PlaybookCheckDefinition[];
  limitations: string[];
  wcag: WcagReference[];
}

export interface AutomatedAuditResult {
  findings: Finding[];
  profiles: PlaybookResult[];
  evidence: Evidence[];
  limitations: string[];
}

export interface DomSignals {
  imagesWithoutAlt: SignalNode[];
  controlsWithoutLabel: SignalNode[];
  headingJumps: Array<{ from: number; to: number; selector: string; text: string }>;
  positiveTabindices: SignalNode[];
  smallTargets: Array<SignalNode & { width: number; height: number }>;
  mediaWithoutCaptions: SignalNode[];
  autoplayMedia: SignalNode[];
  animatedElements: SignalNode[];
  hasReducedMotionRule: boolean;
  likelyColorOnlyIndicators: SignalNode[];
  textSpacingRisks: SignalNode[];
}

export interface InteractionProbeReport {
  keyboard: { attempted: boolean; focusSequence: string[]; repeatedFocus: boolean; focusableCount: number };
  reflow: { attempted: boolean; viewport?: { width: number; height: number }; horizontalOverflow?: number };
  textResize: { attempted: boolean; overflowCount?: number };
  textSpacing: { attempted: boolean; overflowCount?: number };
  reducedMotion: { attempted: boolean; animatedAfterPreference?: number };
  evidence: Evidence[];
}

export interface SignalNode {
  selector: string;
  html: string;
  text?: string;
  tag?: string;
}

export interface FindingAggregationOptions {
  /** Keep separate findings when the same rule has different page states. */
  preservePageStates?: boolean;
}
