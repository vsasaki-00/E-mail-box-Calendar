/**
 * Ícones do Meridiano.
 *
 * SVG inline, desenhados à mão, sem biblioteca externa: o app roda na
 * máquina do usuário e não deve depender de CDN nem de pacote de ícones
 * para renderizar uma tela. Todos herdam `currentColor` e o traço fino
 * combina com a linguagem de carta náutica.
 */

interface IconeProps {
  size?: number;
  className?: string;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

/**
 * A marca: um globo com o meridiano em destaque.
 *
 * O traço vertical central é a linha de referência — o mesmo elemento que
 * aparece na lateral de cada cartão.
 */
export function MarcaMeridiano({ size = 30 }: IconeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.3" opacity="0.28" />
      {/* Paralelos */}
      <path
        d="M3.6 11.5h24.8M3.6 20.5h24.8"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.22"
        strokeLinecap="round"
      />
      {/* Meridianos laterais, em elipse */}
      <ellipse cx="16" cy="16" rx="6.6" ry="13" stroke="currentColor" strokeWidth="1.1" opacity="0.22" />
      {/* O meridiano principal: vertical, cheio, na cor de destaque */}
      <path d="M16 1.6v28.8" stroke="var(--meridiano)" strokeWidth="2.1" strokeLinecap="round" />
      {/* Zênite: o ponto do sol no alto */}
      <circle cx="16" cy="7.4" r="2.5" fill="var(--zenite)" />
    </svg>
  );
}

export function IconeTorre({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M12 3v18" />
      <path d="M5 9.5 12 3l7 6.5" />
      <path d="M7 21h10" />
      <circle cx="12" cy="7.5" r="1.4" />
    </svg>
  );
}

export function IconeEmail({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </svg>
  );
}

export function IconeCalendario({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <path d="M3 9.5h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconeDinheiro({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v5M18 9.5v5" />
    </svg>
  );
}

export function IconeRascunho({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="M14.5 5.5l3 3" />
    </svg>
  );
}

export function IconeBusca({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </svg>
  );
}

export function IconeTriagem({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function IconeAcoes({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />
    </svg>
  );
}

export function IconeVoz({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

export function IconePerfis({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconeConexoes({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <circle cx="12" cy="18" r="2.6" />
      <path d="M7.6 8.1 10.6 15.7M16.4 8.1 13.4 15.7M8.6 6h6.8" />
    </svg>
  );
}

export function IconeConflito({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M12 3.5 21.5 20H2.5L12 3.5Z" />
      <path d="M12 10v4.5M12 17.3v.2" />
    </svg>
  );
}

export function IconeRelogio({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function IconeSaude({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <path d="M2.5 12h4l2.5-6 4 12 2.5-6h4" />
    </svg>
  );
}

/** Bússola — usada onde a ideia é "onde estou / o que importa agora". */
export function IconeBussola({ size = 15 }: IconeProps) {
  return (
    <svg {...base(size)} aria-hidden>
      <circle cx="12" cy="12" r="8.7" />
      <path d="m15.2 8.8-2 4.4-4.4 2 2-4.4 4.4-2Z" />
    </svg>
  );
}
