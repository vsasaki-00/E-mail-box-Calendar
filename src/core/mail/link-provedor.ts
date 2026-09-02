/**
 * Link para abrir a mensagem no webmail do provedor.
 *
 * Complementa a leitura dentro do app: para responder, encaminhar ou ver
 * anexo, o lugar certo ainda e o provedor. O link leva DIRETO a mensagem,
 * na conta certa — sem isso e "abra o Gmail e procure", que nao e link.
 */

const DOMINIOS_MICROSOFT_PESSOAL = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];

export interface LinkProvedor {
  url: string;
  rotulo: string;
}

export function linkNoProvedor(entrada: {
  provider: string;
  accountEmail: string;
  providerId: string;
}): LinkProvedor | undefined {
  const { provider, accountEmail, providerId } = entrada;
  if (!providerId) return undefined;

  switch (provider) {
    case 'GOOGLE':
      // `authuser=<email>` escolhe a conta quando ha varias logadas; `#all/<id>`
      // abre a mensagem pelo id da API, que e o mesmo id da URL do Gmail.
      return {
        url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(accountEmail)}#all/${encodeURIComponent(providerId)}`,
        rotulo: 'abrir no Gmail',
      };

    case 'MICROSOFT': {
      const dominio = accountEmail.split('@')[1]?.toLowerCase() ?? '';
      const pessoal = DOMINIOS_MICROSOFT_PESSOAL.some(
        (d) => dominio === d || dominio.endsWith(`.${d}`),
      );
      // Conta pessoal e conta corporativa vivem em hosts diferentes; o
      // deeplink e o mesmo formato nos dois.
      const base = pessoal
        ? 'https://outlook.live.com/mail/0/deeplink/read/'
        : 'https://outlook.office.com/mail/deeplink/read/';
      return { url: `${base}${encodeURIComponent(providerId)}`, rotulo: 'abrir no Outlook' };
    }

    default:
      // iCloud e IMAP generico nao tem URL estavel por mensagem.
      return undefined;
  }
}
