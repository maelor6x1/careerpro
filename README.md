# CareerPro ⚽

Simulador de carreira de jogador de futebol no navegador, inspirado no Modo Carreira Jogador do EA Sports FC. HTML, CSS e JavaScript puro (ES6+), sem frameworks e sem build step.

## Rodando localmente

Não precisa de instalação nem servidor — é só abrir o `index.html` no navegador.

Se preferir servir localmente (recomendado para evitar bloqueios de `fetch`/imagens em `file://` em alguns navegadores):

```bash
npx serve .
# ou
python3 -m http.server 8080
```

## Deploy na Vercel

Este é um site estático puro, então não precisa de build command nem output directory especiais.

1. Suba este repositório para o GitHub.
2. Na Vercel, clique em **Add New → Project** e importe o repositório.
3. Em **Framework Preset**, escolha **Other**.
4. Deixe **Build Command** e **Output Directory** em branco (ou `Output Directory: .`).
5. Deploy.

O `vercel.json` incluído já configura isso, então na maioria dos casos a Vercel detecta tudo sozinha.

## Estrutura do projeto

```
/index.html
/css/style.css
/js/database.js   → ligas, clubes, patrocinadores, pools de nomes
/js/player.js     → atributos, overall, XP, geração de elenco
/js/events.js     → eventos de partida por posição/atributo
/js/transfers.js  → propostas, negociação de contrato, patrocínios, convocações
/js/career.js     → estado da carreira, calendário, treino, save/load
/js/ui.js         → renderização das telas
/js/game.js        → orquestração dos eventos da interface
```

## Save

O progresso é salvo automaticamente no `localStorage` do navegador — não há backend.

## Sobre os elencos

Clubes, ligas e estádios usam nomes reais. Os elencos dos clubes (fora do seu atleta) são gerados proceduralmente a partir de pools de nomes reais por nacionalidade, para manter overalls e profundidade de elenco equilibrados e sempre atualizados. Para plugar um elenco real/licenciado, basta substituir `PlayerModel.generateSquad()` em `js/player.js`.
