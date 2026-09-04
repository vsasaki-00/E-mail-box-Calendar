import { DEFAULT_TIMEZONE, formatDateTime, formatTime } from '@/core/time/zone';

/**
 * Sincronização automática: quando roda, e se está de pé.
 *
 * Existe porque "roda sozinho" é uma promessa invisível. Sem esta faixa, uma
 * automação desligada e uma automação funcionando têm exatamente a mesma
 * aparência — e a diferença só apareceria dias depois, numa caixa parada.
 *
 * E não basta dizer que a volta aconteceu: uma volta que sincronizou uma
 * caixa de seis também "aconteceu". A faixa diz quantas ela pegou.
 */

/**
 * Horários do disparo, em UTC.
 *
 * ESPELHA `.github/workflows/sincronizar.yml` (`cron: 0 10,16,22 * * *`).
 * Mudou lá, muda aqui. Guardar em UTC e converter na hora de mostrar é o que
 * mantém o texto correto para qualquer fuso do perfil.
 */
const HORAS_UTC = [10, 16, 22];

function horariosNoFuso(timeZone: string): string[] {
  const hoje = new Date();
  return HORAS_UTC.map((hora) => {
    const instante = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), hora, 0, 0),
    );
    return formatTime(instante, timeZone);
  });
}

export function SincronizacaoAutomatica({
  ultimoSync,
  alcancadas,
  total,
  timeZone = DEFAULT_TIMEZONE,
}: {
  ultimoSync: Date | null;
  /** Quantas caixas a última volta realmente pegou. */
  alcancadas: number;
  total: number;
  timeZone?: string;
}) {
  // Só a existência, nunca o valor. Sem o segredo a rota devolve 503 e a
  // automação não roda — é a falha nº 1, e ela seria silenciosa.
  const segredoConfigurado = Boolean(process.env.CRON_SECRET);
  const horarios = horariosNoFuso(timeZone);

  return (
    <p className="sub" style={{ marginTop: 12, fontSize: 12 }}>
      <strong>Sincronização automática:</strong> {horarios.join(', ')} — 3× por dia.{' '}
      {/* Dizer QUANTAS caixas a volta pegou, e não só que ela aconteceu.
          "Último ciclo em 04/09, 07:07" é verdade e engana: em produção
          essa volta sincronizou UMA das seis contas, e as outras cinco
          estavam paradas desde a véspera — a faixa dizia que o
          agendamento estava saudável. */}
      {ultimoSync ? (
        <>
          {`Último ciclo em ${formatDateTime(ultimoSync, timeZone)} — `}
          <strong style={{ color: alcancadas < total ? 'var(--zenite)' : undefined }}>
            {alcancadas === total
              ? `alcançou as ${total} caixas`
              : `alcançou ${alcancadas} de ${total}`}
          </strong>
          .
        </>
      ) : (
        'Nenhum ciclo registrado ainda.'
      )}
      {!segredoConfigurado && (
        <>
          <br />
          <span style={{ color: 'var(--crit)' }}>
            <code>CRON_SECRET</code> não está configurada — a rota automática recusa toda chamada
            enquanto isso. Sem ela, só o botão acima sincroniza.
          </span>
        </>
      )}
    </p>
  );
}
