import type { Audit, AuditEvent, Health } from './types';

export const API = '/api';

export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`);
  return payload as T;
}

export const getAudit = (id: string) => apiJson<Audit>(`/audits/${encodeURIComponent(id)}`);
export const getEvents = (id: string, after: number, signal?: AbortSignal) => apiJson<{ events: AuditEvent[] }>(`/audits/${encodeURIComponent(id)}/events?after=${after}`, { signal });
export const getHealth = () => apiJson<Health>('/health');
export const artifactUrl = (auditId: string, artifactId?: string) => artifactId ? `${API}/audits/${encodeURIComponent(auditId)}/artifacts/${encodeURIComponent(artifactId)}` : undefined;
