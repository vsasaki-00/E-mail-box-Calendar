'use client';

import { reconhecerAlerta } from './alertas-actions';

/**
 * Uma linha de alerta com reconhecimento. Ver docs/05-torre-de-controle.md
 *
 * "Eu sei" silencia enquanto a condição durar — não apaga. Quando a
 * condição se resolve, o alerta some sozinho; se voltar depois, volta a
 * aparecer, porque é um problema novo ainda que pareça o mesmo.
 */
export function AlertaLinha({
  alerta,
}: {
  alerta: { id: string; severity: string; title: string; detail: string | null };
}) {
  const classe =
    alerta.severity === 'CRITICAL' ? 'crit' : alerta.severity === 'WARN' ? 'warn' : 'ok';

  return (
    <div className="linha">
      <span className={`pill ${classe}`}>{alerta.severity.toLowerCase()}</span>
      <span className="titulo-item">
        {alerta.title}
        <br />
        <span className="sub">{alerta.detail}</span>
      </span>
      <button
        type="button"
        onClick={() => reconhecerAlerta(alerta.id)}
        title="Silencia enquanto a condição durar. Não apaga."
        style={{
          padding: '3px 9px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--muted)',
          cursor: 'pointer',
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}
      >
        eu sei
      </button>
    </div>
  );
}
