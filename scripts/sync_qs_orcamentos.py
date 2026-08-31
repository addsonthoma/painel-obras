# -*- coding: utf-8 -*-
"""
SINCRONIZA orçamentos do Quanto Sobra -> aba ORÇAMENTOS do painel.

Regras combinadas com o Addson:
  - SOMENTE LEITURA no QS. Nunca escreve nada lá.
  - Só traz orçamentos NOVOS (a partir do marco gravado em privado/qs_marco.json).
    Na 1ª execução ele só grava o marco e não importa nada (não polui com o histórico).
  - Entra como PENDENTE (status 'orcar'): o follow-up de 7 dias começa quando o
    Addson clicar em "Feito + enviado" no painel.
  - NUNCA cria obra. Obra só nasce quando ele marcar "Fechou conosco".

Uso:
    python scripts/sync_qs_orcamentos.py            # importa os novos
    python scripts/sync_qs_orcamentos.py --teste    # só mostra o que faria
    python scripts/sync_qs_orcamentos.py --marco N  # redefine o marco (nº do último OR já tratado)
"""
import json, re, sys, urllib.request, urllib.error
from pathlib import Path

RAIZ    = Path(__file__).resolve().parent.parent
PRIVADO = RAIZ / "privado"
COOKIE  = PRIVADO / "qs_cookie.txt"
MARCO   = PRIVADO / "qs_marco.json"
ENV     = PRIVADO / ".env"
QS      = "https://app.quantosobra.com.br"
TESTE   = "--teste" in sys.argv

cfg = {}
for ln in ENV.read_text(encoding="utf-8").splitlines():
    ln = ln.strip()
    if ln and not ln.startswith("#") and "=" in ln:
        k, v = ln.split("=", 1); cfg[k.strip()] = v.strip().strip('"')
SB_URL, SB_KEY = cfg["SUPABASE_URL"].rstrip("/"), cfg["SUPABASE_SERVICE_KEY"]

def sb(method, path, body=None, prefer=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(SB_URL + "/rest/v1/" + path, data=data, method=method)
    r.add_header("apikey", SB_KEY); r.add_header("Authorization", "Bearer " + SB_KEY)
    r.add_header("Content-Type", "application/json")
    if prefer: r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode("utf-8"); return json.loads(t) if t else []
    except urllib.error.HTTPError as e:
        print("  [supabase %s] %s" % (e.code, e.read().decode("utf-8")[:200])); return None

def qs_get(url):
    if not COOKIE.exists():
        sys.exit("Sem privado/qs_cookie.txt — rode antes: python privado/qs_login.py")
    ck = COOKIE.read_text(encoding="utf-8").strip().split("Cookie:", 1)[-1].strip()
    r = urllib.request.Request(QS + url)
    r.add_header("Cookie", ck)
    r.add_header("User-Agent", "Mozilla/5.0 RodriguesSync")
    r.add_header("X-Requested-With", "XMLHttpRequest")
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))

def valor_br(s):
    try: return float(str(s or "0").replace(".", "").replace(",", "."))
    except Exception: return None

# --- 1) lista do QS (o parâmetro name=orcamento é obrigatório; sem ele: "Cruder inválido") ---
LISTA = ("/ws.php?q=cruder&entity=orcamento&type=table&name=orcamento"
         "&sEcho=1&iColumns=12&iDisplayStart=0&iDisplayLength=5000&mDataProp_0=num_orcamento"
         "&sSearch=&data_inicio=01%2F01%2F2015&data_fim=31%2F12%2F2035")
d = qs_get(LISTA)
linhas = d.get("aaData")
if isinstance(linhas, str): linhas = json.loads(linhas)
if not isinstance(linhas, list): sys.exit("QS devolveu formato inesperado (sessão caiu?): %s" % str(d)[:200])
def num(x):
    try: return int(str(x.get("num") or 0))
    except Exception: return 0
linhas = [x for x in linhas if num(x) > 0]
maior = max(num(x) for x in linhas) if linhas else 0
print("QS: %d orçamentos | maior nº: %d" % (len(linhas), maior))

# --- 2) marco: só o que veio depois ---
if "--marco" in sys.argv:
    m = int(sys.argv[sys.argv.index("--marco") + 1])
    MARCO.write_text(json.dumps({"ultimo_num": m}), encoding="utf-8")
    print("Marco redefinido para %d." % m); sys.exit(0)
if not MARCO.exists():
    MARCO.write_text(json.dumps({"ultimo_num": maior}), encoding="utf-8")
    print("1ª execução: marco gravado em %d. Nada importado — a partir de agora só entram os novos." % maior)
    sys.exit(0)
marco = json.loads(MARCO.read_text(encoding="utf-8")).get("ultimo_num", 0)
novos = sorted([x for x in linhas if num(x) > marco], key=num)
print("marco atual: %d -> %d novo(s)" % (marco, len(novos)))
if not novos: sys.exit(0)

# --- 3) não duplicar: o que já existe no painel ---
ja = set()
for tab in ("orcamentos", "obras"):
    for x in (sb("GET", tab + "?select=orcamento_qs") or []):
        for n in re.findall(r"OR\s*(\d+)", (x.get("orcamento_qs") or "").upper()): ja.add(n)

criados = 0
for x in novos:
    n = str(num(x))
    if n in ja:
        print("  = OR%-6s já existe no painel" % n); continue
    cliente = (x.get("clifor") or "").strip() or "(sem cliente)"
    dados = {
        "cliente": cliente,
        "orcamento_qs": "OR" + n,
        "valor_total": valor_br(x.get("valor")),
        "telefone": (x.get("telefones") or "").split("/")[0].strip() or None,
        "observacoes": (x.get("obs") or "").strip() or None,
        "responsavel": (x.get("vendedor_nome") or "").strip().title() or None,
        "origem": "Quanto Sobra",
        "status": "orcar",              # PENDENTE — o Addson confirma o envio no painel
        "criado_por_nome": "Sincronização QS",
    }
    if TESTE:
        print("  + [teste] OR%-6s %-42s %s" % (n, cliente[:42], x.get("valor"))); criados += 1; continue
    novo = sb("POST", "orcamentos", [dados], "return=representation")
    if not novo:
        print("  ! OR%s NÃO criado" % n); continue
    oid = novo[0]["id"]
    # materiais (servico=0 = produto; 1 = mão de obra, fica de fora)
    try:
        det = qs_get("/ws.php?q=cruder&entity=orcamento&type=get&name=orcamento&orcamento_id=" + str(x.get("orcamento_id")))
        mps = ((det or {}).get("ret") or {}).get("mps") or []
        itens = [{"orcamento_id": oid, "produto": m.get("nome_produto"),
                  "quantidade": valor_br(m.get("quantidade")) or 1, "ordem": i}
                 for i, m in enumerate([m for m in mps if str(m.get("servico")) == "0"]) if m.get("nome_produto")]
        if itens: sb("POST", "orcamento_itens", itens)
    except Exception as e:
        print("     (sem materiais: %s)" % e); itens = []
    print("  + OR%-6s %-42s %s  [%d materiais]" % (n, cliente[:42], x.get("valor"), len(itens)))
    criados += 1

if not TESTE and criados:
    MARCO.write_text(json.dumps({"ultimo_num": maior}), encoding="utf-8")
print("\nFIM — %d orçamento(s) %s." % (criados, "seriam criados (teste)" if TESTE else "criados na aba Orçamentos"))
