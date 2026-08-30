import type { Provider } from '@prisma/client';
import type { Connector } from './types';
import { googleConnector } from './google';
import { microsoftConnector } from './microsoft';
import { appleConnector, imapCaldavConnector } from './imap-caldav';

/**
 * Ponto unico de resolucao provedor -> conector. Nenhum outro lugar do codigo
 * deve fazer switch por provedor: o nucleo pergunta as capacidades ao conector.
 */
const REGISTRY: Record<Provider, Connector> = {
  GOOGLE: googleConnector,
  MICROSOFT: microsoftConnector,
  APPLE: appleConnector,
  IMAP_CALDAV: imapCaldavConnector,
};

export function getConnector(provider: Provider): Connector {
  const connector = REGISTRY[provider];
  if (!connector) {
    throw new Error(`Nenhum conector registrado para o provedor "${provider}"`);
  }
  return connector;
}

export function allConnectors(): Connector[] {
  return Object.values(REGISTRY);
}
