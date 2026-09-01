import { lerConfigDoBanco } from '@/lib/db-config';

/**
 * Mostra a configuração de banco em vigor. Ver src/lib/db-config.ts —
 * só parâmetros e host mascarado, nunca credencial.
 */
export function ConfiguracaoDoBanco() {
  const config = lerConfigDoBanco();
  if (!config) return null;

  return (
    <p className="sub" style={{ marginTop: 12, fontSize: 11 }}>
      Banco em uso: <code>{config.hostResumido}</code> · <code>{config.parametros}</code>
      {config.alertaLimite && (
        <>
          <br />
          <span style={{ color: 'var(--crit)' }}>
            <strong>connection_limit=1</strong> põe as consultas em fila e causa
            &quot;Timed out fetching a new connection&quot;. Troque para{' '}
            <code>connection_limit=5&amp;pool_timeout=20</code> na variável <code>DATABASE_URL</code>{' '}
            e faça um novo deploy — esta linha só muda quando o deploy novo entra no ar.
          </span>
        </>
      )}
    </p>
  );
}
