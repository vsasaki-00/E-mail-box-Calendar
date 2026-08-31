'use client';

import { useState, useTransition } from 'react';
import { zerarTriagensAutomaticas } from './actions';

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

      if (passo.concluido) {
        // Concluir sem ter feito nada nao e sucesso: e o servidor dizendo
        // que nao ha o que classificar. Recarregar em silencio aqui era
        // exatamente o que parecia "o botao nao tria".
        if (feitas === 0) {
          setEstado({
            tipo: 'erro',
            mensagem:
              'Nenhuma mensagem elegível. As pendentes estão em pastas fora da visão unificada ' +
              '(Enviados, Arquivo), que a triagem não processa.',
          });
          return;
        }
        break;
      }
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

/**
 * Apaga as classificações automáticas para refazê-las.
 *
 * Só aparece quando já existe classificação. Preserva o que você corrigiu —
 * o botão diz isso antes de agir, porque "zerar" num app que aprende com
 * suas correções soa como perder o aprendizado.
 */
export function BotaoRefazer({ automaticas }: { automaticas: number }) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  if (automaticas === 0) return null;

  function executar() {
    if (
      !window.confirm(
        `Apagar ${automaticas} classificação(ões) automática(s) para refazer?\n\n` +
          'Suas correções manuais não são tocadas.',
      )
    ) {
      return;
    }
    setMensagem(null);
    iniciar(async () => {
      const resultado = await zerarTriagensAutomaticas();
      if (!resultado.ok) {
        setMensagem(resultado.erro ?? 'Falha ao apagar');
        return;
      }
      window.location.reload();
    });
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <button
        type="button"
        onClick={executar}
        disabled={enviando}
        style={{
          padding: '8px 12px',
          borderRadius: 3,
          border: '1px solid var(--border-forte)',
          background: 'transparent',
          color: 'var(--muted)',
          fontSize: 12,
          cursor: enviando ? 'progress' : 'pointer',
        }}
        title="Apaga as classificações feitas por regra e por modelo, preservando as suas correções"
      >
        {enviando ? 'Apagando…' : `Refazer ${automaticas} automáticas`}
      </button>
      {mensagem && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{mensagem}</span>}
    </span>
  );
}
