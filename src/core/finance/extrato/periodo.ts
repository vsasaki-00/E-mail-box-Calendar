import { zonedParts, zonedTimeToUtc } from '@/core/time/zone';

/**
 * Periodo do extrato a partir da URL: atalhos ("este mes") ou datas.
 *
 * Tudo calculado NO FUSO DO USUARIO. "Este mes" as 23h de 31/08 em Sao Paulo
 * ja e setembro em UTC — e o filtro errado deixaria o ultimo dia do mes de
 * fora, que e justamente onde ficam os pagamentos de fim de mes.
 */

export type Atalho = 'mes' | 'mes-passado' | '30d' | '90d' | 'ano' | 'tudo';

export const ATALHOS: { chave: Atalho; rotulo: string }[] = [
  { chave: 'mes', rotulo: 'este mês' },
  { chave: 'mes-passado', rotulo: 'mês passado' },
  { chave: '30d', rotulo: '30 dias' },
  { chave: '90d', rotulo: '90 dias' },
  { chave: 'ano', rotulo: 'este ano' },
  { chave: 'tudo', rotulo: 'tudo' },
];

export interface Periodo {
  /** Inclusivo. Ausente = sem limite. */
  inicio?: Date;
  /** EXCLUSIVO (primeiro instante fora do periodo). Ausente = sem limite. */
  fim?: Date;
  /** O que a tela mostra. */
  rotulo: string;
  /** O atalho em vigor, se algum; datas livres nao tem. */
  atalho?: Atalho;
  /** Datas ISO (aaaa-mm-dd) para preencher os campos do formulario. */
  deIso?: string;
  ateIso?: string;
}

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoPara(timeZone: string, ano: number, mes: number, dia: number): string {
  const p = zonedParts(zonedTimeToUtc(timeZone, ano, mes, dia, 12, 0), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Inicio do dia (00:00) daquela data ISO no fuso; undefined se invalida. */
function inicioDoDiaIso(iso: string | undefined, timeZone: string): Date | undefined {
  if (!iso) return undefined;
  const m = RE_ISO.exec(iso.trim());
  if (!m) return undefined;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return undefined;
  const d = zonedTimeToUtc(timeZone, ano, mes, dia, 0, 0);
  // Rejeita 31/02 etc.: o Date "arredonda" para o mes seguinte.
  return zonedParts(d, timeZone).month === mes ? d : undefined;
}

function formatarIso(iso: string): string {
  const m = RE_ISO.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function resolverPeriodo(
  entrada: { atalho?: string; de?: string; ate?: string },
  timeZone: string,
  agora = new Date(),
): Periodo {
  const hoje = zonedParts(agora, timeZone);

  // Datas explicitas mandam. Uma so tambem vale ("a partir de", "ate").
  const de = inicioDoDiaIso(entrada.de, timeZone);
  const ate = inicioDoDiaIso(entrada.ate, timeZone);
  if (de || ate) {
    const fim = ate ? zonedTimeToUtc(timeZone, ...diaSeguinte(ate, timeZone)) : undefined;
    const deIso = de ? entrada.de!.trim() : undefined;
    const ateIso = ate ? entrada.ate!.trim() : undefined;
    const rotulo =
      deIso && ateIso
        ? `${formatarIso(deIso)} a ${formatarIso(ateIso)}`
        : deIso
          ? `a partir de ${formatarIso(deIso)}`
          : `até ${formatarIso(ateIso!)}`;
    return { inicio: de, fim, rotulo, deIso, ateIso };
  }

  const atalho = (ATALHOS.some((a) => a.chave === entrada.atalho) ? entrada.atalho : 'mes') as Atalho;

  switch (atalho) {
    case 'mes':
      return {
        atalho,
        inicio: zonedTimeToUtc(timeZone, hoje.year, hoje.month, 1, 0, 0),
        fim: zonedTimeToUtc(timeZone, hoje.year, hoje.month + 1, 1, 0, 0),
        rotulo: 'este mês',
        deIso: isoPara(timeZone, hoje.year, hoje.month, 1),
        ateIso: isoPara(timeZone, hoje.year, hoje.month, hoje.day),
      };
    case 'mes-passado': {
      const inicio = zonedTimeToUtc(timeZone, hoje.year, hoje.month - 1, 1, 0, 0);
      const fim = zonedTimeToUtc(timeZone, hoje.year, hoje.month, 1, 0, 0);
      const ultimo = zonedParts(new Date(fim.getTime() - 1), timeZone);
      return {
        atalho,
        inicio,
        fim,
        rotulo: 'mês passado',
        deIso: isoPara(timeZone, hoje.year, hoje.month - 1, 1),
        ateIso: isoPara(timeZone, ultimo.year, ultimo.month, ultimo.day),
      };
    }
    case '30d':
    case '90d': {
      const dias = atalho === '30d' ? 30 : 90;
      return {
        atalho,
        inicio: zonedTimeToUtc(timeZone, hoje.year, hoje.month, hoje.day - dias + 1, 0, 0),
        fim: zonedTimeToUtc(timeZone, hoje.year, hoje.month, hoje.day + 1, 0, 0),
        rotulo: `últimos ${dias} dias`,
        deIso: isoPara(timeZone, hoje.year, hoje.month, hoje.day - dias + 1),
        ateIso: isoPara(timeZone, hoje.year, hoje.month, hoje.day),
      };
    }
    case 'ano':
      return {
        atalho,
        inicio: zonedTimeToUtc(timeZone, hoje.year, 1, 1, 0, 0),
        fim: zonedTimeToUtc(timeZone, hoje.year + 1, 1, 1, 0, 0),
        rotulo: `${hoje.year}`,
        deIso: isoPara(timeZone, hoje.year, 1, 1),
        ateIso: isoPara(timeZone, hoje.year, hoje.month, hoje.day),
      };
    case 'tudo':
      return { atalho, rotulo: 'todo o histórico' };
  }
}

function diaSeguinte(d: Date, timeZone: string): [number, number, number, number, number] {
  const p = zonedParts(d, timeZone);
  return [p.year, p.month, p.day + 1, 0, 0];
}
