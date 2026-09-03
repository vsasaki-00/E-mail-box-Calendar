import type { MetadataRoute } from 'next';

/**
 * Manifesto do PWA. Ver docs/12-pwa.md
 *
 * Instalar na tela inicial e o que torna o Meridiano utilizavel no celular
 * sem virar app de loja: mesma URL, mesma sessao, mesmo codigo.
 *
 * `display: standalone` tira a barra do navegador; `start_url` aponta para
 * a Torre, que e a tela que responde "o que preciso saber agora".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Meridiano — e-mail e agenda',
    short_name: 'Meridiano',
    description:
      'Todas as suas caixas de e-mail e todos os seus calendários sob uma única linha de referência.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // O papel do app, nao branco: a tela de abertura fica igual ao app.
    background_color: '#f7f6f2',
    theme_color: '#0f7d78',
    lang: 'pt-BR',
    dir: 'ltr',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
      // `maskable` deixa o Android recortar no formato dele sem cortar a
      // marca: por isso a arte tem folga nas bordas.
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
