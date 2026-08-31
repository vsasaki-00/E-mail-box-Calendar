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

type Estado =
  | { tipo: 'ocioso' }
  | { tipo: 'rodando' }
  | { tipo: 'concluido'; texto: string }
  | { tipo: 'erro'; mensagem: string };

export function BotaoTriar({ pendentes }: { pendentes: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });

  async function executar() {
    setEstado({ tipo: 'rodando' });
    try {
      const resposta = await fetch('/api/triage/run', { method: 'POST' });

      // Texto antes de JSON: quando a função é cortada pela plataforma, quem
      // responde é ela, com uma página de texto. Ler direto como JSON
      // trocaria a mensagem real por um erro de parse.
      const texto = await resposta.text();
      let corpo: { results?: Resumo[]; error?: string };
      try {
        corpo = JSON.parse(texto) as { results?: Resumo[]; error?: string };
      } catch {
        const resumo = texto.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        setEstado({
          tipo: 'erro',
          mensagem: `Servidor respondeu HTTP ${resposta.status}: ${resumo || '(resposta vazia)'}`,
        });
        return;
      }

      if (!resposta.ok) {
        setEstado({ tipo: 'erro', mensagem: corpo.error ?? `Falha (HTTP ${resposta.status})` });
        return;
      }

      const resultados = corpo.results ?? [];
      const total = resultados.reduce((soma, r) => soma + (r.processed ?? 0), 0);
      const erros = resultados.filter((r) => r.error);

      if (erros.length > 0) {
        setEstado({
          tipo: 'erro',
          mensagem: `${total} classificadas; ${erros.length} caixa(s) com erro: ${erros[0]?.error}`,
        });
        return;
      }

      if (total === 0) {
        // Zero com sucesso tem causa, e ela precisa aparecer: sem isso o
        // botão pareceria não fazer nada.
        const motivo = resultados.find((r) => r.skipped)?.skipped;
        setEstado({
          tipo: 'erro',
          mensagem: motivo
            ? `Nada classificado — ${motivo}.`
            : 'Nada classificado. Verifique se há mensagens novas e se os perfis das caixas estão preenchidos.',
        });
        return;
      }

      setEstado({ tipo: 'concluido', texto: `${total} classificadas` });
      window.location.reload();
    } catch (erro) {
      setEstado({
        tipo: 'erro',
        mensagem: erro instanceof Error ? erro.message : 'Falha de rede',
      });
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
          ? 'Classificando…'
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
