# Portal Rodrigues Preventivos

Portal interno da Rodrigues Preventivos — começou como "Painel de Obras" e virou
o guarda-chuva das ferramentas do escritório. **No ar:** https://addsonthoma.github.io/painel-obras/

- **Frontend:** site estático (`docs/`) publicado no GitHub Pages (branch `main`, pasta `/docs`).
- **Backend:** Supabase (login, Postgres com RLS, Storage p/ PDFs). Projeto `painel-obras-rodrigues`.
- **PWA:** instalável no celular (manifest + service worker network-first).

## Módulos

| Módulo | O que faz | Quem vê |
|---|---|---|
| 🏗️ **Obras** | obras fechadas, prazos, equipes (motor de sugestão), folha de materiais (Moritz), pendências e cobranças | admin (tudo) · operação (sem valores) |
| 💲 **Orçamentos** | funil de propostas (a orçar → enviado → ganho/perdido), follow-up rolling de 7 dias, import de PDF do Quanto Sobra, ganhar → vira obra | comercial (admin ou perfil com `vendedor`) |
| 📍 **Leads** | painel CBMSC (multas/AFs/protocolos) embutido — repo separado `rodrigues-painel` | admin + comercial |
| 🛡️ **Monitoramento** | vigia edificações de clientes no e-SCI: autos (AF/multa), validade do funcionamento (+1 ano), manutenção (5 meses) | só admin |
| ♻️ **Renovações** | pós-venda: clientes com obrigações anuais (SHP, SDAI, extintores, SPDA, gás), gerador de e-mail/WhatsApp por norma | só admin |

## Papéis e privacidade

- **admin** (Addson, Henrique, Rodrigues, Aline): tudo, inclusive valores e cobranças.
- **comercial** (perfil com `vendedor`): Orçamentos + Leads. Não lê as tabelas de obras.
- **operação** (campo/TV): obras, prazos, equipe e materiais — **nunca valores**.
  Dinheiro mora em `obra_financeiro` (RLS só admin). Anexos com preço (PDF do QS)
  são `restrito` (flag + prefixo `restrito/` no Storage) — o campo não vê.

## Pastas

- `docs/` — o app (index.html, app.js, styles.css, config.js, sw.js, assets/)
- `sql/` — banco: `setup.sql` (base) + migrações (ver ordem no SETUP.md)
- `scripts/` — automação: coletor do monitoramento e-SCI, login automático (vbs),
  importadores do Quanto Sobra (`puxar_qs.js` + `importar_qs.py`)
- `privado/` — **NÃO versionado**: `.env` (service key + credenciais e-SCI),
  cookie/perfil do e-SCI (Playwright), contatos, migradores one-off
- `SETUP.md` — instalação do zero, passo a passo

## Tarefas agendadas (Windows, neste PC)

| Tarefa | Quando | O que faz |
|---|---|---|
| `RodriguesESCILogin` | diária 08:25 | renova a sessão do e-SCI (`esci_login_oculto.vbs` → `privado/esci_login.py`) e grava o cookie p/ obras **e** p/ o drill de leads |
| `RodriguesMonitorESCI` | a cada 2 dias 08:00 | `scripts/coletar_monitor.bat` → login + `coletar_monitor.py` (autos/funcionamento das REs monitoradas) |
| `DrillDiario` (repo leads) | a cada 2h | enriquece leads/protocolos (repo `rodrigues-painel`) |
| GitHub Actions (repo leads) | a cada 10 min, nuvem | coleta pública de multas/AFs/protocolos |

Logs em `privado/coletar_monitor.log` e `privado/esci_login.log` (rotação automática a ~200 KB).

## Observações de esquema

Colunas **reservadas** (existem no banco, ainda sem tela): `obra_financeiro.valor_cobrado`,
`obra_financeiro.cobranca_obs`, `obra_itens.servico`, `orcamentos.projeto_pdf_path`,
`monitor_clientes.ativo`, `monitor_res.obs` (o coletor filtra `monitor_res.ativo`).

➡️ **Para instalar do zero, siga o [SETUP.md](SETUP.md).**
