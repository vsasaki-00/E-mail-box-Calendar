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
  # `|` como separador porque a chave base64 contem `/`.
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^MASTER_ENCRYPTION_KEY=.*|MASTER_ENCRYPTION_KEY=\"$chave\"|" .env
  else
    # BSD sed, que e o do macOS, exige argumento no -i.
    sed -i '' "s|^MASTER_ENCRYPTION_KEY=.*|MASTER_ENCRYPTION_KEY=\"$chave\"|" .env
  fi
  verde "✓ .env criado com uma chave mestra nova"
fi

# ---------------------------------------------------------------------------
# Dependencias
# ---------------------------------------------------------------------------
passo "Instalando dependências"
pnpm install --silent
verde "✓ dependências instaladas"

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

if banco_no_ar; then
  verde "✓ já tem um Postgres respondendo na porta $porta"
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
  printf '\n  Duas saídas:\n'
  printf '  1. abra o Docker Desktop e rode de novo: pnpm setup\n'
  printf '  2. ou instale o Postgres direto:  brew install postgresql@16 && brew services start postgresql@16\n'
  printf '     (nesse caso, ajuste DATABASE_URL no .env para o seu usuário)\n'
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
