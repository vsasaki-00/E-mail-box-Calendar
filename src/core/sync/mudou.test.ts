import { describe, expect, it } from 'vitest';
import { mesmoValor, precisaGravar } from './mudou';

describe('mesmoValor', () => {
  it('compara Date por instante, nao por identidade', () => {
    // Duas leituras do mesmo horario sao objetos diferentes. Comparar por
    // identidade marcaria toda mensagem como mudada, e a otimizacao inteira
    // viraria um `if` que nunca e verdadeiro.
    const t = '2026-09-01T12:00:00.000Z';
    expect(mesmoValor(new Date(t), new Date(t))).toBe(true);
    expect(mesmoValor(new Date(t), new Date('2026-09-01T12:00:01Z'))).toBe(false);
    expect(mesmoValor(new Date(t), t)).toBe(false);
  });

  it('undefined e "nao tenho opiniao": nunca justifica escrita', () => {
    // `campo: undefined` num update do Prisma significa NAO TOQUE.
    expect(mesmoValor(undefined, 'valor')).toBe(true);
    expect(mesmoValor(undefined, null)).toBe(true);
  });

  it('null e "grave nulo": so e igual a nulo', () => {
    expect(mesmoValor(null, null)).toBe(true);
    expect(mesmoValor(null, undefined)).toBe(true);
    expect(mesmoValor(null, 'valor')).toBe(false);
  });

  it('compara Json por conteudo', () => {
    expect(mesmoValor(['a@x.com'], ['a@x.com'])).toBe(true);
    expect(mesmoValor([], [])).toBe(true);
    expect(mesmoValor(['a@x.com'], ['b@x.com'])).toBe(false);
    // A ordem vem do provedor e e o que gravamos: trocar e mudanca.
    expect(mesmoValor(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('escalares', () => {
    expect(mesmoValor(true, true)).toBe(true);
    expect(mesmoValor(true, false)).toBe(false);
    expect(mesmoValor('', '')).toBe(true);
    expect(mesmoValor(0, 0)).toBe(true);
    expect(mesmoValor(0, '')).toBe(false);
  });
});

describe('precisaGravar', () => {
  const atual = {
    subject: 'assunto',
    isRead: false,
    receivedAt: new Date('2026-09-01T12:00:00Z'),
    labels: ['INBOX'],
    snippet: null,
  };

  it('tudo igual: nao grava', () => {
    expect(
      precisaGravar(
        {
          subject: 'assunto',
          isRead: false,
          receivedAt: new Date('2026-09-01T12:00:00Z'),
          labels: ['INBOX'],
          snippet: null,
        },
        atual,
      ),
    ).toBe(false);
  });

  it('um campo diferente basta', () => {
    expect(precisaGravar({ isRead: true }, atual)).toBe(true);
    expect(precisaGravar({ labels: ['INBOX', 'IMPORTANT'] }, atual)).toBe(true);
    expect(precisaGravar({ snippet: 'trecho' }, atual)).toBe(true);
  });

  it('so olha as chaves de `novo` — o que nao vai ser escrito nao decide', () => {
    expect(precisaGravar({ subject: 'assunto' }, { ...atual, isRead: true })).toBe(false);
  });

  it('campo que existe no novo e nao no atual conta como mudanca', () => {
    // Coluna recem-criada, linha antiga sem valor: precisa ser preenchida.
    expect(precisaGravar({ novoCampo: 'x' }, atual)).toBe(true);
  });
});
