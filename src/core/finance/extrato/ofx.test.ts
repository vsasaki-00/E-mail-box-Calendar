import { describe, expect, it } from 'vitest';
import { lerDataOfx, lerOfx, lerValorOfx, pareceOfx } from './ofx';

/**
 * OFX como os bancos brasileiros realmente mandam: SGML sem fechamento,
 * cabecalho de texto, Latin-1, virgula decimal em alguns, cartao sem BANKID.
 */

const OFX_SGML_ITAU = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260901120000[-3:BRT]
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1001
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801
<DTEND>20260831
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260815
<TRNAMT>-1234.56
<FITID>202608150001
<MEMO>PIX ENVIADO FORNECEDOR XYZ LTDA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260820120000[-3:BRT]
<TRNAMT>5000,00
<FITID>202608200002
<NAME>TED RECEBIDA
<MEMO>CLIENTE ABC S/A
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>8765.44
<DTASOF>20260831
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

const OFX_XML_CARTAO = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <CCSTMTRS>
        <CURDEF>BRL</CURDEF>
        <CCACCTFROM><ACCTID>5555****1234</ACCTID></CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260801000000</DTSTART>
          <DTEND>20260831235959</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260810</DTPOSTED>
            <TRNAMT>-89.90</TRNAMT>
            <FITID>cc-1</FITID>
            <MEMO>NETFLIX.COM &amp; CIA</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
        <LEDGERBAL><BALAMT>-89.90</BALAMT><DTASOF>20260831</DTASOF></LEDGERBAL>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;

describe('lerDataOfx', () => {
  it('sem hora cai ao meio-dia de Brasilia', () => {
    const d = lerDataOfx('20260815');
    expect(d?.toISOString()).toBe('2026-08-15T15:00:00.000Z');
  });
  it('com hora e fuso respeita o fuso', () => {
    expect(lerDataOfx('20260820120000[-3:BRT]')?.toISOString()).toBe('2026-08-20T15:00:00.000Z');
    expect(lerDataOfx('20260820120000[0:GMT]')?.toISOString()).toBe('2026-08-20T12:00:00.000Z');
  });
  it('com hora sem fuso assume Brasilia', () => {
    expect(lerDataOfx('20260820090000')?.toISOString()).toBe('2026-08-20T12:00:00.000Z');
  });
  it('lixo vira undefined, nao Invalid Date', () => {
    expect(lerDataOfx('ontem')).toBeUndefined();
  });
});

describe('lerValorOfx', () => {
  it('ponto e virgula como decimal', () => {
    expect(lerValorOfx('-1234.56')).toBe(-123456);
    expect(lerValorOfx('5000,00')).toBe(500000);
    expect(lerValorOfx('1.234,56')).toBe(123456);
    expect(lerValorOfx('1,234.56')).toBe(123456);
  });
  it('centavos nao viram 0.1+0.2', () => {
    expect(lerValorOfx('0.29')).toBe(29);
    expect(lerValorOfx('19.99')).toBe(1999);
  });
});

describe('lerOfx — SGML de conta corrente', () => {
  const extrato = lerOfx(OFX_SGML_ITAU);

  it('e reconhecido como OFX', () => {
    expect(pareceOfx(OFX_SGML_ITAU)).toBe(true);
  });
  it('le a conta', () => {
    expect(extrato.conta).toMatchObject({
      bankId: '0341',
      accountId: '12345-6',
      kind: 'CHECKING',
      currency: 'BRL',
      balanceCents: 876544,
    });
  });
  it('le os dois lancamentos com sinal, FITID e descricao', () => {
    expect(extrato.lancamentos).toHaveLength(2);
    expect(extrato.lancamentos[0]).toMatchObject({
      amountCents: -123456,
      fitId: '202608150001',
      description: 'PIX ENVIADO FORNECEDOR XYZ LTDA',
      tipoBanco: 'DEBIT',
    });
    // NAME e MEMO diferentes: os dois entram.
    expect(extrato.lancamentos[1]).toMatchObject({
      amountCents: 500000,
      fitId: '202608200002',
      description: 'TED RECEBIDA CLIENTE ABC S/A',
    });
  });
  it('le o periodo', () => {
    expect(extrato.periodStart?.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(extrato.periodEnd?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
  it('nao avisa nada quando esta tudo certo', () => {
    expect(extrato.avisos).toEqual([]);
  });
});

describe('lerOfx — XML de cartao', () => {
  const extrato = lerOfx(OFX_XML_CARTAO);

  it('identifica cartao de credito sem BANKID', () => {
    expect(extrato.conta.kind).toBe('CREDIT_CARD');
    expect(extrato.conta.bankId).toBeUndefined();
    expect(extrato.conta.accountId).toBe('5555****1234');
  });
  it('desescapa entidades XML na descricao', () => {
    expect(extrato.lancamentos[0]?.description).toBe('NETFLIX.COM & CIA');
  });
  it('saldo negativo de cartao e normal, nao erro', () => {
    expect(extrato.conta.balanceCents).toBe(-8990);
  });
});

describe('lerOfx — casos ruins', () => {
  it('investimento entra como aviso, nao explosao', () => {
    const r = lerOfx('<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>BRL</INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>');
    expect(r.lancamentos).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/investimento/i);
  });
  it('SGML que termina sem fechar a ultima transacao ainda a le', () => {
    const r = lerOfx('<OFX><STMTTRN><DTPOSTED>20260801<TRNAMT>-10.00<FITID>x<MEMO>fim');
    expect(r.lancamentos).toHaveLength(1);
    expect(r.lancamentos[0]?.description).toBe('fim');
  });
  it('lancamento sem FITID gera aviso sobre deduplicacao', () => {
    const r = lerOfx('<OFX><STMTTRN><DTPOSTED>20260801<TRNAMT>-10.00<MEMO>sem id</STMTTRN></OFX>');
    expect(r.lancamentos[0]?.fitId).toBeUndefined();
    expect(r.avisos.join(' ')).toMatch(/FITID/);
  });
});
