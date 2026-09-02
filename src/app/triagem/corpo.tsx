'use client';

import { useState } from 'react';

/**
 * "Ler": o corpo da mensagem, contraído, na própria linha da triagem.
 *
 * Por padrão mostra SÓ o texto novo — num "Re: Re:" o corpo inteiro é
 * quase todo citação, e o que você precisa para validar a classificação é
 * o que a pessoa escreveu agora. "Ver tudo" e "ver formatado" ficam a um
 * clique. O formatado abre num iframe com sandbox e sem imagem remota:
 * pixel de rastreamento não avisa o remetente que você leu.
 */

interface Corpo {
  textoNovo: string;
  textoCompleto: string;
  htmlSandbox?: string;
  temHtml: boolean;
  de: string;
  para: string[];
  caixa: string;
  link?: { url: string; rotulo: string };
  buscadoAgora: boolean;
}

type Estado =
  | { tipo: 'fechado' }
  | { tipo: 'carregando' }
  | { tipo: 'aberto'; corpo: Corpo; visao: 'novo' | 'tudo' | 'html' }
  | { tipo: 'erro'; mensagem: string };

const botaoLeve = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
} as const;

const linkLeve = {
  fontSize: 12,
  color: 'var(--muted)',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
  textDecoration: 'underline',
} as const;

async function buscar(unifiedItemId: string, html: boolean): Promise<Corpo> {
  const resposta = await fetch(
    `/api/messages/${encodeURIComponent(unifiedItemId)}/body${html ? '?html=1' : ''}`,
  );
  // Texto antes de JSON, como no resto do app: se a plataforma cortar a
  // função, a resposta é uma página de texto.
  const texto = await resposta.text();
  let corpo: Partial<Corpo> & { error?: string };
  try {
    corpo = JSON.parse(texto) as typeof corpo;
  } catch {
    throw new Error(`Servidor respondeu HTTP ${resposta.status}`);
  }
  if (!resposta.ok) throw new Error(corpo.error ?? `Falha (HTTP ${resposta.status})`);
  return corpo as Corpo;
}

export function BotaoLer({ unifiedItemId }: { unifiedItemId: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'fechado' });

  async function abrir() {
    setEstado({ tipo: 'carregando' });
    try {
      const corpo = await buscar(unifiedItemId, false);
      setEstado({ tipo: 'aberto', corpo, visao: 'novo' });
    } catch (erro) {
      setEstado({ tipo: 'erro', mensagem: erro instanceof Error ? erro.message : 'Falha' });
    }
  }

  async function verFormatado() {
    if (estado.tipo !== 'aberto') return;
    if (estado.corpo.htmlSandbox) {
      setEstado({ ...estado, visao: 'html' });
      return;
    }
    // O HTML só vem quando pedido: é o maior dos três e a maioria das
    // leituras não precisa dele.
    try {
      const corpo = await buscar(unifiedItemId, true);
      setEstado({ tipo: 'aberto', corpo, visao: 'html' });
    } catch (erro) {
      setEstado({ tipo: 'erro', mensagem: erro instanceof Error ? erro.message : 'Falha' });
    }
  }

  if (estado.tipo === 'fechado' || estado.tipo === 'carregando' || estado.tipo === 'erro') {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <button
          type="button"
          onClick={abrir}
          disabled={estado.tipo === 'carregando'}
          style={{ ...botaoLeve, opacity: estado.tipo === 'carregando' ? 0.6 : 1 }}
          title="Busca o conteúdo no provedor e mostra aqui, sem sair da lista"
        >
          {estado.tipo === 'carregando' ? 'buscando…' : 'ler'}
        </button>
        {estado.tipo === 'erro' && (
          <span style={{ fontSize: 11, color: 'var(--crit)', maxWidth: 260 }}>{estado.mensagem}</span>
        )}
      </span>
    );
  }

  const { corpo, visao } = estado;
  const textoMostrado = visao === 'tudo' ? corpo.textoCompleto : corpo.textoNovo;
  const temCitacao = corpo.textoCompleto.length > corpo.textoNovo.length + 20;

  return (
    <div style={{ flexBasis: '100%', marginTop: 8 }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          fontSize: 12,
          color: 'var(--muted)',
          marginBottom: 6,
        }}
      >
        <span>
          <strong>de</strong> {corpo.de}
          {corpo.para.length > 0 && (
            <>
              {' · '}
              <strong>para</strong> {corpo.para.slice(0, 3).join(', ')}
              {corpo.para.length > 3 ? ` +${corpo.para.length - 3}` : ''}
            </>
          )}
          {' · '}
          <span title="Em qual caixa esta cópia está">{corpo.caixa}</span>
        </span>
        <span style={{ display: 'inline-flex', gap: 10 }}>
          {visao !== 'novo' && (
            <button type="button" style={linkLeve} onClick={() => setEstado({ ...estado, visao: 'novo' })}>
              só o novo
            </button>
          )}
          {temCitacao && visao !== 'tudo' && (
            <button type="button" style={linkLeve} onClick={() => setEstado({ ...estado, visao: 'tudo' })}>
              ver tudo
            </button>
          )}
          {corpo.temHtml && visao !== 'html' && (
            <button type="button" style={linkLeve} onClick={verFormatado}>
              ver formatado
            </button>
          )}
          {corpo.link && (
            <a href={corpo.link.url} target="_blank" rel="noopener noreferrer" style={linkLeve}>
              {corpo.link.rotulo} ↗
            </a>
          )}
          <button type="button" style={linkLeve} onClick={() => setEstado({ tipo: 'fechado' })}>
            fechar
          </button>
        </span>
      </div>

      {visao === 'html' && corpo.htmlSandbox ? (
        <iframe
          title="Mensagem formatada"
          // Sem script. Popups liberados para os links do e-mail abrirem em
          // aba nova — e só isso.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={corpo.htmlSandbox}
          style={{
            width: '100%',
            height: 420,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: '#fff',
          }}
        />
      ) : (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            font: '13px/1.5 inherit',
            fontFamily: 'inherit',
            margin: 0,
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--surface)',
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          {textoMostrado || '(mensagem sem texto)'}
        </pre>
      )}
    </div>
  );
}
