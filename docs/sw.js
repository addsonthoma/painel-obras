/* Service worker do Painel de Obras.
   Estratégia: network-first para os arquivos do próprio app (sempre pega a
   versão mais nova quando online; cai no cache só offline). NÃO intercepta
   Supabase nem CDNs — esses vão direto pra rede. */
const CACHE = 'painel-obras-v3';
const CORE = [
  './', './index.html', './app.js', './styles.css', './config.js',
  './manifest.json', './assets/icon-192.png', './assets/icon-512.png',
  './assets/logo.png', './assets/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase/CDN -> direto pra rede
  e.respondWith(
    // {cache:'no-cache'} faz o fetch REVALIDAR com o servidor (ignora o cache HTTP
    // de 10 min do GitHub Pages) -> toda atualização aparece na hora quando online.
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => {
        if (r) return r;
        // index.html só serve de fallback para NAVEGAÇÃO (senão imagem vira HTML)
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
