import { describe, expect, it } from 'vitest';
import { assinarSessao, verificarSessao, DURACAO_SESSAO_MS } from './session';
import { conferirSenha, gerarHashDeSenha } from './senha';

const SEGREDO = 'segredo-de-teste-com-tamanho-razoavel';

describe('sessão assinada', () => {
  it('aceita um token que ela mesma assinou', async () => {
    const token = await assinarSessao(SEGREDO);
    expect(await verificarSessao(SEGREDO, token)).toBe(true);
  });

  it('recusa token assinado com outro segredo', async () => {
    const token = await assinarSessao('outro-segredo-completamente-diferente');
    expect(await verificarSessao(SEGREDO, token)).toBe(false);
  });

  /**
   * O teste que importa de verdade: o payload diz quando expira, e é legível
   * por qualquer um. Se a assinatura não cobrisse o payload, bastaria trocar
   * `exp` por um número grande para ter sessão eterna.
   */
  it('recusa token com validade esticada à mão', async () => {
    const token = await assinarSessao(SEGREDO);
    const assinatura = token.split('.')[1]!;

    const payloadForjado = btoa(JSON.stringify({ exp: Date.now() + 10 * DURACAO_SESSAO_MS }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verificarSessao(SEGREDO, `${payloadForjado}.${assinatura}`)).toBe(false);
  });

  it('recusa token vencido', async () => {
    const emitido = Date.now() - DURACAO_SESSAO_MS - 1_000;
    const token = await assinarSessao(SEGREDO, emitido);
    expect(await verificarSessao(SEGREDO, token)).toBe(false);
  });

  it('recusa lixo sem lançar', async () => {
    for (const ruim of [undefined, '', 'sem-ponto', 'a.b', '.....', 'não-base64.não-base64']) {
      expect(await verificarSessao(SEGREDO, ruim)).toBe(false);
    }
  });
});

describe('senha', () => {
  it('confere a senha certa e recusa a errada', () => {
    const hash = gerarHashDeSenha('uma-senha-longa-o-suficiente');
    expect(conferirSenha('uma-senha-longa-o-suficiente', hash)).toBe(true);
    expect(conferirSenha('uma-senha-longa-o-suficient', hash)).toBe(false);
    expect(conferirSenha('', hash)).toBe(false);
  });

  it('usa sal novo a cada geração', () => {
    // Dois hashes iguais para a mesma senha entregariam, num vazamento, que
    // duas contas usam a mesma senha.
    expect(gerarHashDeSenha('mesma-senha')).not.toBe(gerarHashDeSenha('mesma-senha'));
  });

  /**
   * Variável de ambiente digitada errada não pode derrubar a tela de login
   * com erro 500 — tem que virar "senha incorreta".
   */
  it('devolve false para hash malformado, sem lançar', () => {
    for (const ruim of [undefined, '', 'texto-solto', 'scrypt$só-duas-partes', 'bcrypt$aa$bb', 'scrypt$zz$zz']) {
      expect(conferirSenha('qualquer', ruim)).toBe(false);
    }
  });
});
