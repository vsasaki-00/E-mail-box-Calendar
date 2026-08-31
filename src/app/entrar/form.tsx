'use client';

import { useActionState } from 'react';
import { entrar, type EstadoEntrada } from './actions';

/** Formulário da tela de entrada. Ver docs/09-deploy.md */

export function FormularioEntrada({ de }: { de: string }) {
  const [estado, acao, pendente] = useActionState<EstadoEntrada, FormData>(entrar, {});

  return (
    <form action={acao} className="entrar-form">
      <input type="hidden" name="de" value={de} />

      <label className="sub" htmlFor="senha">
        Senha
      </label>
      <input
        id="senha"
        name="senha"
        type="password"
        autoComplete="current-password"
        // O campo recebe o foco sozinho: é a única coisa a fazer nesta tela.
        autoFocus
        required
        className="entrar-campo"
      />

      <button type="submit" className="entrar-botao" disabled={pendente}>
        {pendente ? 'Conferindo…' : 'Entrar'}
      </button>

      {estado.erro ? (
        <p className="entrar-erro" role="alert">
          {estado.erro}
        </p>
      ) : null}
    </form>
  );
}
