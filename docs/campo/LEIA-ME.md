# Campo — apontamento de obra pelo celular

Substitui a folha de papel que a equipe preenche à mão. Página própria,
separada do Portal: carrega em um segundo no celular de obra e o funcionário
nunca esbarra em tela de orçamento, valor ou cobrança.

**Estado atual: beta.** `CAMPO_DEMO = true` em `campo.js` — roda sozinho,
grava no `localStorage` do próprio celular, não fala com o Supabase.

## O princípio

O app **nunca trava o funcionário**. Hora e coordenada são sagradas; obra e
serviço podem ser corrigidos depois no escritório. Se o GPS não pegar, se a
obra não estiver na lista, se ele não souber o nome do cliente — grava assim
mesmo e cai na fila de "resolver depois".

Por isso nada aqui depende da agenda estar preenchida na véspera.

## Como o app descobre a obra

Tenta na ordem e para no primeiro que funcionar:

1. **Agenda do dia** (`obra_agenda`) — quando existir. Bônus, não requisito.
2. **GPS** — casa a coordenada com `obra_coordenadas` num raio de 150 m.
3. **Onde ele esteve** — as últimas 6 obras dele, guardadas no aparelho.
4. **Falar o nome** — ditado; o escritório normaliza depois.

O banco de coordenadas se alimenta sozinho: toda vez que alguém escolhe a obra
na mão, o ponto é gravado. A média móvel em `registrar_coordenada_obra()` vai
corrigindo o erro do GPS a cada visita.

## Privacidade

Coordenada é lida **só nos dois toques**, chegada e saída. Não existe
rastreamento contínuo e não existe coluna no banco para guardar isso — de
propósito. É a mesma informação que já ia na folha de papel: obra, horário e
quem estava.

## Telas

| Momento | Toques |
|---|---|
| No pátio | "estou saindo para" → obra |
| Na obra | "cheguei" |
| No fim | "terminei" → serviço → veículo → equipe → falar → enviar |

`?quadro` na URL abre o quadro do escritório. `?acao=cheguei` já abre na
escolha da obra — é o atalho que aparece ao segurar o ícone no Android.

## Instalação no celular

É um PWA: instala pela tela de início, sem loja de aplicativo.

- **Android:** o Chrome oferece instalar sozinho; o app também mostra um botão
  "Instalar agora" quando o navegador libera o `beforeinstallprompt`.
- **iPhone:** o Safari não tem esse botão. O app detecta o aparelho e mostra o
  passo a passo do menu Compartilhar → Adicionar à Tela de Início.

O `manifest.json` declara escopo `./`, então o Campo instala como aplicativo
separado do Portal — ícone próprio, sem barra de navegador. O `sw.js` tem
escopo mais específico que o do Portal e por isso manda nesta pasta.

### Ícones

`scripts/gerar_icones_campo.py` monta ícones e telas de abertura a partir de
`docs/assets/logo.png`. O ícone é a chama da marca sobre o vermelho, com a
palavra CAMPO — deliberadamente diferente do ícone do Portal, que é o logo
inteiro. Dois ícones vermelhos iguais na tela de início fariam o funcionário
abrir o aplicativo errado.

Rode de novo se o logo mudar:

```
python scripts/gerar_icones_campo.py
```

## Para colocar no ar

1. Rodar `sql/migracao_campo.sql` no Supabase (SQL Editor, janela limpa).
2. Trocar `CAMPO_DEMO` para `false` em `campo.js`.
3. Definir `window.CAMPO_URL` e `window.CAMPO_ANON` (mesmo padrão do Portal).
4. Trocar os cadastros fixos no topo de `campo.js` (`EQUIPE`, `VEICULOS`,
   `OBRAS`) por leitura das tabelas `equipe` e `obras`.
5. Publicar: merge na `main`, GitHub Pages serve `/docs` automaticamente.

## Gerar o beta de arquivo único

```
python scripts/gerar_demo_campo.py
```

Embute CSS e JS num HTML só, para mandar por link e abrir no celular sem
servidor. Não existe cópia paralela do app — mexeu aqui, roda de novo.
