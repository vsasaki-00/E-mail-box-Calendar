'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';

/**
 * Autorização do provedor em popup.
 *
 * Antes, cada botão levava a página inteira para o Google. Com seis caixas
 * para reconectar isso significa sair e voltar seis vezes, perdendo a lista
 * do que ainda falta a cada ida. O popup mantém a tela no lugar.
 *
 * Três coisas precisam funcionar juntas para isso não virar um estorvo:
 *
 * 1. A janela precisa FECHAR sozinha ao terminar — senão você fica com o app
 *    inteiro espremido num quadradinho. Quem fecha é `FecharSePopup`, na
 *    volta do callback.
 * 2. Popup bloqueado não pode virar um botão morto: cai para a navegação
 *    normal, que sempre funcionou.
 * 3. A página de trás precisa se atualizar quando a janela fecha, inclusive
 *    quando você fecha no meio. Por isso o acompanhamento é pelo
 *    fechamento, e não por uma mensagem que talvez nunca chegue.
 */

const LARGURA = 520;
const ALTURA = 700;

export function BotaoAutorizar({
  href,
  children,
  style,
  title,
}: {
  href: string;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  function abrir() {
    // `popup=1` volta no redirecionamento do callback e diz à página que ela
    // está dentro da janelinha, e deve se fechar.
    const url = `${href}${href.includes('?') ? '&' : '?'}popup=1`;

    const esquerda = Math.max(0, window.screenX + (window.outerWidth - LARGURA) / 2);
    const topo = Math.max(0, window.screenY + (window.outerHeight - ALTURA) / 3);

    const janela = window.open(
      url,
      'meridiano_autorizacao',
      `width=${LARGURA},height=${ALTURA},left=${Math.round(esquerda)},top=${Math.round(topo)}`,
    );

    // Bloqueado pelo navegador: segue pelo caminho de sempre, em vez de não
    // fazer nada.
    if (!janela) {
      window.location.href = href;
      return;
    }

    janela.focus();

    // Acompanha pelo FECHAMENTO da janela. Uma mensagem do popup só chegaria
    // no caminho feliz; fechar no meio da autorização também precisa
    // devolver a tela de trás ao estado real.
    const timer = window.setInterval(() => {
      if (!janela.closed) return;
      window.clearInterval(timer);
      window.location.reload();
    }, 600);
  }

  return (
    <button type="button" onClick={abrir} style={style} title={title}>
      {children}
    </button>
  );
}

/**
 * Fecha a janelinha quando o fluxo termina, e atualiza a página de trás.
 *
 * Renderizado só quando a URL traz `popup=1`. A checagem de `window.opener`
 * evita fechar a aba de alguém que chegou aqui por um link solto com esse
 * parâmetro.
 */
export function FecharSePopup() {
  useEffect(() => {
    if (!window.opener || window.opener.closed) return;
    try {
      window.opener.location.reload();
    } catch {
      // Origem diferente: o `setInterval` do abridor cuida disso ao ver a
      // janela fechar.
    }
    window.close();
  }, []);

  return (
    <p className="sub" style={{ padding: 24, textAlign: 'center' }}>
      Conta autorizada. Pode fechar esta janela.
    </p>
  );
}
