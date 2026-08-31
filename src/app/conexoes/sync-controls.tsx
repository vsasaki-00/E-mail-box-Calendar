'use client';

import { useState } from 'react';

/**
 * Botões de sincronização com feedback visível.
 *
 * A lição que motivou este arquivo: o motor processa UMA página por chamada
 * e salva o cursor — desenho feito para o worker, que chama em loop. O botão
 * antigo chamava uma vez, sem indicador nenhum, e numa caixa de 90 dias isso
 * parecia botão quebrado. Aqui o loop acontece no navegador: cada rodada é
 * uma requisição curta (cabe no limite de função da Vercel), e o botão conta
 * o progresso em voz alta até o servidor dizer "acabou".
 */

/**
 * Rodadas no máximo por clique.
 *
 * Cada rodada é curta de propósito (o conector tem orçamento de ~12s), então
 * a carga inicial de uma caixa grande precisa de muitas. O teto existe para
 * uma caixa gigante parar e avisar, em vez de girar a noite inteira.
 */
const MAX_RODADAS = 250;

interface RespostaSync {
  results?: {
    resource: string;
    outcome: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    counts?: { created: number; updated: number; deleted: number };
    errorMessage?: string;
  }[];
  error?: string;
}

type Estado =
  | { tipo: 'ocioso' }
  | { tipo: 'rodando'; rodada: number; itens: number; recurso?: string }
  | { tipo: 'concluido'; itens: number }
  | { tipo: 'erro'; mensagem: string };

/**
 * Sincroniza uma conexão até o fim (ou até MAX_RODADAS).
 * Devolve o total de itens e se sobrou trabalho.
 */
async function sincronizarConexao(
  connectionId: string,
  aoProgresso: (rodada: number, itens: number, recurso?: string) => void,
): Promise<{ itens: number; completo: boolean; erro?: string }> {
  let itens = 0;

  for (let rodada = 1; rodada <= MAX_RODADAS; rodada += 1) {
    aoProgresso(rodada, itens);

    let corpo: RespostaSync;
    try {
      const resposta = await fetch(`/api/connections/${connectionId}/sync`, { method: 'POST' });
      if (resposta.status === 401) {
        return { itens, completo: false, erro: 'Sessão expirada — recarregue a página e entre de novo.' };
      }

      // Texto primeiro, JSON depois. Quando a função quebra ou estoura o
      // tempo, quem responde é a plataforma, com uma página de texto — e
      // `.json()` direto trocava essa mensagem por "is not valid JSON",
      // escondendo justamente o que explicava a falha.
      const texto = await resposta.text();
      try {
        corpo = JSON.parse(texto) as RespostaSync;
      } catch {
        const resumo = texto.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        return {
          itens,
          completo: false,
          erro: `Servidor respondeu HTTP ${resposta.status}: ${resumo || '(resposta vazia)'}`,
        };
      }

      if (!resposta.ok) {
        return { itens, completo: false, erro: corpo.error ?? `Falha (HTTP ${resposta.status})` };
      }
    } catch (erro) {
      return {
        itens,
        completo: false,
        erro: erro instanceof Error ? erro.message : 'Falha de rede',
      };
    }

    const resultados = corpo.results ?? [];
    for (const resultado of resultados) {
      itens +=
        (resultado.counts?.created ?? 0) +
        (resultado.counts?.updated ?? 0) +
        (resultado.counts?.deleted ?? 0);
    }

    // Mostra QUAL recurso avancou. Sem isto, uma agenda que nao enche fica
    // indistinguivel de uma agenda vazia — e foi assim que o calendario
    // passou voltas inteiras sem nunca ser sincronizado, em silencio.
    const ativo = resultados.find((r) => r.outcome !== 'SUCCESS') ?? resultados[0];
    if (ativo) {
      aoProgresso(rodada, itens, ativo.resource === 'MAIL' ? 'e-mail' : 'agenda');
    }

    const falha = resultados.find((r) => r.outcome === 'FAILED');
    if (falha) {
      // Erro do provedor interrompe o loop e APARECE — a alternativa seria
      // girar para sempre contra uma conta com token vencido.
      return { itens, completo: false, erro: falha.errorMessage ?? 'Falha na sincronização' };
    }

    if (!resultados.some((r) => r.outcome === 'PARTIAL')) {
      return { itens, completo: true };
    }
  }

  return {
    itens,
    completo: false,
    erro: `Pausado após ${MAX_RODADAS} rodadas e ${itens} itens — clique de novo para continuar de onde parou.`,
  };
}

const estiloBotao = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
} as const;

function rotulo(estado: Estado, ocioso: string): string {
  switch (estado.tipo) {
    case 'ocioso':
      return ocioso;
    case 'rodando':
      return estado.recurso
        ? `Sincronizando ${estado.recurso}… ${estado.itens} itens (volta ${estado.rodada})`
        : 'Sincronizando…';
    case 'concluido':
      return `✓ ${estado.itens} itens`;
    case 'erro':
      return ocioso;
  }
}

export function BotaoSincronizar({ connectionId }: { connectionId: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });

  async function executar() {
    setEstado({ tipo: 'rodando', rodada: 1, itens: 0 });
    const resultado = await sincronizarConexao(connectionId, (rodada, itens, recurso) =>
      setEstado({ tipo: 'rodando', rodada, itens, recurso }),
    );
    if (resultado.erro) {
      setEstado({ tipo: 'erro', mensagem: resultado.erro });
    } else {
      setEstado({ tipo: 'concluido', itens: resultado.itens });
      // Recarrega para o "última sincronização" da linha refletir a verdade.
      window.location.reload();
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, marginLeft: 8 }}>
      <button
        type="button"
        style={{ ...estiloBotao, opacity: estado.tipo === 'rodando' ? 0.6 : 1 }}
        disabled={estado.tipo === 'rodando'}
        onClick={executar}
      >
        {rotulo(estado, 'Sincronizar agora')}
      </button>
      {estado.tipo === 'erro' && (
        <span style={{ fontSize: 11, color: 'var(--crit)', maxWidth: 260 }}>{estado.mensagem}</span>
      )}
    </span>
  );
}

/**
 * Desconectar, com confirmação e resultado visível.
 *
 * Era uma Server Action: apagar funciona, mas quando algo dá errado o
 * usuário só vê a página igual. "Não funciona" era isso — nenhum caminho
 * para saber o motivo. Aqui a falha vira texto na tela.
 */
export function BotaoDesconectar({
  connectionId,
  rotuloConta,
}: {
  connectionId: string;
  rotuloConta: string;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });

  async function executar() {
    // Apagar o cache de uma caixa é irreversível (o próximo sync rebaixa
    // tudo de novo, mas leva tempo). Vale uma pergunta.
    if (!window.confirm(`Desconectar ${rotuloConta}?`)) return;

    setEstado({ tipo: 'rodando', rodada: 1, itens: 0 });
    try {
      const resposta = await fetch(`/api/connections/${connectionId}`, { method: 'DELETE' });
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };
        setEstado({
          tipo: 'erro',
          mensagem: corpo.error ?? `Falha ao desconectar (HTTP ${resposta.status})`,
        });
        return;
      }
      window.location.reload();
    } catch (erro) {
      setEstado({
        tipo: 'erro',
        mensagem: erro instanceof Error ? erro.message : 'Falha de rede ao desconectar',
      });
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, marginLeft: 8 }}>
      <button
        type="button"
        style={{
          ...estiloBotao,
          border: '1px solid var(--crit)',
          color: 'var(--crit)',
          opacity: estado.tipo === 'rodando' ? 0.6 : 1,
        }}
        disabled={estado.tipo === 'rodando'}
        onClick={executar}
      >
        {estado.tipo === 'rodando' ? 'Desconectando…' : 'Desconectar'}
      </button>
      {estado.tipo === 'erro' && (
        <span style={{ fontSize: 11, color: 'var(--crit)', maxWidth: 260 }}>{estado.mensagem}</span>
      )}
    </span>
  );
}

export function BotaoSincronizarTodas({ connectionIds }: { connectionIds: string[] }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });
  const [posicao, setPosicao] = useState(0);

  async function executar() {
    let totalItens = 0;
    const erros: string[] = [];

    for (let i = 0; i < connectionIds.length; i += 1) {
      setPosicao(i + 1);
      const id = connectionIds[i];
      if (!id) continue;
      setEstado({ tipo: 'rodando', rodada: 1, itens: totalItens });
      // Sequencial de propósito: cada caixa no seu tempo, cada requisição
      // curta — cinco caixas em paralelo brigariam pelo mesmo limite.
      const resultado = await sincronizarConexao(id, (rodada, itens, recurso) =>
        setEstado({ tipo: 'rodando', rodada, itens: totalItens + itens, recurso }),
      );
      totalItens += resultado.itens;
      if (resultado.erro) erros.push(resultado.erro);
    }

    if (erros.length > 0) {
      setEstado({ tipo: 'erro', mensagem: `${totalItens} itens; ${erros.length} caixa(s) com erro: ${erros[0]}` });
    } else {
      setEstado({ tipo: 'concluido', itens: totalItens });
      window.location.reload();
    }
  }

  if (connectionIds.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <button
        type="button"
        style={{ ...estiloBotao, fontWeight: 600, opacity: estado.tipo === 'rodando' ? 0.6 : 1 }}
        disabled={estado.tipo === 'rodando'}
        onClick={executar}
      >
        {estado.tipo === 'rodando'
          ? `Caixa ${posicao}/${connectionIds.length}${estado.recurso ? ` · ${estado.recurso}` : ''}… ${estado.itens} itens`
          : rotulo(estado, `Sincronizar todas as caixas (${connectionIds.length})`)}
      </button>
      {estado.tipo === 'erro' && (
        <span style={{ fontSize: 11, color: 'var(--crit)', maxWidth: 340 }}>{estado.mensagem}</span>
      )}
    </span>
  );
}
