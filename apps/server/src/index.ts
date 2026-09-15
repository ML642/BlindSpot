import { createApp } from './app.js';
import { loadConfig } from './config.js';
const config = loadConfig();
const app = await createApp(config);
await app.listen({ port: config.port, host: config.host });
console.log(`BlindSpot API: http://${config.host}:${config.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
