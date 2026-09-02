'use client';

import { useState } from 'react';

/**
 * Upload de extrato com o resultado na tela.
 *
 * O formulario fala o que aconteceu em numeros — encontrados, criados,
 * duplicados — porque importacao silenciosa e o jeito classico de perder
 * lancamento sem perceber.
 */

export interface ContaOpcao {
  id: string;
  label: string;
}

interface Resultado {
  contaRotulo: string;
  formato: string;
  encontrados: number;
  criados: number;
  duplicados: number;
  avisos: string[];
  jaImportado: boolean;
}

type Estado =
  | { tipo: 'ocioso' }
  | { tipo: 'enviando' }
  | { tipo: 'ok'; resultado: Resultado }
  | { tipo: 'erro'; mensagem: string; avisos: string[] };

const campo = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
} as const;

export function ImportarExtrato({
  contas,
  negocios,
}: {
  contas: ContaOpcao[];
  negocios: readonly string[];
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'ocioso' });
  const [destino, setDestino] = useState<string>(contas[0]?.id ?? 'nova');

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const dados = new FormData(form);
    if (destino !== 'nova' && destino !== 'auto') dados.set('accountId', destino);
    if (destino !== 'nova') {
      dados.delete('novaContaLabel');
      dados.delete('novaContaKind');
      dados.delete('novaContaBusiness');
    }

    setEstado({ tipo: 'enviando' });
    try {
      const resposta = await fetch('/api/financeiro/extrato', { method: 'POST', body: dados });
      const texto = await resposta.text();
      let corpo: Partial<Resultado> & { error?: string; avisos?: string[] };
      try {
        corpo = JSON.parse(texto) as typeof corpo;
      } catch {
        setEstado({ tipo: 'erro', mensagem: `Servidor respondeu HTTP ${resposta.status}`, avisos: [] });
        return;
      }
      if (!resposta.ok) {
        setEstado({ tipo: 'erro', mensagem: corpo.error ?? `Falha (HTTP ${resposta.status})`, avisos: corpo.avisos ?? [] });
        return;
      }
      setEstado({ tipo: 'ok', resultado: corpo as Resultado });
      form.reset();
      // Recarrega para a lista de contas e lancamentos refletir.
      setTimeout(() => window.location.reload(), 1200);
    } catch (erro) {
      setEstado({ tipo: 'erro', mensagem: erro instanceof Error ? erro.message : 'Falha de rede', avisos: [] });
    }
  }

  return (
    <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" name="arquivo" accept=".ofx,.csv,.txt,.qfx" required style={{ fontSize: 13 }} />

        <label style={{ fontSize: 12, color: 'var(--muted)' }}>
          para{' '}
          <select value={destino} onChange={(e) => setDestino(e.target.value)} style={campo}>
            <option value="auto">a conta que o OFX indicar</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value="nova">nova conta…</option>
          </select>
        </label>
      </div>

      {destino === 'nova' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input name="novaContaLabel" placeholder="Nome da conta (ex.: Itaú PJ Unitedcom)" required style={{ ...campo, minWidth: 260 }} />
          <select name="novaContaKind" defaultValue="CHECKING" style={campo}>
            <option value="CHECKING">conta corrente</option>
            <option value="SAVINGS">poupança</option>
            <option value="CREDIT_CARD">cartão de crédito</option>
            <option value="CASH">dinheiro</option>
            <option value="INVESTMENT">investimento</option>
            <option value="OTHER">outra</option>
          </select>
          <select name="novaContaBusiness" defaultValue="" style={campo}>
            <option value="">negócio: (nenhum)</option>
            {negocios.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={estado.tipo === 'enviando'}
          style={{
            padding: '8px 14px',
            borderRadius: 3,
            border: '1px solid var(--meridiano)',
            background: 'var(--meridiano)',
            color: '#fffdf9',
            cursor: estado.tipo === 'enviando' ? 'progress' : 'pointer',
            fontSize: 13,
            opacity: estado.tipo === 'enviando' ? 0.6 : 1,
          }}
        >
          {estado.tipo === 'enviando' ? 'Importando…' : 'Importar extrato'}
        </button>
        <span className="sub" style={{ fontSize: 11 }}>
          OFX ou CSV. O arquivo não é guardado — só o que foi lido dele.
        </span>
      </div>

      {estado.tipo === 'ok' && (
        <div className="aviso" style={{ fontSize: 13 }}>
          <strong>{estado.resultado.jaImportado ? 'Já importado antes.' : 'Importado.'}</strong>{' '}
          {estado.resultado.formato} → {estado.resultado.contaRotulo}: {estado.resultado.encontrados} no arquivo,{' '}
          <strong>{estado.resultado.criados} novos</strong>, {estado.resultado.duplicados} já existiam.
          {estado.resultado.avisos.map((a) => (
            <div key={a} className="sub" style={{ marginTop: 4 }}>
              ⚠ {a}
            </div>
          ))}
        </div>
      )}
      {estado.tipo === 'erro' && (
        <div style={{ fontSize: 12, color: 'var(--crit)' }}>
          {estado.mensagem}
          {estado.avisos.map((a) => (
            <div key={a} className="sub" style={{ marginTop: 2 }}>
              ⚠ {a}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
