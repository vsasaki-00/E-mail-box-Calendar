import { formatarValor } from '@/core/finance/format';
import type { CategoriaTotal, MesFluxo } from '@/core/finance/analise';

/**
 * Gráficos da análise, em SVG puro — sem biblioteca.
 *
 * Cores validadas contra daltonismo (o par verde×vermelho do resto do app
 * tem ΔE 7,1 em deuteranopia, ou seja: quem não distingue verde de vermelho
 * não leria o gráfico). Aqui entrada é AZUL e saída é VERMELHA — ΔE 20,2,
 * e ainda com posição fixa, legenda e rótulo direto, que é o que torna a
 * leitura independente de cor. As tabelas do app seguem com verde/vermelho
 * porque lá o sinal (+/−) e a coluna já carregam a informação.
 *
 * Barras de categoria são série única, na cor do próprio Meridiano: não há
 * nada de que distingui-las, então o teal de baixa saturação serve.
 */

const ENTRADA = '#1b6ea8';
const SAIDA = '#a93a24';
const CATEGORIA = 'var(--meridiano)';

/** 'AAAA-MM' → 'ago/26'. */
function rotuloMes(mes: string): string {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [ano, m] = mes.split('-');
  return `${nomes[Number(m) - 1] ?? m}/${ano?.slice(2) ?? ''}`;
}

export function Legenda({ itens }: { itens: { cor: string; rotulo: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
      {itens.map((i) => (
        <span key={i.rotulo} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: i.cor, flex: 'none' }} />
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

/**
 * Fluxo mensal: entradas e saídas lado a lado, na mesma escala.
 *
 * Uma escala só, nunca dois eixos — as duas séries são reais em centavos e
 * a comparação entre elas é o ponto do gráfico.
 */
export function GraficoFluxo({ meses }: { meses: MesFluxo[] }) {
  const maximo = Math.max(1, ...meses.map((m) => Math.max(m.entradas, Math.abs(m.saidas))));
  const largura = Math.max(320, meses.length * 56);
  const altura = 150;
  const base = altura - 22;
  const larguraBarra = 9;
  const passo = largura / meses.length;

  return (
    <div style={{ overflowX: 'auto' }}>
      <Legenda itens={[{ cor: ENTRADA, rotulo: 'entradas' }, { cor: SAIDA, rotulo: 'saídas' }]} />
      <svg width={largura} height={altura} role="img" aria-label="Entradas e saídas por mês" style={{ display: 'block' }}>
        {/* Linha de base recessiva: referência, não protagonista. */}
        <line x1={0} y1={base} x2={largura} y2={base} stroke="var(--border-forte)" strokeWidth={1} />
        {meses.map((m, i) => {
          const centro = i * passo + passo / 2;
          const hEnt = Math.round((m.entradas / maximo) * (base - 8));
          const hSai = Math.round((Math.abs(m.saidas) / maximo) * (base - 8));
          return (
            <g key={m.mes}>
              {/* 2px de folga entre as duas barras do mesmo mês. */}
              <rect x={centro - larguraBarra - 1} y={base - hEnt} width={larguraBarra} height={hEnt} fill={ENTRADA} rx={2}>
                <title>{`${rotuloMes(m.mes)} · entradas ${formatarValor(m.entradas)}`}</title>
              </rect>
              <rect x={centro + 1} y={base - hSai} width={larguraBarra} height={hSai} fill={SAIDA} rx={2}>
                <title>{`${rotuloMes(m.mes)} · saídas ${formatarValor(m.saidas)}`}</title>
              </rect>
              <text x={centro} y={altura - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {rotuloMes(m.mes)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Barras horizontais, série única, maior primeiro. Rótulo em todas: são poucas. */
export function GraficoCategorias({ categorias }: { categorias: CategoriaTotal[] }) {
  const visiveis = categorias.slice(0, 10);
  const maximo = Math.max(1, ...visiveis.map((c) => Math.abs(c.total)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {visiveis.map((c) => (
        <div key={c.categoria} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 100px', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.categoria}>
            {c.categoria}
          </span>
          <span style={{ background: 'var(--surface-alt)', borderRadius: 2, height: 14, position: 'relative' }}>
            <span
              style={{
                display: 'block',
                width: `${Math.max(1, (Math.abs(c.total) / maximo) * 100)}%`,
                height: '100%',
                background: CATEGORIA,
                borderRadius: 2,
              }}
              title={`${c.categoria}: ${formatarValor(c.total)} em ${c.quantidade} lançamento(s)`}
            />
          </span>
          <span style={{ textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {formatarValor(c.total)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Small multiples por negócio: um mini-gráfico por linha, mesma escala
 * entre eles. É o que substitui uma paleta de sete cores — comparar seis
 * negócios por cor não funciona, comparar por posição funciona.
 */
export function MiniFluxo({ meses, escala }: { meses: MesFluxo[]; escala: number }) {
  const largura = Math.max(80, meses.length * 10);
  const altura = 32;
  const base = altura - 1;
  const passo = largura / meses.length;

  return (
    <svg width={largura} height={altura} role="img" aria-label="Fluxo mensal" style={{ display: 'block' }}>
      <line x1={0} y1={base} x2={largura} y2={base} stroke="var(--border)" strokeWidth={1} />
      {meses.map((m, i) => {
        const x = i * passo;
        const hEnt = Math.round((m.entradas / escala) * (base - 2));
        const hSai = Math.round((Math.abs(m.saidas) / escala) * (base - 2));
        return (
          <g key={m.mes}>
            <rect x={x + 1} y={base - hEnt} width={3} height={hEnt} fill={ENTRADA} rx={1}>
              <title>{`${rotuloMes(m.mes)} · entradas ${formatarValor(m.entradas)}`}</title>
            </rect>
            <rect x={x + 5} y={base - hSai} width={3} height={hSai} fill={SAIDA} rx={1}>
              <title>{`${rotuloMes(m.mes)} · saídas ${formatarValor(m.saidas)}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
