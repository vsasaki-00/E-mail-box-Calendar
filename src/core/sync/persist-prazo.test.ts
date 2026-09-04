import { describe, expect, it } from 'vitest';
import { acabouOTempo } from './persist';

/**
 * O freio de dentro da gravacao.
 *
 * O orcamento do ciclo impede COMECAR recurso novo, mas nao ajuda com o que
 * ja comecou — e gravar uma pagina no Postgres pode custar mais que busca-la.
 * Sem um freio aqui, a unica coisa que interrompia o trabalho era a
 * plataforma matar a funcao aos 60s: FUNCTION_INVOCATION_TIMEOUT, sem corpo,
 * sem causa, sem dizer onde o tempo foi.
 *
 * A regra tem duas metades e as duas sao faceis de escrever errado, entao
 * elas moram numa funcao pura, testada aqui.
 */

describe('acabouOTempo', () => {
  it('sem prazo, nunca para — o worker local roda ate acabar', () => {
    expect(acabouOTempo(undefined, 0)).toBe(false);
    expect(acabouOTempo(undefined, 999)).toBe(false);
  });

  it('o PRIMEIRO item passa sempre, mesmo com o prazo vencido', () => {
    // Uma volta que grava zero itens e marcada como parcial, e parcial pede
    // outra volta identica a ela: o sync nunca sairia do lugar. Progresso
    // lento termina; progresso zero, nao.
    expect(acabouOTempo(Date.now() - 10_000, 0)).toBe(false);
  });

  it('com o prazo vencido, para a partir do segundo', () => {
    expect(acabouOTempo(Date.now() - 1, 1)).toBe(true);
  });

  it('com prazo pela frente, nao para', () => {
    expect(acabouOTempo(Date.now() + 60_000, 50)).toBe(false);
  });
});
