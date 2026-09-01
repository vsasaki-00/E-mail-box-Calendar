/**
 * O que a DATABASE_URL diz, sem revelar credencial.
 *
 * Existe porque "trocar a string e redeployar" falhou em silêncio: o erro
 * continuava dizendo `connection limit: 1` e não havia como saber, de fora,
 * se a variável não tinha sido salva, se o deploy não pegou, ou se havia
 * duas entradas conflitantes no painel.
 *
 * Devolve SOMENTE os parâmetros da query e o host mascarado. Usuário, senha
 * e nome do banco nunca saem daqui — são exatamente o que não pode aparecer
 * numa tela.
 */
export interface ConfigDoBanco {
  parametros: string;
  hostResumido: string;
  alertaLimite: boolean;
}

export function lerConfigDoBanco(url = process.env.DATABASE_URL): ConfigDoBanco | null {
  if (!url?.trim()) return null;

  try {
    const parsed = new URL(url);
    const params = [...parsed.searchParams.entries()]
      .map(([chave, valor]) => `${chave}=${valor}`)
      .join(' · ');

    // Só o suficiente para distinguir transaction pooler (6543) de session
    // pooler (5432) e de conexão direta — sem expor o projeto.
    const partes = parsed.hostname.split('.');
    const hostResumido = `…${partes.slice(-3).join('.')}:${parsed.port || '5432'}`;

    return {
      parametros: params || '(nenhum)',
      hostResumido,
      // O valor que quebra este app: com uma conexão só, as consultas em
      // paralelo entram em fila e estouram o prazo.
      alertaLimite: parsed.searchParams.get('connection_limit') === '1',
    };
  } catch {
    return null;
  }
}
