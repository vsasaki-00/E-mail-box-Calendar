import {
  IconeAcoes,
  IconeBusca,
  IconeCalendario,
  IconeConexoes,
  IconeDinheiro,
  IconePerfis,
  IconeRascunho,
  IconeTorre,
  IconeTriagem,
  IconeVoz,
  MarcaMeridiano,
} from './icons';
import { sair } from './entrar/actions';

/**
 * Barra de navegação do Meridiano.
 *
 * Server Component: a navegação não tem estado, e o item ativo é decidido
 * por quem renderiza a página — sem JavaScript no cliente para isso.
 */

const ITENS = [
  { href: '/', rotulo: 'Torre', Icone: IconeTorre },
  { href: '/triagem', rotulo: 'Triagem', Icone: IconeTriagem },
  { href: '/agenda', rotulo: 'Agenda', Icone: IconeCalendario },
  { href: '/financeiro', rotulo: 'Financeiro', Icone: IconeDinheiro },
  { href: '/rascunhos', rotulo: 'Rascunhos', Icone: IconeRascunho },
  { href: '/acoes', rotulo: 'Ações', Icone: IconeAcoes },
  { href: '/busca', rotulo: 'Busca', Icone: IconeBusca },
  { href: '/voz', rotulo: 'Voz', Icone: IconeVoz },
  { href: '/perfis', rotulo: 'Perfis', Icone: IconePerfis },
  { href: '/conexoes', rotulo: 'Conexões', Icone: IconeConexoes },
] as const;

/**
 * Seções que têm sub-páginas. A barra principal marca a seção; uma segunda
 * linha, só quando você está nela, mostra as sub-páginas.
 */
const SUBMENUS: Record<string, { href: string; rotulo: string }[]> = {
  '/financeiro': [
    { href: '/financeiro', rotulo: 'Cobranças' },
    { href: '/financeiro/extrato', rotulo: 'Extrato' },
  ],
};

/** A seção principal de uma rota: /financeiro/extrato → /financeiro. */
function secaoDe(atual: string | undefined): string | undefined {
  if (!atual) return undefined;
  return Object.keys(SUBMENUS).find((base) => atual === base || atual.startsWith(`${base}/`)) ?? atual;
}

export function Nav({ atual, direita }: { atual?: string; direita?: React.ReactNode }) {
  const secao = secaoDe(atual);
  const submenu = secao ? SUBMENUS[secao] : undefined;

  return (
    <div className="barra">
      <a href="/" className="marca">
        <MarcaMeridiano />
        <span>
          <span className="marca-nome">Meridiano</span>
          <span className="marca-sub">e-mail · agenda · uma referência</span>
        </span>
      </a>

      <nav className="nav" aria-label="Seções">
        {ITENS.map(({ href, rotulo, Icone }) => (
          <a key={href} href={href} className={secao === href ? 'ativo' : undefined}>
            <Icone size={14} />
            {rotulo}
          </a>
        ))}
      </nav>

      {submenu && (
        <nav className="subnav" aria-label="Sub-seções">
          {submenu.map(({ href, rotulo }) => (
            <a key={href} href={href} className={atual === href ? 'ativo' : undefined}>
              {rotulo}
            </a>
          ))}
        </nav>
      )}

      {direita ? <div className="sub">{direita}</div> : null}

      {/* Sem senha cadastrada não há sessão para encerrar, e o botão levaria
          a uma tela de entrada onde nenhuma senha funciona. Sair é um POST, e
          não um link: um GET que encerra sessão é disparado por qualquer
          <img> dentro de um e-mail. */}
      {process.env.APP_PASSWORD_HASH ? (
        <form action={sair}>
          <button type="submit" className="sair">
            Sair
          </button>
        </form>
      ) : null}
    </div>
  );
}
