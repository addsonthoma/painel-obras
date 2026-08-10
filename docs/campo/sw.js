/* Service worker do Campo.
   Escopo /campo/ — mais especifico que o do Portal, entao manda nesta pasta.

   Estrategia: rede primeiro, cache como rede de seguranca. O app precisa abrir
   no galpao sem sinal, e um apontamento nunca pode ser perdido por causa disso.
   As telas ficam em cache; o que o funcionario preencher fica no localStorage
   ate conseguir subir. */

const CACHE = 'campo-v1';

const ESSENCIAIS = [
  './',
  './index.html',
  './campo.css',
  './campo.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/marca-branca.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ESSENCIAIS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  ev.respondWith(
    fetch(req)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
