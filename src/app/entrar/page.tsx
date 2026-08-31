import { MarcaMeridiano } from '../icons';
import { FormularioEntrada } from './form';

/**
 * Tela de entrada. Ver docs/09-deploy.md
 *
 * É a única rota pública além dos callbacks de OAuth e do cron. Tudo o mais
 * passa pelo middleware.
 */

export const metadata = { title: 'Entrar · Meridiano' };

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ de?: string }>;
}) {
  const { de } = await searchParams;
  const destino = typeof de === 'string' && de.startsWith('/') && !de.startsWith('//') ? de : '/';

  return (
    <main className="entrar">
      <div className="entrar-cartao">
        <div className="entrar-marca">
          <MarcaMeridiano size={44} />
          <div>
            <h1 className="entrar-nome">Meridiano</h1>
            <p className="sub">e-mail · agenda · uma referência</p>
          </div>
        </div>

        <FormularioEntrada de={destino} />

        <p className="entrar-nota">
          Uma senha só, sua. Ela não fica no banco — o servidor guarda apenas o
          hash, em variável de ambiente.
        </p>
      </div>
    </main>
  );
}
