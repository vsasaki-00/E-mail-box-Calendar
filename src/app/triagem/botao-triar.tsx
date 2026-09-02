'use client';

import { useState } from 'react';
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

/** Uma chamada a `/api/triage/run`: uma caixa, um lote pequeno. */
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

/**
 * Classifica ate o servidor dizer que acabou.
 *
 * Vive no modulo, e nao dentro de um botao, porque DOIS botoes precisam
 * dele: o "Triar" e o "Refazer e triar". Quando o laco morava dentro de um
 * componente, refazer a triagem obrigava a apagar, esperar a pagina
 * recarregar e clicar de novo — dois passos para uma intencao so.
 */
async function triarAteOFim(
  aoProgresso: (estado: Estado) => void,
): Promise<{ feitas: number; erro?: string }> {
  let feitas = 0;

  // Cada volta classifica UMA caixa, em lote pequeno. Somar tudo numa
  // requisicao so estourava o limite da funcao.
  for (let volta = 1; volta <= MAX_VOLTAS; volta += 1) {
    const passo = await umaVolta();
    if (passo.erro) return { feitas, erro: passo.erro };

    feitas += passo.processadas;
    aoProgresso({ tipo: 'rodando', feitas, restantes: passo.restantes });

    if (passo.concluido) {
      // Concluir sem ter feito nada nao e sucesso: e o servidor dizendo que
      // nao ha o que classificar. Recarregar em silencio aqui era exatamente
      // o que parecia "o botao nao tria".
      if (feitas === 0) {
        return {
          feitas,
          erro:
            'Nenhuma mensagem elegível. As pendentes estão em pastas fora da visão unificada ' +
            '(Enviados, Arquivo), que a triagem não processa.',
        };
      }
      return { feitas };
    }

    if (passo.processadas === 0) {
      // Nada avancou e o servidor nao declarou fim: parar e dizer, em vez de
      // girar contra uma caixa que nunca progride.
      return {
        feitas,
        erro:
          feitas > 0
            ? `${feitas} classificadas; o restante não avançou. Tente de novo.`
            : 'Nada classificado. Verifique se há mensagens novas e se os perfis das caixas estão preenchidos.',
      };
    }
  }

  return { feitas, erro: `Pausado após ${MAX_VOLTAS} voltas e ${feitas} classificadas — clique de novo para continuar.` };
}

export function BotaoTriar({ pendentes }: { pendentes: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });

  async function executar() {
    setEstado({ tipo: 'rodando', feitas: 0, restantes: pendentes });
    const resultado = await triarAteOFim(setEstado);
    if (resultado.erro) {
      setEstado({ tipo: 'erro', mensagem: resultado.erro });
      return;
    }
    setEstado({ tipo: 'concluido', texto: `${resultado.feitas} classificadas` });
    window.location.reload();
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
 * Apaga as classificações automáticas E refaz a triagem, num clique só.
 *
 * Antes eram dois: apagar, esperar a página recarregar, achar o outro botão,
 * clicar. Ninguém quer uma caixa SEM triagem — apagar só faz sentido como a
 * primeira metade de "refazer", e o botão que só apagava deixava o app num
 * estado pior que o inicial se você parasse no meio.
 *
 * Só aparece quando já existe classificação. Preserva o que você corrigiu —
 * o botão diz isso antes de agir, porque "zerar" num app que aprende com
 * suas correções soa como perder o aprendizado.
 */
export function BotaoRefazer({ automaticas }: { automaticas: number }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });
  const [apagando, setApagando] = useState(false);

  if (automaticas === 0) return null;

  const ocupado = apagando || estado.tipo === 'rodando';

  async function executar() {
    if (
      !window.confirm(
        `Apagar ${automaticas} classificação(ões) automática(s) e classificar tudo de novo?\n\n` +
          'Suas correções manuais não são tocadas.',
      )
    ) {
      return;
    }

    setEstado({ tipo: 'ocioso' });
    setApagando(true);
    const apagou = await zerarTriagensAutomaticas();
    setApagando(false);

    if (!apagou.ok) {
      setEstado({ tipo: 'erro', mensagem: apagou.erro ?? 'Falha ao apagar' });
      return;
    }

    // Emenda direto na triagem. Se ela falhar, a mensagem diz que o apagar
    // deu certo — senão pareceria que o botão inteiro não funcionou, e você
    // clicaria de novo numa operação que já aconteceu.
    setEstado({ tipo: 'rodando', feitas: 0, restantes: apagou.apagadas ?? 0 });
    const resultado = await triarAteOFim(setEstado);

    if (resultado.erro) {
      setEstado({
        tipo: 'erro',
        mensagem: `${apagou.apagadas} apagadas, mas a triagem parou: ${resultado.erro}`,
      });
      return;
    }

    setEstado({ tipo: 'concluido', texto: `${resultado.feitas} refeitas` });
    window.location.reload();
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <button
        type="button"
        onClick={executar}
        disabled={ocupado}
        style={{
          padding: '8px 12px',
          borderRadius: 3,
          border: '1px solid var(--border-forte)',
          background: 'transparent',
          color: 'var(--muted)',
          fontSize: 12,
          cursor: ocupado ? 'progress' : 'pointer',
        }}
        title="Apaga as classificações feitas por regra e por modelo e refaz todas, preservando as suas correções"
      >
        {apagando
          ? 'Apagando…'
          : estado.tipo === 'rodando'
            ? `Classificando de novo… ${estado.feitas}`
            : estado.tipo === 'concluido'
              ? `✓ ${estado.texto}`
              : `Refazer ${automaticas} automáticas`}
      </button>
      {estado.tipo === 'erro' && (
        <span style={{ fontSize: 11, color: 'var(--crit)', maxWidth: 460 }}>{estado.mensagem}</span>
      )}
    </span>
  );
}
