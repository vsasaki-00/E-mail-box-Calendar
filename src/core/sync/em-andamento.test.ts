import { beforeEach, describe, expect, it } from 'vitest';
import { estaOcupado, sair, tentarEntrar } from './em-andamento';

describe('em-andamento', () => {
  beforeEach(() => sair());

  it('o segundo ciclo nao entra enquanto o primeiro nao sai', () => {
    expect(tentarEntrar()).toBe(true);
    expect(tentarEntrar()).toBe(false);
    expect(tentarEntrar()).toBe(false);
    sair();
    expect(tentarEntrar()).toBe(true);
  });

  it('sair sem ter entrado nao trava nada', () => {
    sair();
    sair();
    expect(estaOcupado()).toBe(false);
    expect(tentarEntrar()).toBe(true);
  });

  it('a trava sobrevive a resposta: quem libera e o fim do TRABALHO', async () => {
    // O caso real: a rota responde por prazo e o trabalho continua. Ate ele
    // acabar, ninguem mais entra — e isso e o que impede dois ciclos
    // disputando as 5 conexoes do pool.
    expect(tentarEntrar()).toBe(true);
    const trabalho = new Promise<void>((resolve) => setTimeout(resolve, 10)).finally(sair);

    expect(tentarEntrar()).toBe(false); // a resposta ja saiu, o trabalho nao
    await trabalho;
    expect(tentarEntrar()).toBe(true);
  });
});
