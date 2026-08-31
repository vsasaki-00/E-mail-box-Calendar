'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { assinarSessao, COOKIE_SESSAO, DURACAO_SESSAO_MS } from '@/lib/session';
import { conferirSenha } from '@/lib/senha';

/**
 * Entrada e saída do Meridiano. Ver docs/09-deploy.md
 *
 * Roda no Node (o scrypt de `senha.ts` não existe no Edge), o que é o certo:
 * a conferência de senha é cara de propósito e não deveria estar no caminho
 * de toda requisição — só no login.
 */

export interface EstadoEntrada {
  erro?: string;
}

/**
 * Um destino só é aceito se for um caminho interno começando com `/` e sem
 * `//` na frente. Sem isso, `/entrar?de=https://outro.site` viraria um
 * redirecionamento aberto: o link parece o seu domínio e joga a pessoa em
 * outro lugar.
 */
function destinoSeguro(de: unknown): string {
  if (typeof de !== 'string') return '/';
  if (!de.startsWith('/') || de.startsWith('//')) return '/';
  return de;
}

export async function entrar(
  _anterior: EstadoEntrada,
  dados: FormData,
): Promise<EstadoEntrada> {
  const segredo = process.env.SESSION_SECRET;
  const hash = process.env.APP_PASSWORD_HASH;

  // Falta de configuração é erro de operação, não senha errada. Dizer
  // "senha incorreta" aqui mandaria você tentar de novo para sempre.
  if (!segredo || !hash) {
    return { erro: 'App sem SESSION_SECRET ou APP_PASSWORD_HASH configurados. Ver docs/09-deploy.md' };
  }

  const senha = dados.get('senha');
  if (typeof senha !== 'string' || senha.length === 0) {
    return { erro: 'Informe a senha.' };
  }

  if (!conferirSenha(senha, hash)) {
    // Uma mensagem só, sem distinguir causa: qualquer detalhe a mais ajuda
    // quem está adivinhando, e não ajuda você.
    return { erro: 'Senha incorreta.' };
  }

  const armazem = await cookies();
  armazem.set(COOKIE_SESSAO, await assinarSessao(segredo), {
    httpOnly: true,
    // Em produção é sempre HTTPS; no localhost o cookie precisa funcionar
    // sem TLS, senão não dá para entrar na própria máquina.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(DURACAO_SESSAO_MS / 1000),
  });

  redirect(destinoSeguro(dados.get('de')));
}

export async function sair(): Promise<void> {
  const armazem = await cookies();
  armazem.delete(COOKIE_SESSAO);
  redirect('/entrar');
}
