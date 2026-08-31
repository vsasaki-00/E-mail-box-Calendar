'use client';

import { useState } from 'react';

/**
 * Dispara a triagem pela tela.
 *
 * Existia só a instrução "chame POST /api/triage/run" — pedir ao dono do
 * app que monte uma requisição HTTP à mão não é uma interface. E, como em
 * /conexoes, o que falta junto é o retorno: quanto foi classificado, e o
 * motivo quando nada acontece.
 *
 * A triagem CUSTA dinheiro por chamada, então este botão nunca dispara
 * sozinho — só no seu clique. Ver docs/07-agente-de-triagem.md
 */

interface Resumo {
  connectionId?: string;
  accountEmail?: string;
  processed?: number;
  skipped?: string;
  error?: string;
}

/** Voltas no maximo por clique, contra laco que nao termina. */
const MAX_VOLTAS = 60;

type Estado =
  | { tipo: 'ocioso' }
  | { tipo: 'rodando'; feitas: number; restantes: number }
  | { tipo: 'concluido'; texto: string }
  | { tipo: 'erro'; mensagem: string };

export function BotaoTriar({ pendentes }: { pendentes: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });

  async function executar() {
    setEstado({ tipo: 'rodando', feitas: 0, restantes: pendentes });
    let feitas = 0;

    // Cada volta classifica UMA caixa, em lote pequeno. Somar tudo numa
    // requisicao so estourava o limite da funcao.
    for (let volta = 1; volta <= MAX_VOLTAS; volta += 1) {
      const passo = await umaVolta();
      if (passo.erro) {
        setEstado({ tipo: 'erro', mensagem: passo.erro });
        return;
      }
      feitas += passo.processadas;
      setEstado({ tipo: 'rodando', feitas, restantes: passo.restantes });

      if (passo.concluido) break;
      if (passo.processadas === 0) {
        // Nada avancou e o servidor nao declarou fim: parar e dizer, em vez
        // de girar contra uma caixa que nunca progride.
        setEstado({
          tipo: 'erro',
          mensagem:
            feitas > 0
              ? `${feitas} classificadas; o restante não avançou. Tente de novo.`
              : 'Nada classificado. Verifique se há mensagens novas e se os perfis das caixas estão preenchidos.',
        });
        return;
      }
    }

    setEstado({ tipo: 'concluido', texto: `${feitas} classificadas` });
    window.location.reload();
  }

  async function umaVolta(): Promise<{
    processadas: number;
    restantes: number;
    concluido: boolean;
    erro?: string;
  }> {
    const vazio = { processadas: 0, restantes: 0, concluido: true };
    try {
      const resposta = await fetch('/api/triage/run', { method: 'POST' });

      // Texto antes de JSON: quando a função é cortada pela plataforma, quem
      // responde é ela, com uma página de texto. Ler direto como JSON
      // trocaria a mensagem real por um erro de parse.
      const texto = await resposta.text();
      let corpo: { results?: Resumo[]; error?: string; pendentes?: number; concluido?: boolean };
      try {
        corpo = JSON.parse(texto) as typeof corpo;
      } catch {
        const resumo = texto.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        return {
          ...vazio,
          erro: `Servidor respondeu HTTP ${resposta.status}: ${resumo || '(resposta vazia)'}`,
        };
      }

      if (!resposta.ok) {
        return { ...vazio, erro: corpo.error ?? `Falha (HTTP ${resposta.status})` };
      }

      const resultados = corpo.results ?? [];
      const comErro = resultados.find((r) => r.error);
      if (comErro) return { ...vazio, erro: comErro.error };

      const pulada = resultados.find((r) => r.skipped)?.skipped;
      if (pulada) return { ...vazio, erro: `Interrompido — ${pulada}.` };

      return {
        processadas: resultados.reduce((soma, r) => soma + (r.processed ?? 0), 0),
        restantes: corpo.pendentes ?? 0,
        concluido: corpo.concluido === true,
      };
    } catch (erro) {
      return { ...vazio, erro: erro instanceof Error ? erro.message : 'Falha de rede' };
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={executar}
        disabled={estado.tipo === 'rodando'}
        style={{
          padding: '8px 14px',
          borderRadius: 3,
          border: '1px solid var(--meridiano)',
          background: 'var(--meridiano)',
          color: '#fffdf9',
          cursor: estado.tipo === 'rodando' ? 'progress' : 'pointer',
          fontSize: 13,
          opacity: estado.tipo === 'rodando' ? 0.6 : 1,
        }}
      >
        {estado.tipo === 'rodando'
          ? `Classificando… ${estado.feitas} de ${estado.feitas + estado.restantes}`
          : estado.tipo === 'concluido'
            ? `✓ ${estado.texto}`
            : `Triar ${pendentes > 0 ? `${pendentes} mensagens` : 'agora'}`}
      </button>
      {estado.tipo === 'erro' && (
        <span style={{ fontSize: 12, color: 'var(--crit)', maxWidth: 460 }}>{estado.mensagem}</span>
      )}
    </span>
  );
}
