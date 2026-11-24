import { loadConfig } from './config.js';
import { ensureMasterUser } from './modules/demo/master.js';
import { startReminderScheduler } from './modules/notifications/scheduler.js';
import { buildApp } from './server.js';
import { FileStore } from './store/file-store.js';

const cfg = loadConfig();
const store = new FileStore({ file: cfg.dataFile, encryptionKey: cfg.encryptDataFile ? cfg.dataKey : undefined });
const app = await buildApp(cfg, store);

const master = await ensureMasterUser(cfg, store);
if (master) app.log.info(`Cuenta de pruebas «admin» lista (${master.created ? 'creada' : 'existente'}, ${master.seeded} movimientos cargados)`);

const stopReminders = startReminderScheduler(cfg, store, {
  info: (m) => app.log.info(m),
  error: (e) => app.log.error(e),
});

// Apagado ordenado: dejar de aceptar tráfico y volcar los datos a disco.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} recibido, cerrando…`);
    stopReminders();
    await app.close();
    await store.flush();
    process.exit(0);
  });
}

try {
  await app.listen({ port: cfg.port, host: cfg.host });
  if (!cfg.isProd) app.log.info(`EConsultor API lista → http://${cfg.host}:${cfg.port}  (demo: ${cfg.allowDemoData})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
