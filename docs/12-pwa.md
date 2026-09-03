# 12 — Instalar no celular (Fase 6)

O Meridiano vira ícone na tela inicial do celular sem virar app de loja:
mesma URL, mesma sessão, mesmo código. Nada é reescrito para mobile — o que
muda é a moldura.

## A decisão que define este documento

**O service worker não guarda nada do que você lê.**

O padrão de PWA é cachear páginas para abrir offline, e é isso que quase
todo tutorial manda fazer. Aqui isso seria gravar e-mail de seis negócios no
disco do aparelho, fora do controle da sessão: num celular perdido ou
emprestado, o cache abriria **sem senha**. O app inteiro é construído em
cima de não fazer isso — segredos cifrados fora do banco, corpo de e-mail
buscado sob demanda, nada de e-mail em log ([`04-seguranca.md`](04-seguranca.md)) —
e o service worker não vai ser a porta dos fundos.

Então `public/sw.js` faz só duas coisas:

1. **existe** — é o requisito para o navegador oferecer "instalar";
2. quando a rede falha **numa navegação**, mostra `offline.html` em vez do
   erro do navegador.

O `fetch` sai na primeira linha quando `request.mode !== 'navigate'`. API e
estáticos seguem o caminho normal: interceptá-los só criaria oportunidade de
guardar o que não deve.

O CSS e o JS do próprio app continuam cacheados pelo navegador normalmente
(`_next/static` é imutável e versionado). Isso é cache de **código**, não de
conteúdo, e não vaza nada.

A página offline diz isso com todas as letras, em vez de fingir que algo
deu errado: "O Meridiano não guarda seus e-mails no aparelho — por
segurança. Sem rede, não há o que mostrar."

## O que compõe o PWA

| arquivo | papel |
| --- | --- |
| `src/app/manifest.ts` | nome, cores, ícones, `display: standalone` |
| `public/sw.js` | o worker que não cacheia conteúdo |
| `public/offline.html` | a única coisa que ele guarda |
| `public/icone-192.png`, `icone-512.png` | ícones rasterizados de `icon.svg` |
| `src/app/sw-registro.tsx` | registra o worker; falha em silêncio |
| `src/app/layout.tsx` | `viewport` e `appleWebApp` |

Os PNG saem do mesmo `src/app/icon.svg` — a marca do dono, com o globo
cinza, o meridiano teal atravessando a esfera e o zênite âmbar. O de 512 tem
**12% de folga** nas bordas porque é declarado `maskable`: o Android recorta
no formato dele (círculo, squircle, gota), e sem folga o recorte comeria a
linha que dá nome ao app.

Dois detalhes de moldura que só aparecem no aparelho:

- `viewportFit: 'cover'` impede a barra de gestos do iPhone de comer a
  última linha da lista quando o app está instalado;
- `appleWebApp.title` é o que fica escrito embaixo do ícone no iOS — sem
  ele, o iPhone usa o `<title>` da página, que muda de tela para tela.

O registro (`sw-registro.tsx`) **falha em silêncio** de propósito: um app
que funciona inteiro sem service worker não deve incomodar o dono porque o
registro não pegou.

## O portão e os cinco arquivos que passam

O `middleware.ts` nega por padrão: qualquer rota sem sessão vira
redirecionamento para `/entrar`. Isso já tinha mordido uma vez — `icon.svg`
é pedido pela **tela de login**, onde por definição ainda não há sessão, e
a aba ficava sem ícone justamente na primeira tela que você vê.

O PWA acrescenta a mesma classe de problema em cinco arquivos, cada um por
um motivo diferente:

| arquivo | por que precisa passar |
| --- | --- |
| `manifest.webmanifest` | o navegador o lê às vezes **sem enviar o cookie** |
| `sw.js` | um service worker que responde 307 **nunca instala** — e sem ele o navegador não oferece "instalar" |
| `offline.html` | precisa abrir justamente quando não há rede para validar sessão nenhuma |
| `icone-192.png`, `icone-512.png` | mesmo caso do `icon.svg` |

Nenhum deles carrega conteúdo privado: são ícone, código e uma página que
diz "sem conexão".

Uma exclusão de matcher é a coisa mais fácil de ampliar demais sem
perceber. Por isso foi verificada **com o portão ativo**, não com o app em
modo aberto:

```
=== portão ATIVO? (deve redirecionar para /entrar) ===
  /financeiro            307 -> /entrar?de=%2Ffinanceiro
=== e o PWA passa? ===
  /manifest.webmanifest  200  application/manifest+json
  /sw.js                 200  application/javascript
  /offline.html          200  text/html
  /icone-192.png         200  image/png
  /icone-512.png         200  image/png
  /icon.svg              200  image/svg+xml
```

A linha de cima é a que importa: prova que a exclusão não abriu o app.

## Instalar

- **Android/Chrome**: abrir o app → menu → "Instalar app" (ou o aviso que o
  próprio Chrome oferece).
- **iPhone/Safari**: abrir o app → compartilhar → "Adicionar à Tela de
  Início". O iOS não oferece sozinho; o passo é manual e sempre foi.

Depois de instalado é a mesma sessão do navegador — a senha é pedida uma
vez, como no desktop.

## O que isto não é

- **Não é offline.** É o oposto: a decisão consciente de não guardar nada.
- **Não é push.** Notificação push é o outro item da Fase 6 e ainda não
  existe; o push nativo (Gmail watch + Pub/Sub, Graph subscriptions) depende
  de configuração externa, como o Twilio.
- **Não é app de loja.** Não há build nativo, App Store nem Play Store.
