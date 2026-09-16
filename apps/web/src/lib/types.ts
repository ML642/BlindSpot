import type { Audit, AuditEvent } from '@blindspot/shared';

export type Health = { geminiConfigured: boolean; mode: string; demo?: {
  maxProfiles: number; maxActions: number; maxPageStates: number; maxSeconds: number;
  remaining: number; auditsPerDay: number; busyUntil: number | null; resetAt: number | null;
} };
export type Screen = 'form' | 'running' | 'report';
export type { Audit, AuditEvent };
