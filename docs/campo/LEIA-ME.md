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

`?quadro` na URL abre o quadro do escritório em vez da tela do celular.

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
