#!/usr/bin/env bash
#
# Instalacao em um comando. Ver README.md
#
# Idempotente de proposito: rodar de novo nao quebra nada e nao sobrescreve
# o que ja existe. A regra mais importante esta em `preparar_env`: um .env
# existente NUNCA e tocado — sobrescrever a MASTER_ENCRYPTION_KEY tornaria
# ilegiveis as credenciais ja guardadas das suas caixas.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

verde() { printf '\033[32m%s\033[0m\n' "$1"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$1"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
passo() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# Pre-requisitos
# ---------------------------------------------------------------------------
faltou=0

exigir() {
  if ! command -v "$1" >/dev/null 2>&1; then
    vermelho "✗ falta: $1"
    printf '  instale com: %s\n' "$2"
    faltou=1
  else
    verde "✓ $1"
  fi
}

passo "Conferindo o que já existe na máquina"

exigir node "brew install node"

if command -v node >/dev/null 2>&1; then
  versao_node="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$versao_node" -lt 20 ]; then
    vermelho "✗ Node $versao_node é antigo demais; precisa de 20 ou mais"
    printf '  atualize com: brew upgrade node\n'
    faltou=1
  fi
fi

# O pnpm e o unico pre-requisito que da para resolver sozinho: o Node ja
# traz o `corepack`, que sabe instala-lo. Exigir que o usuario resolva algo
# que a maquina dele consegue resolver e atrito a toa.
if command -v pnpm >/dev/null 2>&1; then
  verde "✓ pnpm"
elif [ "$faltou" -eq 0 ] && command -v corepack >/dev/null 2>&1; then
  amarelo "• pnpm não encontrado — habilitando pelo corepack (vem com o Node)"
  if corepack enable pnpm >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
    verde "✓ pnpm instalado"
  else
    vermelho "✗ não consegui habilitar o pnpm automaticamente"
    printf '  instale com: brew install pnpm\n'
    printf '  (ou, se o corepack pediu permissão: sudo corepack enable pnpm)\n'
    faltou=1
  fi
else
  vermelho "✗ falta: pnpm"
  printf '  instale com: brew install pnpm\n'
  faltou=1
fi

if [ "$faltou" -eq 1 ]; then
  printf '\n'
  vermelho "Instale o que falta acima e rode de novo:"
  printf '  bash scripts/setup.sh\n'
  exit 1
fi

# ---------------------------------------------------------------------------
# .env — nunca sobrescrito
# ---------------------------------------------------------------------------
passo "Configuração (.env)"

if [ -f .env ]; then
  amarelo "• .env já existe — não vou tocar nele."
  amarelo "  (sobrescrever a chave mestra tornaria ilegíveis as credenciais já salvas)"
else
  cp .env.example .env
  chave="$(openssl rand -base64 32)"
  sessao="$(openssl rand -base64 32)"
  cron="$(openssl rand -hex 24)"

  # `|` como separador porque a chave base64 contem `/`.
  trocar() {
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^$1=.*|$1=\"$2\"|" .env
    else
      # BSD sed, que e o do macOS, exige argumento no -i.
      sed -i '' "s|^$1=.*|$1=\"$2\"|" .env
    fi
  }

  trocar MASTER_ENCRYPTION_KEY "$chave"
  # Segredos do portao de entrada. O HASH DA SENHA fica de fora de proposito:
  # o script nao inventa senha para voce. Rode `pnpm gerar:senha`.
  trocar SESSION_SECRET "$sessao"
  trocar CRON_SECRET "$cron"

  verde "✓ .env criado com chave mestra e segredos de sessão novos"
fi

# ---------------------------------------------------------------------------
# Dependencias
# ---------------------------------------------------------------------------
passo "Instalando dependências"
if ! pnpm install --silent; then
  vermelho "✗ a instalação falhou"
  printf '\n  Se a mensagem acima foi ERR_PNPM_IGNORED_BUILDS, o pnpm bloqueou\n'
  printf '  os scripts que este projeto precisa. Autorize uma vez:\n\n'
  printf '    pnpm approve-builds\n\n'
  printf '  (marque todos com "a", confirme com Enter, e rode este script de novo)\n'
  exit 1
fi
verde "✓ dependências instaladas"

# Rede de seguranca: versoes recentes do pnpm BLOQUEIAM build scripts por
# padrao, e o `prisma generate` do postinstall e um deles. Quando isso
# acontece, o app so quebra bem depois, com um erro que nao aponta para a
# causa. Gerar aqui de forma explicita torna o resultado o mesmo em
# qualquer versao — e e barato o suficiente para rodar sempre.
if ! pnpm exec prisma generate >/dev/null 2>&1; then
  vermelho "✗ falhou ao gerar o cliente do Prisma"
  printf '  rode para ver o erro:  pnpm exec prisma generate\n'
  exit 1
fi
verde "✓ cliente do banco gerado"

# ---------------------------------------------------------------------------
# Banco
# ---------------------------------------------------------------------------
passo "Banco de dados"

url_do_env="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
porta="$(printf '%s' "$url_do_env" | sed -n 's|.*:\([0-9]\{2,5\}\)/.*|\1|p')"
porta="${porta:-5432}"

banco_no_ar() {
  # `pg_isready` nem sempre existe; testar a porta funciona em qualquer Mac.
  node -e "
    const net = require('net');
    const s = net.connect($porta, '127.0.0.1');
    s.on('connect', () => { s.end(); process.exit(0); });
    s.on('error', () => process.exit(1));
    setTimeout(() => process.exit(1), 1500);
  " 2>/dev/null
}

# Le usuario/senha/banco da DATABASE_URL. Node esta garantido a esta altura,
# e parsear URL com sed daria errado no primeiro caractere especial da senha.
credenciais() {
  node -e "
    const u = new URL(process.env.URL_DO_ENV);
    process.stdout.write([
      decodeURIComponent(u.username),
      decodeURIComponent(u.password),
      u.pathname.replace(/^\//, ''),
    ].join('\n'));
  " 2>/dev/null
}

# O Postgres esta no ar E aceita as credenciais que o app usa?
#
# Best-effort de proposito: so da para checar quando ha `psql` na maquina.
# Sem ele (caso tipico do Docker, que ja cria as credenciais certas),
# assumimos que esta bom — e o `db:push` logo em seguida da a resposta real,
# com uma mensagem do Prisma que diz exatamente o que houve.
app_conecta() {
  command -v psql >/dev/null 2>&1 || return 0
  # Sem a query string: o Prisma usa `?schema=public`, e o psql recusa esse
  # parametro ("invalid URI query parameter"). Passar a URL crua faria a
  # checagem falhar SEMPRE, e o script tentaria recriar um banco que ja
  # existe a cada execucao.
  psql "${url_do_env%%\?*}" -c 'SELECT 1' >/dev/null 2>&1
}

# Cria o papel e o banco que o app espera, num Postgres instalado pelo brew.
#
# Existe para o caminho SEM Docker ser tao curto quanto o com: o
# docker-compose ja cria `torre/torre/torre`, e sem isto o usuario teria de
# fazer na mao o que a maquina faz sozinha.
preparar_postgres_local() {
  command -v psql >/dev/null 2>&1 || return 1

  URL_DO_ENV="$url_do_env"
  export URL_DO_ENV
  local dados usuario senha banco
  dados="$(credenciais)" || return 1
  usuario="$(printf '%s' "$dados" | sed -n 1p)"
  senha="$(printf '%s' "$dados" | sed -n 2p)"
  banco="$(printf '%s' "$dados" | sed -n 3p)"

  amarelo "• criando o papel \"$usuario\" e o banco \"$banco\" no seu Postgres"

  # Quem e superusuario varia com a instalacao: no Postgres do Homebrew e o
  # seu proprio usuario do macOS; em outras, e `postgres`. Tenta as duas em
  # vez de assumir uma — assumir seria acertar so em metade das maquinas.
  local conectou=1
  for alvo in "-d postgres" "-U postgres -d postgres"; do
    # shellcheck disable=SC2086
    if psql $alvo -c 'SELECT 1' >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      psql $alvo -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
CREATE ROLE "$usuario" WITH LOGIN PASSWORD '$senha' CREATEDB;
CREATE DATABASE "$banco" OWNER "$usuario";
SQL
      conectou=0
      break
    fi
  done
  [ "$conectou" -eq 0 ] || return 1

  app_conecta
}

if banco_no_ar; then
  verde "✓ já tem um Postgres respondendo na porta $porta"
  if ! app_conecta; then
    amarelo "• mas ele não aceita as credenciais que o app usa"
    if preparar_postgres_local; then
      verde "✓ papel e banco criados"
    else
      vermelho "✗ não consegui preparar o banco automaticamente"
      printf '\n  Crie à mão (ajuste os nomes se você mudou a DATABASE_URL):\n\n'
      printf '    psql -d postgres -c "CREATE ROLE torre WITH LOGIN PASSWORD '"'"'torre'"'"' CREATEDB;"\n'
      printf '    psql -d postgres -c "CREATE DATABASE torre OWNER torre;"\n\n'
      printf '  Ou use o Docker Desktop, que já cria tudo: abra-o e rode de novo.\n'
      exit 1
    fi
  fi
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  printf '  subindo o Postgres via Docker...\n'
  pnpm db:up
  for _ in $(seq 1 30); do
    banco_no_ar && break
    sleep 1
  done
  if banco_no_ar; then
    verde "✓ Postgres no ar"
  else
    vermelho "✗ o Postgres subiu mas não respondeu a tempo"
    printf '  veja o que houve com: docker compose logs postgres\n'
    exit 1
  fi
else
  vermelho "✗ nenhum Postgres respondendo na porta $porta, e o Docker não está disponível"
  printf '\n  Duas saídas, e a segunda é mais leve:\n\n'
  printf '  1. abrir o Docker Desktop (open -a Docker) e rodar de novo\n\n'
  printf '  2. instalar só o Postgres, sem Docker:\n'
  printf '       brew install postgresql@16\n'
  printf '       brew services start postgresql@16\n'
  printf '       bash scripts/setup.sh\n'
  printf '     (o papel e o banco este script cria sozinho)\n'
  exit 1
fi

passo "Criando as tabelas"
pnpm db:push >/dev/null
verde "✓ esquema aplicado"

# ---------------------------------------------------------------------------
# Dados de demonstracao — so se o banco estiver vazio
# ---------------------------------------------------------------------------
if [ "${SEED:-1}" = "1" ]; then
  ja_tem="$(node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.connection.count().then((n) => { console.log(n); return p.\$disconnect(); }).catch(() => console.log('erro'));
  " 2>/dev/null || echo erro)"

  if [ "$ja_tem" = "0" ]; then
    passo "Populando dados de demonstração"
    pnpm db:seed >/dev/null
    verde "✓ dados de demonstração criados"
    amarelo "  (o mesmo convite em duas contas, um conflito real entre calendários,"
    amarelo "   uma conta atrasada e uma precisando reautenticar)"
  else
    amarelo "• já há contas no banco — não vou popular demonstração por cima"
  fi
fi

# ---------------------------------------------------------------------------
# Pronto
# ---------------------------------------------------------------------------
printf '\n'
verde "════════════════════════════════════════════════════"
verde " Pronto. Agora rode:"
printf '\n   \033[1mpnpm dev\033[0m\n\n'
verde " E abra:"
printf '   Torre de Comando   http://localhost:3000\n'
printf '   Conectar caixas    http://localhost:3000/conexoes\n'
verde "════════════════════════════════════════════════════"
printf '\n'
amarelo "Para conectar uma conta de verdade, o caminho mais curto é o iCloud:"
amarelo "não precisa criar credencial em console nenhum, só uma senha de app"
amarelo "gerada em appleid.apple.com. Google e Microsoft: veja o README."
printf '\n'
