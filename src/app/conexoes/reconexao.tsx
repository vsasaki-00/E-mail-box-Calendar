'use client';

import { useEffect, useState } from 'react';

/**
 * Desconectar todas de uma vez, e a fila para reconectar.
 *
 * O limite que molda esta tela: **reconectar não pode ser automático**. O
 * OAuth exige que você autorize na tela do provedor — é exatamente isso que
 * impede um app de acessar caixas sem consentimento. Um botão que
 * dispensasse essa tela seria uma falha de segurança, não um recurso.
 *
 * O que dá para eliminar é o atrito em volta: lembrar quais contas existiam,
 * em que ordem, de qual provedor, e ter que achar cada uma na lista do
 * Google. A fila guarda esse "lastro" e cada botão leva direto à conta
 * certa, já sugerida na tela de autorização.
 *
 * A lista vive no `localStorage`: é do seu navegador, some quando termina, e
 * não precisou de tabela nova nem de migração no banco de produção.
 */

const CHAVE = 'meridiano_reconectar';

export interface ContaParaReconectar {
  /** Presente ao desconectar; a fila guardada nao precisa dele. */
  id?: string;
  accountEmail: string;
  provider: string;
}

function ler(): ContaParaReconectar[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const dados = JSON.parse(bruto) as unknown;
    if (!Array.isArray(dados)) return [];
    return dados.filter(
      (c): c is ContaParaReconectar =>
        typeof c === 'object' && c !== null && typeof (c as ContaParaReconectar).accountEmail === 'string',
    );
  } catch {
    // Navegador sem localStorage, ou conteúdo corrompido: a fila é uma
    // conveniência, nunca um pré-requisito para reconectar.
    return [];
  }
}

function gravar(contas: ContaParaReconectar[]): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(contas));
  } catch {
    // Sem espaço ou sem permissão: segue sem a fila.
  }
}

const botao = {
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
} as const;

export function BotaoDesconectarTodas({ contas }: { contas: ContaParaReconectar[] }) {
  const [estado, setEstado] = useState<'ocioso' | 'rodando'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  if (contas.length === 0) return null;

  async function executar() {
    if (
      !window.confirm(
        `Desconectar TODAS as ${contas.length} contas?\n\n` +
          'A lista fica guardada para você reconectar em seguida, uma por uma ' +
          '(o provedor exige sua autorização em cada uma).\n\n' +
          'Mensagens, eventos e triagens já sincronizados não são apagados.',
      )
    ) {
      return;
    }

    setEstado('rodando');
    setErro(null);

    // Guarda o lastro ANTES de apagar: depois de desconectar, a lista de
    // contas não existe mais em lugar nenhum.
    // Sem o `id`: ele morre junto com a conexao, e a fila so precisa saber
    // qual caixa e de qual provedor.
    gravar(contas.map(({ accountEmail, provider }) => ({ accountEmail, provider })));

    const falhas: string[] = [];
    for (const conta of contas) {
      try {
        const resposta = await fetch(`/api/connections/${conta.id}`, { method: 'DELETE' });
        if (!resposta.ok) falhas.push(conta.accountEmail);
      } catch {
        falhas.push(conta.accountEmail);
      }
    }

    if (falhas.length > 0) {
      setEstado('ocioso');
      setErro(`Não foi possível desconectar: ${falhas.join(', ')}`);
      return;
    }
    window.location.reload();
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <button
        type="button"
        onClick={executar}
        disabled={estado === 'rodando'}
        style={{ ...botao, border: '1px solid var(--crit)', color: 'var(--crit)' }}
      >
        {estado === 'rodando' ? 'Desconectando…' : `Desconectar todas (${contas.length})`}
      </button>
      {erro && <span style={{ fontSize: 11, color: 'var(--crit)' }}>{erro}</span>}
    </span>
  );
}

/**
 * Fila de reconexão: mostra o que falta e leva direto à conta certa.
 * Some sozinha conforme as contas voltam.
 */
export function FilaReconexao({ jaConectados }: { jaConectados: string[] }) {
  const [fila, setFila] = useState<ContaParaReconectar[]>([]);

  useEffect(() => {
    // Remove da fila quem já voltou: assim ela se esvazia sozinha à medida
    // que você reconecta, sem exigir que você marque nada.
    const conectados = new Set(jaConectados.map((e) => e.toLowerCase()));
    const restante = ler().filter((c) => !conectados.has(c.accountEmail.toLowerCase()));
    gravar(restante);
    setFila(restante);
  }, [jaConectados]);

  if (fila.length === 0) return null;

  return (
    <section className="card" style={{ borderLeft: '3px solid var(--zenite)' }}>
      <h2>Reconectar {fila.length} conta(s)</h2>
      <p className="sub" style={{ marginBottom: 10 }}>
        O provedor exige sua autorização em cada caixa — não há como pular essa etapa. Cada botão
        já abre na conta certa. A lista some sozinha conforme elas voltam.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {fila.map((conta) => {
          // Só Google e Microsoft têm fluxo OAuth. Apple e IMAP/CalDAV
          // entram pelo formulário de senha de app — apontar um botão para
          // `/api/auth/apple/start` daria 404, e o teste desta tela pegou
          // exatamente isso.
          const temOAuth = conta.provider === 'GOOGLE' || conta.provider === 'MICROSOFT';
          return (
            <div key={conta.accountEmail} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {temOAuth ? (
                <a
                  href={`/api/auth/${conta.provider.toLowerCase()}/start?conta=${encodeURIComponent(conta.accountEmail)}`}
                >
                  <button type="button" style={botao}>
                    Reconectar
                  </button>
                </a>
              ) : (
                <span className="sub" style={{ fontSize: 11 }}>
                  use o formulário IMAP+CalDAV abaixo ↓
                </span>
              )}
              <span style={{ fontSize: 13 }}>{conta.accountEmail}</span>
              <span className="sub" style={{ fontSize: 11 }}>{conta.provider}</span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          gravar([]);
          setFila([]);
        }}
        style={{ ...botao, border: 'none', marginTop: 10, color: 'var(--muted)' }}
      >
        descartar lista
      </button>
    </section>
  );
}
