/*
 * Service worker do Meridiano. Ver docs/12-pwa.md
 *
 * A decisão que define este arquivo: ele NÃO GUARDA NADA do que você lê.
 *
 * O padrão de PWA é cachear páginas para abrir offline. Aqui isso seria
 * gravar e-mail de seis negócios no disco do aparelho, fora do controle da
 * sessão — num celular perdido, o cache abriria sem senha. O app inteiro é
 * construído em cima de não fazer isso (segredos cifrados, corpo buscado
 * sob demanda, nada de e-mail em log), e o service worker não vai ser a
 * porta dos fundos.
 *
 * Então ele faz só duas coisas:
 *   1. existe — que é o requisito para o navegador oferecer "instalar";
 *   2. quando a rede falha numa navegação, mostra uma página dizendo isso,
 *      em vez do dinossauro do Chrome.
 *
 * O CSS e o JS do próprio app continuam sendo cacheados pelo navegador
 * normalmente (`_next/static` é imutável e versionado); isso é cache de
 * código, não de conteúdo, e não vaza nada.
 */

const OFFLINE_URL = '/offline.html';
const CACHE = 'meridiano-shell-v1';

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só navegação. API e estáticos seguem o caminho normal do navegador —
  // interceptá-los só criaria oportunidade de guardar o que não deve.
  if (req.mode !== 'navigate') return;

  evento.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())),
  );
});
