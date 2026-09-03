'use client';

import { useEffect } from 'react';

/**
 * Registra o service worker. Ver docs/12-pwa.md
 *
 * Só isso: o worker em si não guarda conteúdo nenhum. Ele existe para o
 * navegador oferecer "instalar" e para a falha de rede virar uma página
 * explicando, em vez do erro do navegador.
 *
 * Falhar aqui não é erro visível: um app que funciona sem service worker
 * não deve incomodar o dono porque o registro não pegou.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silêncio proposital: sem SW o app continua inteiro.
    });
  }, []);

  return null;
}
