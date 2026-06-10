# Painel de Obras — Rodrigues Preventivos

Painel interno para organizar **obras fechadas**, direcionar **equipes**, gerar a
**folha de materiais** do estoque e controlar **cobranças** — substituindo o quadro
físico da parede e o "tá na cabeça".

- **Frontend:** site estático (`docs/`) — publica no GitHub Pages.
- **Backend:** Supabase (login, banco e PDFs dos projetos).
- **Privacidade:** dados só aparecem **depois do login**. Operação (campo) vê obras,
  prazos e materiais — **nunca valores nem cobrança**.

## O que cada um vê
| Papel | Vê |
|---|---|
| **admin** (Addson, Henrique, Rodrigues, Aline) | tudo: valores, cobranças, edição, confirmar 100% |
| **operação** (campo) | obras, prazos, equipe, materiais (sem R$), pendências |

## Pastas
- `docs/` — o app (index.html, app.js, styles.css, config.js, assets/)
- `sql/setup.sql` — cria o banco no Supabase (rodar 1x)
- `scripts/importar_qs.py` — importa um orçamento do Quanto Sobra
- `privado/` — **NÃO versionado**: telefones (automação futura) + chave de serviço
- `SETUP.md` — **comece por aqui** para colocar no ar

➡️ **Para instalar e publicar, siga o [SETUP.md](SETUP.md).**
