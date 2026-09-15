import type { Finding, PageState, PlaybookResult, ProfileId, Evidence, InteractionMode } from '@blindspot/shared';

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
  /** Precomputed DOM signals; collected from the page when absent. */
  signals?: DomSignals;
  /** Receives the raw interaction probe report so the caller can store the focus trace. */
  onProbes?: (report: InteractionProbeReport) => void | Promise<void>;
  /** Capture is optional; diagnostics remain useful without artifact storage. */
  addEvidence?: (evidence: Omit<Evidence, 'id'> & { id?: string }) => Evidence;
}

/** What a specialist is allowed to see. Each channel maps to concrete evidence in the worker. */
export type EvidenceChannel =
  | 'speech'
  | 'journey-transcript'
  | 'focus-trace'
  | 'screenshot'
  | 'simulation'
  | 'visible-text'
  | 'dom'
  | 'accessibility-tree'
  | 'axe'
  | 'measurements'
  | 'media-inventory'
  | 'motion-inventory';

/** Alternative renderings captured for a page state. Vision deficiencies use Chromium's emulation. */
export type Rendering =
  | 'blurredVision'
  | 'reducedContrast'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'achromatopsia'
  | 'narrow-viewport'
  | 'large-text';

export interface Perspective {
  interaction: InteractionMode;
  channels: EvidenceChannel[];
  renderings: Rendering[];
  /** Second-person description of what the specialist and navigation agent perceive. */
  persona: string;
  /** Explicit statement of what must not be inferred. */
  forbidden: string;
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
  perspective: Perspective;
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

export interface MediaItem extends SignalNode {
  kind: 'audio' | 'video';
  src?: string;
  controls: boolean;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  tracks: Array<{ kind: string; label: string; language: string }>;
}

export interface MotionItem extends SignalNode {
  type: string;
  name?: string;
  durationMs?: number;
  iterations?: number | 'infinite';
  playState?: string;
}

export interface DomSignals {
  title: string;
  lang?: string;
  landmarks: string[];
  headings: Array<{ level: number; text: string }>;
  imageCount: number;
  controlCount: number;
  personalFieldCount: number;
  videoCount: number;
  audioCount: number;
  imagesWithoutAlt: SignalNode[];
  controlsWithoutLabel: SignalNode[];
  headingJumps: Array<{ from: number; to: number; selector: string; text: string }>;
  positiveTabindices: SignalNode[];
  smallTargets: Array<SignalNode & { width: number; height: number }>;
  mediaInventory: MediaItem[];
  mediaWithoutCaptions: SignalNode[];
  autoplayMedia: SignalNode[];
  transcriptLinks: number;
  motionInventory: MotionItem[];
  flashCandidates: MotionItem[];
  hasReducedMotionRule: boolean;
  likelyColorOnlyIndicators: SignalNode[];
  textSpacingRisks: SignalNode[];
  draggables: SignalNode[];
  autocompleteGaps: SignalNode[];
  contextChangeRisks: SignalNode[];
}

export interface FocusStop {
  index: number;
  tag: string;
  role?: string;
  name: string;
  selector: string;
  inViewport: boolean;
  /** Whether outline, box-shadow, border or background changed between focused and blurred state. */
  indicatorChanged?: boolean;
}

export interface InteractionProbeReport {
  keyboard: { attempted: boolean; focusSequence: string[]; trace: FocusStop[]; repeatedFocus: boolean; focusableCount: number; withoutIndicator: FocusStop[] };
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
