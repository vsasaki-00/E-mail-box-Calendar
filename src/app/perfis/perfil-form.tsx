'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BUSINESS_DEFAULTS,
  isBusinessContext,
  type BusinessContext,
} from '@/core/triage/businesses';
import { salvarPerfil, type SalvarPerfilResultado } from './actions';

/**
 * Formulario do perfil de uma caixa. Ver docs/07-agente-de-triagem.md
 *
 * O que se preenche aqui entra no prompt de triagem de toda mensagem desta
 * caixa — e o que torna "negócios diferentes" um conceito real em vez de um
 * ajuste global.
 */

export interface PerfilInicial {
  connectionId: string;
  accountEmail: string;
  color: string;
  provider: string;
  businessName: string;
  role: string;
  objective: string;
  calibration: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  vipSenders: string;
  urgentKeywords: string;
  /** Ja existe perfil salvo? Muda o texto do estado vazio. */
  configurado: boolean;
}

const CALIBRACOES = [
  {
    valor: 'CONSERVATIVE' as const,
    titulo: 'Conservadora',
    texto:
      'Na dúvida, o e-mail aparece. Mais ruído, mas nunca esconde o primeiro contato de um cliente novo.',
  },
  {
    valor: 'BALANCED' as const,
    titulo: 'Equilibrada',
    texto: 'Julgamento normal, ainda preferindo mostrar quando a confiança for baixa.',
  },
  {
    valor: 'AGGRESSIVE' as const,
    titulo: 'Agressiva',
    texto: 'Filtra mais e deixa a caixa limpa. Só use se você revisar os descartados.',
  },
];

const campo = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  marginTop: 4,
  fontFamily: 'inherit',
} as const;

const rotulo = { fontSize: 12, color: 'var(--muted)' } as const;

export function PerfilForm({ inicial, negocios }: { inicial: PerfilInicial; negocios: readonly string[] }) {
  const router = useRouter();
  const [estado, acao, enviando] = useActionState<SalvarPerfilResultado | null, FormData>(
    salvarPerfil.bind(null, inicial.connectionId),
    null,
  );

  const [negocio, setNegocio] = useState(inicial.businessName);
  const [calibracao, setCalibracao] = useState(inicial.calibration);
  const [urgentes, setUrgentes] = useState(inicial.urgentKeywords);

  /*
   * Depois de salvar, recarrega os dados do servidor.
   *
   * O React 19 RESETA o formulario quando a Server Action termina. Num campo
   * controlado isso zera o valor no DOM sem mudar o estado — e, como o
   * estado nao mudou, nenhuma renderizacao devolve o valor para a tela. O
   * select de negocio voltava para "— selecione —" com o dado ja gravado.
   *
   * `router.refresh()` traz as props novas do servidor, e a sincronizacao
   * abaixo as aplica ao estado. Recarregar a pagina inteira resolveria
   * tambem, mas jogaria fora o que estivesse sendo editado nos outros
   * perfis da mesma tela.
   */
  useEffect(() => {
    if (estado?.ok) router.refresh();
  }, [estado, router]);

  /*
   * Sincroniza o estado local quando o servidor manda valores novos.
   *
   * `useState(props)` so le a prop na PRIMEIRA renderizacao. Depois de
   * salvar, a Server Action revalida a rota e as props chegam atualizadas —
   * mas os campos controlados continuavam presos ao valor antigo e o select
   * de negocio voltava para "— selecione —". O dado estava gravado; a tela
   * e que dizia o contrario, o que e pior que nao salvar: mina a confianca
   * em tudo que a tela mostra.
   *
   * Atualizacao de estado durante a renderizacao, comparando com a prop
   * anterior: e o padrao recomendado pelo React para ajustar estado quando
   * a prop muda, e evita o efeito que piscaria o valor errado antes.
   */
  const [propsAnteriores, setPropsAnteriores] = useState({
    businessName: inicial.businessName,
    calibration: inicial.calibration,
    urgentKeywords: inicial.urgentKeywords,
  });

  if (
    propsAnteriores.businessName !== inicial.businessName ||
    propsAnteriores.calibration !== inicial.calibration ||
    propsAnteriores.urgentKeywords !== inicial.urgentKeywords
  ) {
    setPropsAnteriores({
      businessName: inicial.businessName,
      calibration: inicial.calibration,
      urgentKeywords: inicial.urgentKeywords,
    });
    setNegocio(inicial.businessName);
    setCalibracao(inicial.calibration);
    setUrgentes(inicial.urgentKeywords);
  }

  /**
   * Trocar o negócio aplica os defaults daquele contexto — mas só sobre
   * campos ainda vazios ou ainda não salvos. Sobrescrever o que o usuário
   * já escreveu seria hostil.
   */
  function aoTrocarNegocio(valor: string) {
    setNegocio(valor);
    if (!isBusinessContext(valor)) return;

    const padrao = BUSINESS_DEFAULTS[valor as BusinessContext];
    if (!inicial.configurado) {
      setCalibracao(padrao.calibration);
      if (!urgentes.trim() && padrao.urgentKeywords.length > 0) {
        setUrgentes(padrao.urgentKeywords.join('\n'));
      }
    }
  }

  const dica = isBusinessContext(negocio)
    ? BUSINESS_DEFAULTS[negocio as BusinessContext].objectiveHint
    : 'O que você não pode perder nesta caixa?';

  return (
    <form action={acao} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ponto" style={{ background: inicial.color }} />
        <strong style={{ fontSize: 14 }}>{inicial.accountEmail}</strong>
        {!inicial.configurado && (
          <span className="pill warn" style={{ marginLeft: 'auto' }}>
            sem perfil
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div>
          <label style={rotulo} htmlFor={`negocio-${inicial.connectionId}`}>
            Negócio
          </label>
          <select
            id={`negocio-${inicial.connectionId}`}
            name="businessName"
            value={negocio}
            onChange={(e) => aoTrocarNegocio(e.target.value)}
            style={campo}
          >
            <option value="">— selecione —</option>
            {negocios.map((contexto) => (
              <option key={contexto} value={contexto}>
                {contexto}
                {contexto === 'Brand.co' ? ' (palestras/treinamentos)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={rotulo} htmlFor={`papel-${inicial.connectionId}`}>
            Seu papel neste negócio
          </label>
          <input
            id={`papel-${inicial.connectionId}`}
            name="role"
            type="text"
            defaultValue={inicial.role}
            placeholder="ex.: sócio, diretor comercial"
            style={campo}
          />
        </div>
      </div>

      <div>
        <label style={rotulo} htmlFor={`objetivo-${inicial.connectionId}`}>
          Objetivo nesta caixa
        </label>
        <textarea
          id={`objetivo-${inicial.connectionId}`}
          name="objective"
          rows={2}
          defaultValue={inicial.objective}
          placeholder={dica}
          style={campo}
        />
        <p style={{ ...rotulo, marginTop: 4 }}>
          Escrito em texto livre — vai direto no prompt de triagem desta caixa.
        </p>
      </div>

      <div>
        <span style={rotulo}>Calibragem da triagem</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {CALIBRACOES.map((opcao) => (
            <label
              key={opcao.valor}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="calibration"
                value={opcao.valor}
                checked={calibracao === opcao.valor}
                onChange={() => setCalibracao(opcao.valor)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 13 }}>
                <strong>{opcao.titulo}</strong>
                <br />
                <span style={rotulo}>{opcao.texto}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <label style={rotulo} htmlFor={`vip-${inicial.connectionId}`}>
            Remetentes VIP
          </label>
          <textarea
            id={`vip-${inicial.connectionId}`}
            name="vipSenders"
            rows={3}
            defaultValue={inicial.vipSenders}
            placeholder={'cliente@grande.com\nempresaimportante.com'}
            style={campo}
          />
          <p style={{ ...rotulo, marginTop: 4 }}>
            Um por linha. E-mail completo ou domínio inteiro. Estes{' '}
            <strong>nunca são rebaixados nem escondidos</strong>, e não dependem do julgamento do
            modelo.
          </p>
        </div>

        <div>
          <label style={rotulo} htmlFor={`urgente-${inicial.connectionId}`}>
            Palavras que indicam urgência aqui
          </label>
          <textarea
            id={`urgente-${inicial.connectionId}`}
            name="urgentKeywords"
            rows={3}
            value={urgentes}
            onChange={(e) => setUrgentes(e.target.value)}
            placeholder={'contrato\nprazo'}
            style={campo}
          />
          <p style={{ ...rotulo, marginTop: 4 }}>
            Um por linha. O que é urgente neste negócio pode ser irrelevante em outro.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={enviando}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            cursor: enviando ? 'default' : 'pointer',
            fontSize: 13,
          }}
        >
          {enviando ? 'Salvando…' : 'Salvar perfil'}
        </button>
        {estado?.ok && (
          <span className="sub" style={{ color: 'var(--ok)' }}>
            Perfil salvo.
          </span>
        )}
        {estado?.erro && (
          <span className="sub" style={{ color: 'var(--crit)' }}>
            {estado.erro}
          </span>
        )}
      </div>
    </form>
  );
}
