'use client';

import { useState, useTransition } from 'react';
import { desfazerImportacao, previaDeExclusao, type ResultadoDesfazer } from './actions';

/**
 * Apagar uma importação, em dois passos. Ver docs/10-financeiro.md
 *
 * O primeiro clique não apaga: pergunta ao servidor o que aconteceria e
 * mostra o número. "Apagar" sem dizer quantas linhas é um pedido de
 * confiança que uma tela de dinheiro não deveria fazer — ainda mais quando
 * a resposta pode ser 171.
 */
export function BotaoDesfazerImportacao({ id, arquivo }: { id: string; arquivo: string }) {
  const [previa, setPrevia] = useState<ResultadoDesfazer | null>(null);
  const [feito, setFeito] = useState<ResultadoDesfazer | null>(null);
  const [pendente, iniciar] = useTransition();

  if (feito?.ok) {
    return (
      <span className="sub" style={{ color: 'var(--ok)', fontSize: 11 }}>
        {feito.apagados} apagados
        {feito.preservados && feito.preservados.length > 0
          ? ` · ${feito.preservados.reduce((s, p) => s + p.quantas, 0)} mantidos`
          : ''}
      </span>
    );
  }

  if (!previa) {
    return (
      <button
        type="button"
        className="sair"
        style={{ fontSize: 11 }}
        disabled={pendente}
        onClick={() => iniciar(async () => setPrevia(await previaDeExclusao(id)))}
      >
        {pendente ? '…' : 'apagar'}
      </button>
    );
  }

  const mantidos = previa.preservados ?? [];
  const totalMantidos = mantidos.reduce((s, p) => s + p.quantas, 0);

  return (
    <div style={{ textAlign: 'right', maxWidth: 260 }}>
      <p className="sub" style={{ fontSize: 11, margin: '0 0 6px' }}>
        Apagar <strong>{previa.apagados}</strong> lançamento{previa.apagados === 1 ? '' : 's'} de{' '}
        <em>{arquivo}</em>?
        {totalMantidos > 0 && (
          <>
            <br />
            {/* Nunca sumir com trabalho seu em silêncio: se ficou linha, a
                tela diz quantas e por quê, antes do clique. */}
            {totalMantidos} fica{totalMantidos === 1 ? '' : 'm'} —{' '}
            {mantidos.map((m) => `${m.quantas} ${m.motivo}`).join(', ')}.
          </>
        )}
      </p>
      <button
        type="button"
        className="sair"
        style={{ fontSize: 11, marginRight: 6 }}
        disabled={pendente}
        onClick={() => iniciar(async () => setFeito(await desfazerImportacao(id)))}
      >
        {pendente ? 'apagando…' : 'confirmar'}
      </button>
      <button type="button" className="sair" style={{ fontSize: 11 }} onClick={() => setPrevia(null)}>
        cancelar
      </button>
      {feito?.erro && (
        <p className="sub" style={{ color: 'var(--crit)', fontSize: 11 }}>{feito.erro}</p>
      )}
    </div>
  );
}
