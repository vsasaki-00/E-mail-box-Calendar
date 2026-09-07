import { lerConfigDoBanco } from '@/lib/db-config';

/**
 * Mostra a configuração de banco em vigor, e ONDE a função está rodando.
 *
 * Ver src/lib/db-config.ts — só parâmetros e host mascarado, nunca credencial.
 *
 * A região está aqui porque a sua ausência custou duas rodadas de diagnóstico
 * errado. O banco ficava em São Paulo e a função em Washington, e nada na tela
 * dizia isso: cada consulta atravessava o equador, e eu li os 583 ms como
 * "banco longe" e depois como "banco sobrecarregado". As duas erradas.
 *
 * Ao lado do banco é o lugar certo — a pergunta nunca é "onde roda a função",
 * é "por que está lento", e as duas metades da resposta moram juntas.
 */
/** Região da FUNÇÃO — não a da borda que atendeu o navegador. */
const REGIOES: Record<string, string> = {
  gru1: 'São Paulo',
  iad1: 'Washington',
  cle1: 'Cleveland',
  sfo1: 'São Francisco',
  cdg1: 'Paris',
  fra1: 'Frankfurt',
  lhr1: 'Londres',
};

export function ConfiguracaoDoBanco() {
  const config = lerConfigDoBanco();
  if (!config) return null;

  const regiao = process.env.VERCEL_REGION;
  const longe = Boolean(regiao) && regiao !== 'gru1';

  return (
    <p className="sub" style={{ marginTop: 12, fontSize: 11 }}>
      Banco em uso: <code>{config.hostResumido}</code> · <code>{config.parametros}</code>
      {regiao && (
        <>
          {' · função em '}
          <code>{regiao}</code>
          {REGIOES[regiao] ? ` (${REGIOES[regiao]})` : ''}
        </>
      )}
      {longe && (
        <>
          <br />
          <span style={{ color: 'var(--zenite)' }}>
            O banco está em São Paulo e a função não. Cada consulta atravessa o
            equador, e é isso — não o banco — que faz tudo custar centenas de
            milissegundos. Corrige-se com <code>&quot;regions&quot;: [&quot;gru1&quot;]</code> no{' '}
            <code>vercel.json</code>, e só vale no deploy seguinte.
          </span>
        </>
      )}
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
