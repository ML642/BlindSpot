import type { Audit, AuditEvent } from '@blindspot/shared';

export type Health = { geminiConfigured: boolean; mode: string };
export type Screen = 'form' | 'running' | 'report';
export type AuditStart = { id: string };
export type EventList = { events: AuditEvent[] };
export type { Audit, AuditEvent };
