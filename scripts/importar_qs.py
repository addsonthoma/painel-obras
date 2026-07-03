#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Importa orçamento(s) do Quanto Sobra para o Painel de Obras (Supabase).

Use junto com scripts/puxar_qs.js (que puxa os dados do QS pela API interna):
    1) rode o puxar_qs.js na aba logada do QS -> copie o array JSON pra um arquivo
    2) python importar_qs.py arquivo.json

O JSON pode ser UM orçamento (objeto) ou VÁRIOS (lista). Campos:
    orcamento_qs, cliente, valor_total, telefone_cliente, obs (opcionais p/ os 3),
    itens: [ {produto, quantidade, unidade?} ],
    servicos: [ "SHP"|"SPDA"|"VITAIS"|"SDAI"|"GLP"|"MANUT_ALARME"|... ]  (opcional:
              se não vier, é detectado pelos nomes dos itens + observação)
    tem_skid (opcional: se não vier, detecta item "skid")

Pula automaticamente quem já existe no painel (mesmo orcamento_qs).
Itens tipo serviço (mão de obra/ART) NÃO devem vir aqui — o puxar_qs.js já filtra.
Lê SUPABASE_URL e SUPABASE_SERVICE_KEY de ../privado/.env
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / "privado" / ".env"

def carregar_env():
    cfg = {}
    if ENV.exists():
        for ln in ENV.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k, v = ln.split("=", 1); cfg[k.strip()] = v.strip().strip('"')
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or "COLE_AQUI" in url or not key or "COLE_AQUI" in key:
        sys.exit("ERRO: preencha SUPABASE_URL e SUPABASE_SERVICE_KEY em privado/.env")
    return url.rstrip("/"), key

URL, KEY = carregar_env()
def req(metodo, caminho, corpo=None, prefer=None):
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + caminho, data=data, method=metodo)
    r.add_header("apikey", KEY); r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json")
    if prefer: r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode("utf-8"); return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit("ERRO %s em %s %s: %s" % (e.code, metodo, caminho, e.read().decode("utf-8")))

# ---- detecção do tipo de serviço pelos nomes dos itens + observação ----
# ⚠ manter em SINCRONIA com PISTAS_QS em docs/app.js (o import por PDF usa a mesma lista)
PISTAS = {
    "SHP":    ["hidrante", "mangueira", "mangotinho", "ranhurado", "tubo aço", "tubo aco",
               "tubo carbono", "tubo galv", "registro", "esguicho", "storz", "niple", "flange",
               "valvula gaveta", "válvula gaveta", "skid", "abrigo de mangueira", "tubulaç", "tubulac",
               "valvula retenção", "valvula retencao", "joelho galv", "cotovelo galv"],
    "SDAI":   ["central alarme", "central de alarme", "detector", "acionador", "sirene",
               "audio visual", "áudio visual", "endereç", "enderec", "cabo blindado",
               "fonte auxiliar", "módulo de endere", "modulo de endere", "avisador",
               "módulo de comunica", "modulo de comunica", "bateria 12v"],
    "VITAIS": ["bloco nano", "bloco 3000", "bloco autôn", "bloco auton", "iluminação de emerg",
               "iluminacao de emerg", "placa de saída", "placa de saida", "placa extintor",
               "suporte de parede para extintor", "extintor", "demarcação de piso", "placa letra"],
    "SPDA":   ["cobre nu", "haste de aterr", "captor", "franklin", "mastro", "para-raio", "para raio"],
    "GLP":    ["regulador", "abrigo de gás", "abrigo de gas", "tubo cobre", "válvula gás", "valvula gas"],
}
def detectar_servicos(o):
    if o.get("servicos"):
        return list(o["servicos"])
    txt = " ".join((it.get("produto") or "").lower() for it in o.get("itens", []))
    obs = (o.get("obs") or "").lower()
    full = txt + " " + obs
    achados = [serv for serv, ks in PISTAS.items() if any(k in full for k in ks)]
    if not achados:
        achados = ["SHP"]  # fallback seguro (manutenção genérica)
    # manutenção exclusiva de alarme -> MANUT_ALARME
    manut = any(k in obs for k in ["manuten", "reparo", "troca de central", "substituiç",
                                   "substituic", "elevaç", "elevac", "alteração de tubul", "alteracao de tubul"])
    if manut and achados == ["SDAI"]:
        achados = ["MANUT_ALARME"]
    return achados

def detectar_skid(o):
    if "tem_skid" in o:
        return bool(o["tem_skid"])
    return any("skid" in (it.get("produto") or "").lower() for it in o.get("itens", []))

def existe(orc):
    r = req("GET", "obras?orcamento_qs=eq.%s&select=id" % orc)
    return r[0]["id"] if r else None

def importar(o):
    orc = o.get("orcamento_qs")
    if o.get("erro"):
        print("IGNORADO %s: %s" % (orc, o["erro"])); return
    if not o.get("cliente"):
        print("IGNORADO %s: sem cliente" % orc); return
    if orc and existe(orc):
        print("PULADO (já existe): %s" % orc); return
    servicos = detectar_servicos(o)
    nova = req("POST", "obras", [{"cliente": o["cliente"], "orcamento_qs": orc,
        "telefone_cliente": o.get("telefone_cliente"), "tem_skid": detectar_skid(o),
        "observacoes": o.get("obs")}],
        "return=representation")[0]
    oid = nova["id"]
    req("POST", "obra_servicos", [{"obra_id": oid, "servico": s} for s in servicos])
    itens = o.get("itens", [])
    if itens:
        req("POST", "obra_itens", [{"obra_id": oid, "produto": it["produto"],
            "quantidade": it.get("quantidade", 1), "unidade": it.get("unidade"), "ordem": i}
            for i, it in enumerate(itens)])
    req("POST", "obra_financeiro", [{"obra_id": oid, "valor_total": o.get("valor_total"),
        "status_cobranca": "nao_aplicavel"}], "resolution=merge-duplicates")
    print("OK  %-6s  %-42s  %-14s  %d materiais%s" % (
        orc, (o["cliente"] or "")[:42], "+".join(servicos), len(itens),
        "  [SKID]" if detectar_skid(o) else ""))

def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python importar_qs.py arquivo.json")
    dados = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    lista = dados if isinstance(dados, list) else [dados]
    for o in lista:
        importar(o)
    print("FIM — %d processado(s)" % len(lista))

if __name__ == "__main__":
    main()
