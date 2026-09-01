import { describe, expect, it } from 'vitest';
import { lerConfigDoBanco } from './db-config';

/**
 * O que esta funcao mostra numa TELA — por isso o que ela NAO mostra e a
 * parte mais importante do teste.
 */
describe('configuracao do banco exibida na tela', () => {
  const url =
    'postgresql://postgres.abc123:SenhaSuperSecreta@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5&pool_timeout=20';

  it('nunca revela usuario, senha nem nome do banco', () => {
    const config = lerConfigDoBanco(url)!;
    const tudo = `${config.parametros} ${config.hostResumido}`;
    expect(tudo).not.toContain('SenhaSuperSecreta');
    expect(tudo).not.toContain('postgres.abc123');
    // Nem o subdominio do projeto, que identifica a instalacao.
    expect(tudo).not.toContain('aws-0');
  });

  it('mostra a porta, que distingue transaction de session pooler', () => {
    expect(lerConfigDoBanco(url)!.hostResumido).toContain('6543');
  });

  it('mostra os parametros, que sao o que se precisa conferir', () => {
    expect(lerConfigDoBanco(url)!.parametros).toContain('connection_limit=5');
  });

  it('acusa connection_limit=1, o valor que trava o app', () => {
    const comUm = url.replace('connection_limit=5', 'connection_limit=1');
    expect(lerConfigDoBanco(comUm)!.alertaLimite).toBe(true);
    expect(lerConfigDoBanco(url)!.alertaLimite).toBe(false);
  });

  it('nao quebra sem URL ou com URL invalida', () => {
    expect(lerConfigDoBanco(undefined)).toBeNull();
    expect(lerConfigDoBanco('')).toBeNull();
    expect(lerConfigDoBanco('nao-e-uma-url')).toBeNull();
  });
});
