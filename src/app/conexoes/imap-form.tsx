'use client';

import { useState, type FormEvent } from 'react';

/**
 * Formulario de conexao manual (Apple iCloud / IMAP+CalDAV generico).
 * Sem OAuth: o POST em /api/connections/imap testa a conexao ao vivo antes
 * de gravar qualquer coisa. Ver docs/03-conectores.md
 */

const campo = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  marginTop: 4,
} as const;

const botao = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
} as const;

type Estado =
  | { tipo: 'ocioso' }
  | { tipo: 'enviando' }
  | { tipo: 'sucesso'; email: string }
  | { tipo: 'erro'; mensagem: string };

export function FormularioImapCaldav() {
  const [aberto, setAberto] = useState(false);
  const [avancado, setAvancado] = useState(false);
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const email = String(dados.get('email') ?? '');
    const password = String(dados.get('password') ?? '');
    const imapHost = String(dados.get('imapHost') ?? '').trim();
    const imapPortRaw = String(dados.get('imapPort') ?? '').trim();
    const caldavUrl = String(dados.get('caldavUrl') ?? '').trim();

    setEstado({ tipo: 'enviando' });
    try {
      const resposta = await fetch('/api/connections/imap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(imapHost ? { imapHost } : {}),
          ...(imapPortRaw ? { imapPort: Number(imapPortRaw) } : {}),
          ...(caldavUrl ? { caldavUrl } : {}),
        }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setEstado({ tipo: 'erro', mensagem: corpo.error ?? `Falha (HTTP ${resposta.status})` });
        return;
      }
      setEstado({ tipo: 'sucesso', email: corpo.accountEmail });
      // Recarrega para a nova conexao aparecer na lista de "Contas conectadas".
      window.location.reload();
    } catch (erro) {
      setEstado({
        tipo: 'erro',
        mensagem: erro instanceof Error ? erro.message : 'Falha de rede ao conectar',
      });
    }
  }

  if (!aberto) {
    return (
      <button type="button" style={botao} onClick={() => setAberto(true)}>
        Conectar Apple iCloud / IMAP+CalDAV
      </button>
    );
  }

  return (
    <form
      onSubmit={enviar}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        maxWidth: 420,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div>
        <label className="sub" htmlFor="imap-email">
          E-mail
        </label>
        <input id="imap-email" name="email" type="email" required style={campo} placeholder="voce@icloud.com" />
      </div>
      <div>
        <label className="sub" htmlFor="imap-password">
          Senha de app
        </label>
        <input id="imap-password" name="password" type="password" required style={campo} />
        <p className="sub" style={{ marginTop: 4, fontSize: 11 }}>
          Nunca a senha principal da conta. No iCloud, gere uma em{' '}
          <code>appleid.apple.com</code> → Segurança → Senhas específicas de app.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setAvancado((v) => !v)}
        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, textAlign: 'left', padding: 0 }}
      >
        {avancado ? '− ocultar' : '+ configurar'} host/porta manualmente
      </button>

      {avancado && (
        <>
          <div>
            <label className="sub" htmlFor="imap-host">
              Host IMAP
            </label>
            <input id="imap-host" name="imapHost" type="text" style={campo} placeholder="detectado pelo domínio do e-mail" />
          </div>
          <div>
            <label className="sub" htmlFor="imap-port">
              Porta IMAP
            </label>
            <input id="imap-port" name="imapPort" type="number" style={campo} placeholder="993" />
          </div>
          <div>
            <label className="sub" htmlFor="caldav-url">
              URL do CalDAV
            </label>
            <input id="caldav-url" name="caldavUrl" type="text" style={campo} placeholder="detectado pelo domínio do e-mail" />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" style={botao} disabled={estado.tipo === 'enviando'}>
          {estado.tipo === 'enviando' ? 'Testando conexão…' : 'Conectar'}
        </button>
        <button type="button" style={{ ...botao, border: 'none', background: 'none' }} onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>

      {estado.tipo === 'erro' && (
        <p className="sub" style={{ color: 'var(--crit)' }}>
          {estado.mensagem}
        </p>
      )}
      {estado.tipo === 'sucesso' && (
        <p className="sub" style={{ color: 'var(--ok)' }}>
          {estado.email} conectado.
        </p>
      )}
    </form>
  );
}
