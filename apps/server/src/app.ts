import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig, type ServerConfig } from './config.js';
import { createArtifactStore } from './storage.js';
import { AuditManager } from './manager.js';
import { UnsafeUrlError } from './security.js';

export async function createApp(config: ServerConfig = loadConfig()) {
  const app = Fastify({ logger: false, bodyLimit: 16_384, trustProxy: false });
  const store = await createArtifactStore(config.dataDir, config.executionMode === 'gcp' ? config.gcsBucket : undefined);
  const manager = new AuditManager(config, store); await manager.init();
  const rates = new Map<string, { count: number; reset: number }>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (request.method !== 'POST') return;
    const origin = request.headers.origin;
    if (origin && !['localhost', '127.0.0.1', request.hostname].includes(new URL(origin).hostname)) return reply.code(403).send({ error: 'Cross-site requests are not accepted.' });
    const now = Date.now();
    for (const [key, rate] of rates) if (rate.reset <= now) rates.delete(key);
    const rate = rates.get(request.ip) ?? { count: 0, reset: now + 60_000 }; rates.set(request.ip, rate);
    if (++rate.count > Math.max(10, config.maxConcurrentAudits * 2)) return reply.code(429).send({ error: 'Too many requests. Please wait a minute.' });
  });
  app.setErrorHandler((error, _request, reply) => {
    const failure = error as { statusCode?: number; message?: string };
    const status = error instanceof z.ZodError || error instanceof UnsafeUrlError ? 400 : typeof failure.statusCode === 'number' ? failure.statusCode : 500;
    reply.code(status).send({ error: error instanceof z.ZodError ? error.issues.map(i => i.message).join('; ') : status < 500 || status === 503 ? failure.message : 'The request could not be completed. Check server configuration.' });
  });
  app.get('/api/health', async () => ({ geminiConfigured: Boolean(config.geminiApiKey), mode: config.executionMode }));
  app.post('/api/audits', async (request, reply) => { const audit = await manager.create(request.body); return reply.code(202).send({ id: audit.id }); });
  let samplePromise: ReturnType<AuditManager['createDemo']> | undefined;
  app.post('/api/demo', async (_request, reply) => { samplePromise ??= manager.createDemo().catch(error => { samplePromise = undefined; throw error; }); const audit = await samplePromise; return reply.code(201).send({ id: audit.id }); });
  const params = z.object({ id: z.string().uuid() });
  app.get('/api/audits/:id', async (request, reply) => { const { id } = params.parse(request.params); const audit = await manager.get(id); return audit ?? reply.code(404).send({ error: 'Audit not found.' }); });
  app.get('/api/audits/:id/events', async (request, reply) => {
    const { id } = params.parse(request.params); if (!await manager.get(id)) return reply.code(404).send({ error: 'Audit not found.' });
    const { after } = z.object({ after: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return { events: await manager.getEvents(id, after) };
  });
  app.post('/api/audits/:id/cancel', async (request, reply) => { const { id } = params.parse(request.params); const audit = await manager.cancel(id); return audit ? { id, cancellationRequested: true } : reply.code(404).send({ error: 'Audit not found.' }); });
  app.get('/api/audits/:id/artifacts/:artifactId', async (request, reply) => {
    const { id, artifactId } = params.extend({ artifactId: z.string().uuid() }).parse(request.params);
    const artifact = await manager.getArtifact(id, artifactId); if (!artifact) return reply.code(404).send({ error: 'Evidence not found.' });
    reply.header('Cache-Control', 'private, no-store').header('Content-Security-Policy', "default-src 'none'; sandbox");
    const image = ['image/png', 'image/jpeg'].includes(artifact.contentType);
    if (!image) reply.header('Content-Disposition', `attachment; filename="${artifactId}.txt"`);
    return reply.type(image ? artifact.contentType : 'text/plain; charset=utf-8').send(artifact.content);
  });
  if (existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, { root: config.webDistDir, index: 'index.html' });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Endpoint not found.' }) : reply.sendFile('index.html'));
  }
  app.addHook('onClose', async () => manager.close());
  return app;
}
