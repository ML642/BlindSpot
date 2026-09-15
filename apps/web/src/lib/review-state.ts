export type ReviewStatus = 'open' | 'seen' | 'resolved';
export type ReviewMarks = Partial<Record<string, Exclude<ReviewStatus, 'open'>>>;
export const reviewRank: Record<ReviewStatus, number> = { open: 0, seen: 1, resolved: 2 };
export const reviewKey = (auditId: string) => `blindspot:review:v1:${auditId}`;

export function parseReviewMarks(raw: string | null): ReviewMarks {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review data');
  return Object.fromEntries(Object.entries(value).filter(([, status]) => status === 'seen' || status === 'resolved')) as ReviewMarks;
}

export function updateReviewMark(marks: ReviewMarks, findingId: string, status: ReviewStatus): ReviewMarks {
  const next = { ...marks };
  if (status === 'open') delete next[findingId];
  else Object.defineProperty(next, findingId, { value: status, enumerable: true, configurable: true, writable: true });
  return next;
}

export function loadReviewMarks(auditId: string): { marks: ReviewMarks; warning: string } {
  try { return { marks: parseReviewMarks(localStorage.getItem(reviewKey(auditId))), warning: '' }; }
  catch { return { marks: {}, warning: 'Saved review marks could not be read in this browser.' }; }
}
