# SETUP — colocar o Painel de Obras no ar

São ~20 minutos, uma vez só. Pode me chamar (Claude) em qualquer passo: eu te
guio clique a clique ou faço a parte de código/`git` por você.

> Visão geral: **Supabase** guarda login + dados + PDFs. **GitHub Pages** hospeda a
> tela. A URL pode até ser pública — sem o login ninguém vê nada.

---

## Passo 1 — Criar o projeto no Supabase (grátis)
1. Acesse **https://supabase.com** → **Start your project** → entre com o GitHub.
2. **New project**:
   - **Name:** `painel-obras-rodrigues`
   - **Database Password:** crie uma senha forte e **guarde** (não precisa decorar).
   - **Region:** `South America (São Paulo)`.
3. Espere ~2 min o projeto criar.

## Passo 2 — Pegar a URL + a chave pública (anon)
1. No projeto: **Project Settings** (engrenagem) → **API Keys** (ou **Data API**).
2. Copie:
   - **Project URL** → ex.: `https://abcdxyz.supabase.co`
   - **anon public** (a chave longa marcada como *anon* / *public*)
3. Abra `docs/config.js` e cole nos dois lugares:
   ```js
   SUPABASE_URL: "https://abcdxyz.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...."  // a anon public
   ```
   > A `anon` é pública de propósito — pode versionar. **Nunca** ponha a *service_role* aqui.

## Passo 3 — Criar o banco
1. No Supabase: **SQL Editor** → **New query**.
2. Abra o arquivo `sql/setup.sql`, **copie tudo**, cole e clique **Run**.
3. Deve aparecer *Success*. (Pode rodar de novo sem problema — é idempotente.)

## Passo 4 — Criar os logins e marcar os admins
1. **Authentication** → **Users** → **Add user** → **Create new user**.
   - Crie um para cada pessoa do administrativo (e-mail + senha). Marque
     **Auto Confirm User**. Sugestão de quem deve entrar:
     - Addson, Henrique, Rodrigues (Antônio Valmir), Aline → serão **admin**
     - (opcional) um login `operacao` para a equipe/TV ver as obras
2. Marque os 4 como **admin**: volte ao **SQL Editor** e rode (troque pelos e-mails reais):
   ```sql
   update public.perfis set papel = 'admin'
   where id in (
     select id from auth.users
     where email in ('addson@...', 'henrique@...', 'rodrigues@...', 'aline@...')
   );
   ```
   > Quem não for marcado fica como **operação** (vê obras/materiais, sem valores).

## Passo 5 — (opcional, p/ importar do Quanto Sobra) chave de serviço
Só se você quiser usar a importação assistida do QS:
1. **Project Settings → API Keys** → copie a **service_role** (a secreta).
2. Abra `privado/.env` e preencha:
   ```
   SUPABASE_URL=https://abcdxyz.supabase.co
   SUPABASE_SERVICE_KEY=eyJhbGciOi....(service_role)
   ```
   > `privado/` está no `.gitignore` — **não** vai para o GitHub. Mantenha assim.

## Passo 6 — Publicar no GitHub Pages
No PowerShell, dentro de `C:\Users\User\PainelObras`:
```powershell
git add .
git commit -m "Painel de obras - versao inicial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/painel-obras.git
git push -u origin main
```
(Crie o repositório `painel-obras` antes em https://github.com/new — pode ser **público**;
os segredos não sobem por causa do `.gitignore`.)

Depois, no GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: `main` / Folder: `/docs` → Save**.

Em ~1 min o painel fica em: **`https://SEU_USUARIO.github.io/painel-obras/`**

## Passo 7 — Testar
1. Abra a URL, faça login com um dos usuários.
2. **+ Nova obra**: cadastre uma de teste (cliente, serviços, materiais) → **Sugerir** a equipe → salvar.
3. Clique na obra → **Imprimir folha de separação** (confira: **sem valores**).
4. **Confirmar 100% concluída** → veja cair na aba **Cobranças**.

---

## No dia a dia (resumo)
- **Obras** ordena por urgência (prazo mais curto no topo, "faltam X dias").
- **🖨 Materiais** = folha do Moritz (só quantidades).
- **Pendência material** → marca o que falta → aparece na aba **Pendências** (Addson/compras).
- **100% concluída** (só admin) → vai pra **Cobranças** (Aline) → botões *enviada* / *pago* / *WhatsApp cliente*.
- **Equipe**: adicionar/editar/remover membros e habilidades (admin).

## Importar um orçamento do Quanto Sobra
Me peça: **"importa o OR901 pro painel"**. Eu abro o QS no Chrome, puxo
cliente/itens/quantidades/valor e rodo:
```powershell
python scripts\importar_qs.py orcamento.json
```
A obra entra com a folha de materiais já preenchida; você só ajusta prazo, dias×pessoas e equipe.

## Mexer nos telefones (automação futura de WhatsApp)
Ficam em `privado/contatos.json` (fora do painel, fora do GitHub). Me peça:
**"adiciona/remove o contato Fulano"** que eu edito o arquivo.

## Dúvidas comuns
- **O projeto grátis "dorme"?** Só após **7 dias sem nenhum acesso**. Em uso diário, nunca dorme.
- **Esqueci a senha de um usuário:** Authentication → Users → ⋯ → *Reset password*.
- **Quero esconder valor de mais gente:** já está — só `admin` lê a tabela financeira.
