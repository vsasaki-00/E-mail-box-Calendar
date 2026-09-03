import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinaturaConfere, lerAllowlist, normalizarNumero, numeroAutorizado } from './seguranca';

const SEGREDO = 'app-secret-de-teste';
const assinar = (corpo: string, segredo = SEGREDO) =>
  `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`;

describe('assinaturaConfere', () => {
  const corpo = '{"object":"whatsapp_business_account","entry":[{"id":"1"}]}';

  it('aceita a assinatura certa', () => {
    expect(assinaturaConfere(corpo, assinar(corpo), SEGREDO)).toBe(true);
  });

  it('recusa corpo alterado, mesmo um byte', () => {
    expect(assinaturaConfere(`${corpo} `, assinar(corpo), SEGREDO)).toBe(false);
  });

  it('recusa assinatura de outro segredo', () => {
    expect(assinaturaConfere(corpo, assinar(corpo, 'outro'), SEGREDO)).toBe(false);
  });

  it('recusa cabecalho ausente, sem prefixo, ou nao-hex', () => {
    expect(assinaturaConfere(corpo, null, SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, 'abc', SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, 'sha256=nao-e-hex', SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, `sha256=${'a'.repeat(63)}`, SEGREDO)).toBe(false);
  });

  it('sem App Secret configurado, nada passa', () => {
    expect(assinaturaConfere(corpo, assinar(corpo), '')).toBe(false);
  });

  it('a ordem das chaves do JSON importa — por isso o corpo tem de ser cru', () => {
    const reordenado = '{"entry":[{"id":"1"}],"object":"whatsapp_business_account"}';
    expect(assinaturaConfere(reordenado, assinar(corpo), SEGREDO)).toBe(false);
  });
});

describe('normalizarNumero e allowlist', () => {
  it('tira formatacao', () => {
    expect(normalizarNumero('+55 (11) 98765-4321')).toBe('5511987654321');
  });

  it('le a env separada por virgula, ignorando lixo curto', () => {
    expect(lerAllowlist(' +55 11 98765-4321 , 5511912345678 , 123 ')).toEqual([
      '5511987654321',
      '5511912345678',
    ]);
    expect(lerAllowlist(undefined)).toEqual([]);
    expect(lerAllowlist('   ')).toEqual([]);
  });
});

describe('numeroAutorizado', () => {
  const lista = lerAllowlist('+55 11 98765-4321');

  it('autoriza o numero da lista, formatado ou nao', () => {
    expect(numeroAutorizado('5511987654321', lista)).toBe(true);
    expect(numeroAutorizado('+55 (11) 98765-4321', lista)).toBe(true);
  });

  it('o nono digito: com e sem, os dois batem', () => {
    // A Meta as vezes entrega sem o 9. Sem isto, o dono cairia na propria
    // allowlist umas vezes sim, outras nao.
    expect(numeroAutorizado('551187654321', lista)).toBe(true);
    expect(numeroAutorizado('5511987654321', lerAllowlist('551187654321'))).toBe(true);
  });

  it('recusa numero de fora', () => {
    expect(numeroAutorizado('5511999998888', lista)).toBe(false);
    expect(numeroAutorizado('5521987654321', lista)).toBe(false); // outro DDD
  });

  it('allowlist vazia recusa TUDO — nao e "sem lista, libera geral"', () => {
    expect(numeroAutorizado('5511987654321', [])).toBe(false);
  });
});


describe('allowlist escrita do jeito que uma pessoa escreve', () => {
  // O provedor SEMPRE manda com o codigo do pais. Se o dono escreveu o
  // proprio numero sem ele, a mensagem cairia fora da allowlist e sumiria
  // em silencio — sem rastro em lugar nenhum do app.
  const doProvedor = '5511987654321';

  it('aceita o numero sem o 55, com e sem pontuacao', () => {
    for (const escrito of ['11987654321', '(11) 98765-4321', '11 98765 4321']) {
      expect(numeroAutorizado(doProvedor, lerAllowlist(escrito))).toBe(true);
    }
  });

  it('aceita sem o 55 E sem o nono digito', () => {
    expect(numeroAutorizado(doProvedor, lerAllowlist('1187654321'))).toBe(true);
    expect(numeroAutorizado('551187654321', lerAllowlist('11987654321'))).toBe(true);
  });

  it('continua aceitando a forma canonica E.164', () => {
    expect(numeroAutorizado(doProvedor, lerAllowlist('5511987654321'))).toBe(true);
    expect(numeroAutorizado(doProvedor, lerAllowlist('+55 (11) 98765-4321'))).toBe(true);
  });

  it('nao passa a aceitar OUTRO numero', () => {
    expect(numeroAutorizado(doProvedor, lerAllowlist('11912345678'))).toBe(false);
    expect(numeroAutorizado(doProvedor, lerAllowlist('21987654321'))).toBe(false);
    // Nao tira o 55 de quem tem: um numero estrangeiro de 10 digitos nao
    // pode virar brasileiro por acidente.
    expect(numeroAutorizado('12125550123', lerAllowlist('5511987654321'))).toBe(false);
  });

  it('allowlist vazia continua recusando tudo', () => {
    expect(numeroAutorizado(doProvedor, lerAllowlist(''))).toBe(false);
    expect(numeroAutorizado(doProvedor, lerAllowlist(undefined))).toBe(false);
  });
});
