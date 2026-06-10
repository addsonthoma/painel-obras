#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Importa um orçamento do Quanto Sobra para o Painel de Obras (Supabase).

Fluxo de uso:
  1. O Claude (ou você) raspa o orçamento do Quanto Sobra e gera um JSON
     com o formato abaixo.
  2. Roda:  python importar_qs.py orcamento.json
  3. A obra + serviços + materiais + valor caem no painel.

Formato do JSON de entrada (campos extras são ignorados):
{
  "cliente": "Master Shopping",
  "endereco": "Rua X, 100 - Centro",
  "telefone_cliente": "47 99999-0000",
  "orcamento_qs": "OR901",
  "valor_total": 32000.00,
  "data_inicio": "2026-06-10",
  "data_prazo":  "2026-06-20",
  "tem_skid": true,
  "servicos": [ {"servico": "SHP", "dias": 3, "pessoas": 3},
                {"servico": "SDAI", "dias": 2, "pessoas": 2} ],
  "itens":    [ {"produto": "Tubo aço galv 2.1/2\"", "quantidade": 30, "unidade": "m"},
                {"produto": "Hidrante completo", "quantidade": 4, "unidade": "un"} ]
}

Se "servicos" vier vazio, o script tenta adivinhar pelos nomes dos itens.
Lê SUPABASE_URL e SUPABASE_SERVICE_KEY de ../privado/.env
"""
import json, os, sys, urllib.request, urllib.error
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENV  = RAIZ / "privado" / ".env"

# pistas simples p/ adivinhar o serviço pelo nome do material (igual lógica da proposta)
PISTAS = {
    "SPDA":   ["cobre nu", "haste", "captor", "franklin", "mastro", "aterr", "para-raio", "para raio"],
    "SHP":    ["hidrante", "mangueira", "mangotinho", "abrigo", "esguicho", "bomba", "tubo aço", "registro globo"],
    "SDAI":   ["central de alarme", "detector", "acionador", "sirene", "avisador", "fumaça"],
    "VITAIS": ["extintor", "placa de saída", "bloco autônomo", "iluminação de emerg", "sinaliza"],
    "GLP":    ["regulador", "abrigo de gás", "tubo cobre", "válvula gás", "glp"],
}

def carregar_env():
    cfg = {}
    if ENV.exists():
        for ln in ENV.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k, v = ln.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"')
    url = cfg.get("SUPABASE_URL")  or os.environ.get("SUPABASE_URL")
    key = cfg.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or "COLE_AQUI" in url or not key or "COLE_AQUI" in key:
        sys.exit("ERRO: preencha SUPABASE_URL e SUPABASE_SERVICE_KEY em privado/.env")
    return url.rstrip("/"), key

def req(url, key, metodo, caminho, corpo=None, prefer=None):
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    r = urllib.request.Request(url + "/rest/v1/" + caminho, data=data, method=metodo)
    r.add_header("apikey", key)
    r.add_header("Authorization", "Bearer " + key)
    r.add_header("Content-Type", "application/json")
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode("utf-8")
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f"ERRO {e.code} em {metodo} {caminho}: {e.read().decode('utf-8')}")

def adivinhar_servicos(itens):
    achados = []
    for serv, pistas in PISTAS.items():
        for it in itens:
            nome = (it.get("produto") or "").lower()
            if any(p in nome for p in pistas):
                achados.append({"servico": serv, "dias": None, "pessoas": None})
                break
    return achados

def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python importar_qs.py caminho/orcamento.json")
    dados = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if not dados.get("cliente"):
        sys.exit("ERRO: o JSON precisa ter ao menos 'cliente'.")
    url, key = carregar_env()

    obra = {
        "cliente": dados["cliente"],
        "endereco": dados.get("endereco"),
        "telefone_cliente": dados.get("telefone_cliente"),
        "orcamento_qs": dados.get("orcamento_qs"),
        "data_inicio": dados.get("data_inicio"),
        "data_prazo": dados.get("data_prazo"),
        "tem_skid": bool(dados.get("tem_skid", False)),
    }
    nova = req(url, key, "POST", "obras", [obra], "return=representation")[0]
    oid = nova["id"]

    itens = dados.get("itens") or []
    servicos = dados.get("servicos") or adivinhar_servicos(itens)
    if servicos:
        req(url, key, "POST", "obra_servicos", [{**s, "obra_id": oid} for s in servicos])
    if itens:
        linhas = [{"produto": it["produto"], "quantidade": it.get("quantidade", 1),
                   "unidade": it.get("unidade"), "servico": it.get("servico"), "ordem": i}
                  for i, it in enumerate(itens)]
        req(url, key, "POST", "obra_itens", linhas)

    req(url, key, "POST", "obra_financeiro",
        [{"obra_id": oid, "valor_total": dados.get("valor_total"), "status_cobranca": "nao_aplicavel"}],
        "resolution=merge-duplicates")

    print(f"OK - obra '{obra['cliente']}' importada.")
    print(f"   id: {oid}")
    print(f"   serviços: {[s['servico'] for s in servicos] or 'nenhum'}")
    print(f"   materiais: {len(itens)}")
    print("   Abra o painel para conferir, definir prazo/equipe e ajustar o que precisar.")

if __name__ == "__main__":
    main()
