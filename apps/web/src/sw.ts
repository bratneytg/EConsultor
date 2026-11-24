/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

// Solo se cachea la "cáscara" de la app (JS/CSS/HTML/iconos). Las respuestas de /api NUNCA se cachean.
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Recordatorio diario (Web Push). El servidor envía { title, body, url }.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try { data = event.data?.json() ?? {}; } catch { /* payload no JSON */ }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'EConsultor', {
      body: data.body ?? '¿Anotamos los gastos de hoy?',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge.png',
      tag: 'daily-reminder', // una sola notificación a la vez
      data: { url: data.url ?? '/?add=1' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = all.find((c) => 'focus' in c);
      if (open) { await open.focus(); await (open as WindowClient).navigate(url); }
      else await self.clients.openWindow(url);
    })(),
  );
});
