// Entry point. node:sqlite is stable in practice but still prints an "experimental" warning; hide just that one.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  console.warn(w);
});

const { loadConfig } = await import('./config.ts');
const { createApp } = await import('./app.ts');

const cfg = loadConfig();
const app = createApp(cfg);

app.server.listen(cfg.port, () => {
  console.log(`El Jonatito Music listening on http://localhost:${cfg.port}${cfg.testMode ? ' (TEST MODE)' : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}

export {};
