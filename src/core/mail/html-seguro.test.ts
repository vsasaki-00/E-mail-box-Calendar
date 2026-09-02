import { describe, expect, it } from 'vitest';
import { documentoParaIframe, limparHtmlDeEmail } from './html-seguro';

describe('limparHtmlDeEmail', () => {
  it('remove script com conteudo e auto-fechado', () => {
    const html = '<p>oi</p><script>alert(1)</script><script src="x.js"/><p>tchau</p>';
    const limpo = limparHtmlDeEmail(html);
    expect(limpo).not.toMatch(/<script/i);
    expect(limpo).toContain('<p>oi</p>');
    expect(limpo).toContain('<p>tchau</p>');
  });

  it('remove iframe, object, embed, form, meta, link e base', () => {
    const html =
      '<iframe src="a"></iframe><object data="b"></object><embed src="c">' +
      '<form action="d"><input></form><meta http-equiv="refresh" content="0;url=x">' +
      '<link rel="stylesheet" href="e"><base href="f"><b>fica</b>';
    const limpo = limparHtmlDeEmail(html);
    for (const tag of ['iframe', 'object', 'embed', 'form', 'meta', 'link', 'base']) {
      expect(limpo).not.toMatch(new RegExp(`<${tag}\\b`, 'i'));
    }
    expect(limpo).toContain('<b>fica</b>');
  });

  it('remove atributos de evento e javascript: em href', () => {
    const html = `<a href="javascript:alert(1)" onclick="x()">link</a><img src=x onerror='y()'>`;
    const limpo = limparHtmlDeEmail(html);
    expect(limpo).not.toMatch(/onclick|onerror/i);
    expect(limpo).not.toMatch(/javascript:/i);
    expect(limpo).toContain('link</a>');
  });

  it('nao mexe em HTML inofensivo', () => {
    const html = '<div style="color:red"><p>Olá, <b>mundo</b></p><a href="https://x.com">x</a></div>';
    expect(limparHtmlDeEmail(html)).toBe(html);
  });
});

describe('documentoParaIframe', () => {
  it('leva CSP que bloqueia imagem remota e script', () => {
    const doc = documentoParaIframe('<p>x</p>');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toMatch(/default-src 'none'/);
    expect(doc).toMatch(/img-src data:/);
    // Nada de img-src http/https: pixel de rastreamento fica de fora.
    expect(doc).not.toMatch(/img-src[^;]*https?/);
  });

  it('o CSP do documento vem ANTES do HTML do e-mail, que ja chega limpo', () => {
    const doc = documentoParaIframe('<meta http-equiv="Content-Security-Policy" content="default-src *"><p>x</p>');
    // A meta do e-mail foi removida pela limpeza: so sobra a nossa.
    expect(doc.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(doc).toContain('<p>x</p>');
  });

  it('links abrem em aba nova', () => {
    expect(documentoParaIframe('')).toContain('<base target="_blank">');
  });
});
