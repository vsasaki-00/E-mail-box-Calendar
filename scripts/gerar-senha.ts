import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { gerarHashDeSenha } from '../src/lib/senha';

/**
 * Gera as três variáveis de ambiente do portão de entrada.
 * Rodar com:  pnpm gerar:senha
 *
 * A senha é lida da entrada padrão, não de um argumento de linha de comando:
 * argumento fica no histórico do shell e aparece em `ps` para outros
 * processos da máquina.
 */

function perguntarSenha(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Escolha a senha do Meridiano: ', (resposta) => {
      rl.close();
      resolve(resposta);
    });
  });
}

async function principal(): Promise<void> {
  const senha = (await perguntarSenha()).trim();

  if (senha.length < 12) {
    // Doze não é cerimônia: a URL da Vercel é pública, e um portão com senha
    // curta é um portão que qualquer um abre por tentativa.
    console.error('\nSenha curta demais. Use pelo menos 12 caracteres.');
    process.exit(1);
  }

  console.log('\nCole estas linhas no .env (local) e nas Environment Variables da Vercel:\n');
  console.log(`APP_PASSWORD_HASH="${gerarHashDeSenha(senha)}"`);
  console.log(`SESSION_SECRET="${randomBytes(32).toString('base64')}"`);
  console.log(`CRON_SECRET="${randomBytes(24).toString('base64url')}"`);
  console.log('\nA senha em si não é gravada em lugar nenhum. Guarde-a você.');
}

void principal();
