# -*- coding: utf-8 -*-
"""
COLETOR DO MONITORAMENTO e-SCI — Rodrigues Preventivos
Rodar no PC com o Chrome ABERTO e LOGADO no e-SCI (esci.cbm.sc.gov.br).

Para cada RE monitorada (tabela monitor_res no Supabase):
  - busca os AUTOS (AF/multa) e o último FUNCIONAMENTO (emissão + validade) no e-SCI
  - grava no Supabase: insere autos NOVOS (marcados novo=true) e atualiza
    funcionamento_data / funcionamento_validade / ultima_verificacao.

Roda sozinho a cada 2 dias via Agendador (ver coletar_monitor.bat).
Cookies: lidos do Chrome automaticamente (browser_cookie3). Se a sessão do e-SCI
expirar, faça login no Chrome e rode de novo.

Requer: pip install browser_cookie3 requests   (já instalados p/ o drill de leads)
"""
import json, os, sys, time, urllib.request, urllib.error
from urllib.parse import quote
from datetime import datetime, timezone, timedelta
try:
    import browser_cookie3, requests
except ImportError:
    sys.exit("Instale primeiro:  pip install browser_cookie3 requests")

# ---------------- Supabase ----------------
RAIZ  = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ENVFP = os.path.join(RAIZ, "privado", ".env")
def carregar_env():
    cfg = {}
    for ln in open(ENVFP, encoding="utf-8"):
        ln = ln.strip()
        if ln and not ln.startswith("#") and "=" in ln:
            k, v = ln.split("=", 1); cfg[k.strip()] = v.strip().strip('"')
    return cfg["SUPABASE_URL"].rstrip("/"), cfg["SUPABASE_SERVICE_KEY"]
SB_URL, SB_KEY = carregar_env()
def sb(method, path, body=None, prefer=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(SB_URL + "/rest/v1/" + path, data=data, method=method)
    r.add_header("apikey", SB_KEY); r.add_header("Authorization", "Bearer " + SB_KEY); r.add_header("Content-Type", "application/json")
    if prefer: r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode("utf-8"); return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        print("  [supabase %s] %s" % (e.code, e.read().decode("utf-8")[:200])); return None

def coluna_existe(tabela, coluna):
    r = urllib.request.Request(SB_URL + "/rest/v1/%s?select=%s&limit=1" % (tabela, coluna))
    r.add_header("apikey", SB_KEY); r.add_header("Authorization", "Bearer " + SB_KEY)
    try:
        urllib.request.urlopen(r); return True
    except urllib.error.HTTPError:
        return False

# ---------------- e-SCI ----------------
BASE     = "https://esci.cbm.sc.gov.br"
EP_BUSCA = "/Safe/Geral/ControllerConsultaGeral/consultaGeralEdificacao/"
EP_EDIF  = "/Safe/Gerencial/ControllerRegistroEdificacoes/carregarDadosEdificacao/"
EP_BLOCO = "/Safe/Geral/Edificacao/ControllerBloco/carregarDadosBlocoUltimoHomologacaoOuEnquadramento/"

# Procura cookie em arquivo (reaproveita o cookies.txt do drill de leads) antes
# de tentar o Chrome (que exige admin). Formato: a string de "copy(document.cookie)".
COOKIE_FILES = [
    os.path.join(RAIZ, "privado", "esci_cookie.txt"),
    r"C:\Users\User\Documents\Rodrigues_Preventivos_Leads\PainelGithub\scripts\cookies.txt",
]
def cookies_de_arquivo():
    for fp in COOKIE_FILES:
        if os.path.exists(fp):
            raw = open(fp, encoding="utf-8").read().strip()
            if not raw:
                continue
            raw = raw.split("Cookie:", 1)[-1].strip()
            ck = {}
            for part in raw.split(";"):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1); ck[k.strip()] = v.strip()
            if ck:
                return ck, fp
    return None, None

def sessao():
    cookies, fp = cookies_de_arquivo()
    if cookies:
        print("[*] Cookies de %s (%d)." % (fp, len(cookies)))
    else:
        try:
            cj = browser_cookie3.chrome(domain_name="esci.cbm.sc.gov.br")
            cookies = {c.name: c.value for c in cj}
        except Exception as e:
            print("[!] browser_cookie3 falhou (precisa admin):", e); cookies = None
    if not cookies:
        sys.exit("Sem cookies do e-SCI. Crie privado/esci_cookie.txt com 'copy(document.cookie)' "
                 "(F12 Console no e-SCI logado), OU rode como administrador.")
    s = requests.Session(); s.cookies.update(cookies)
    s.headers.update({"Content-Type": "application/json;charset=UTF-8",
                      "Accept": "application/json, text/plain, */*",
                      "User-Agent": "Mozilla/5.0 RodriguesMonitor"})
    return s

def epost(s, ep, payload, retries=2):
    for i in range(retries + 1):
        try:
            r = s.post(BASE + ep, json=payload, timeout=30)
        except requests.exceptions.RequestException as e:
            if i < retries: time.sleep(2); continue
            print("  [rede]", e); return None
        if r.status_code != 200: return None
        if r.text.strip().startswith("<"): return "EXPIRED"   # voltou pagina de login
        try: return r.json()
        except Exception: return None
    return None

def _iso(d):
    return d["date"][:10] if isinstance(d, dict) and d.get("date") else None
def _tipo(cod):
    return "MUL" if (cod or "").upper().startswith("MUL") else "AF"

def coletar_re(s, re):
    numg = re.get("numg_edificacao")
    achado = {}
    if not numg:
        b = epost(s, EP_BUSCA, {"texto": re["re_codigo"], "numgCidade": None, "numrQuantidade": 50,
                                "flagMostrarReExcluido": False, "flagOnlyRe": True})
        if b == "EXPIRED": return "EXPIRED"
        if isinstance(b, list) and b:
            numg = b[0].get("numgEdificacao")
            achado = {"nome": b[0].get("nomeEdificacao"), "cidade": b[0].get("nomeCidade"),
                      "endereco": ((b[0].get("nomeLogradouro") or "") + ", " + str(b[0].get("codgNumeroEndereco") or "")).strip(", ")}
    if not numg: return None
    edif = epost(s, EP_EDIF, {"numgEdificacao": numg})
    if edif == "EXPIRED": return "EXPIRED"
    blocos = (edif or {}).get("bloco") or []
    funcs = []
    af_por_pai = {}     # numgPai -> {exigencia, situacao, prazo}  (motivo da fiscalização)
    fiscal, multas, outros = [], [], []
    for bl in blocos:
        nb = bl.get("numgBloco")
        if not nb: continue
        d = epost(s, EP_BLOCO, {"numgBloco": nb, "numgAreaEspecifica": None, "numgEmpresa": None})
        if d == "EXPIRED": return "EXPIRED"
        if not isinstance(d, dict): continue
        for grupo, lst in (d.get("autos") or {}).items():
            g = (grupo or "").upper()
            for au in (lst or []):
                if g.startswith("FISCAL"):   # Auto de Fiscalização: tem a EXIGÊNCIA (o motivo)
                    cod = au.get("codgAuto")
                    exigs, sits = [], []
                    for p in (au.get("pendenciaObra") or []):
                        desc = ((p.get("exigenciaObra") or {}).get("descExigenciaObra") or "").strip()
                        if desc: exigs.append(desc)
                        if p.get("mensagemStatus"): sits.append(p["mensagemStatus"].strip())
                    info = {"exigencia": " | ".join(dict.fromkeys(exigs)) or None,
                            "situacao":  " · ".join(dict.fromkeys(sits)) or None,
                            "prazo": au.get("dataPrazo")}
                    pai = (au.get("pai") or {}).get("numgPai")
                    if pai is not None: af_por_pai[pai] = info
                    if cod: fiscal.append((cod, info))
                elif g.startswith("INFRAC"):  # Multa: nasce de um AF não cumprido (mesmo numgPai)
                    pai = au.get("numgPai")
                    for sub in (au.get("autos") or []):
                        if sub.get("codgAuto"): multas.append((sub["codgAuto"], pai, sub.get("dataCriacao")))
                else:                          # outros tipos: guarda só o código
                    if au.get("codgAuto"): outros.append(au["codgAuto"])
                    for sub in (au.get("autos") or []):
                        if sub.get("codgAuto"): outros.append(sub["codgAuto"])
        funcs.extend(((d.get("processos") or {}).get("funcionamentos")) or [])
        time.sleep(0.3)
    # monta dicionário  código -> detalhes
    autos = {}
    for cod, info in fiscal:
        autos[cod] = {"tipo": "AF", "data": None, "situacao": info["situacao"],
                      "exigencia": info["exigencia"], "prazo": info["prazo"]}
    for cod, pai, datacri in multas:        # a multa herda o motivo/prazo da fiscalização vinculada
        af = af_por_pai.get(pai) or {}
        autos[cod] = {"tipo": "MUL", "data": datacri, "situacao": af.get("situacao") or "Multa aplicada",
                      "exigencia": af.get("exigencia"), "prazo": af.get("prazo")}
    for cod in outros:
        autos.setdefault(cod, {"tipo": _tipo(cod), "data": None, "situacao": None, "exigencia": None, "prazo": None})
    # último funcionamento válido (deferido, não cassado/anulado), mais recente por emissão
    validos = [f for f in funcs if f.get("flagDeferido") and not f.get("flagCassado")
               and not f.get("flagAnulado") and _iso(f.get("dataProtocolo"))]
    validos.sort(key=lambda f: _iso(f.get("dataProtocolo")), reverse=True)
    f0 = validos[0] if validos else None
    return {"numg": numg, "autos": autos,
            "func_emissao": _iso(f0.get("dataProtocolo")) if f0 else None,
            "func_validade": _iso(f0.get("dataValidade")) if f0 else None,
            **achado}

def main():
    res = sb("GET", "monitor_res?select=id,re_codigo,numg_edificacao,nome_edificacao&ativo=eq.true")
    if not res:
        print("Nenhuma RE monitorada (rode a migração de monitoramento e cadastre clientes/RE's)."); return
    print("Monitorando %d RE(s)..." % len(res))
    tem_validade = coluna_existe("monitor_res", "funcionamento_validade")
    if not tem_validade:
        print("  (coluna funcionamento_validade ainda nao existe -> grava so a emissao; rode o ALTER p/ a validade exata)")
    s = sessao()
    agora = datetime.now(timezone(timedelta(hours=-3))).isoformat(timespec="seconds")
    novos_total = 0
    falhas = []
    for re in res:
        r = coletar_re(s, re)
        if r == "EXPIRED":
            print("[!] SESSÃO e-SCI EXPIRADA. Faça login no Chrome e rode de novo."); break
        if r is None:
            print("  ? %-14s não encontrada no e-SCI" % re["re_codigo"]); continue
        ex = sb("GET", "monitor_autos?re_id=eq.%s&select=codigo" % re["id"]) or []
        cods = {x["codigo"] for x in ex}
        novos = 0
        for cod, det in r["autos"].items():
            campos = {"data": det.get("data"), "situacao": det.get("situacao"),
                      "exigencia": det.get("exigencia"), "prazo": det.get("prazo")}
            if cod not in cods:
                sb("POST", "monitor_autos", [{"re_id": re["id"], "tipo": det.get("tipo") or _tipo(cod),
                   "codigo": cod, "novo": True, **campos}], "resolution=ignore-duplicates")
                novos += 1
            else:  # já existe -> só preenche os detalhes (sem mexer em novo/resolvido)
                sb("PATCH", "monitor_autos?re_id=eq.%s&codigo=eq.%s" % (re["id"], quote(cod, safe="")), campos)
        novos_total += novos
        upd = {"ultima_verificacao": agora}
        if r.get("func_emissao"):  upd["funcionamento_data"] = r["func_emissao"]
        if r.get("func_validade") and tem_validade: upd["funcionamento_validade"] = r["func_validade"]
        if r.get("numg") and not re.get("numg_edificacao"): upd["numg_edificacao"] = r["numg"]
        if r.get("nome") and not re.get("nome_edificacao"): upd["nome_edificacao"] = r["nome"]
        if r.get("cidade"): upd["cidade"] = r["cidade"]
        # CONFIRMA a gravação: sem isso o coletor dizia "OK" mesmo quando o PATCH
        # falhava, e a RE ficava eternamente sem numg/funcionamento no painel.
        gravou = sb("PATCH", "monitor_res?id=eq.%s" % re["id"], upd, "return=representation")
        if not gravou:
            falhas.append(re["re_codigo"])
            print("!! %-14s LIDO do e-SCI, mas NAO GRAVOU no banco (tentando de novo)" % re["re_codigo"])
            time.sleep(1.5)
            gravou = sb("PATCH", "monitor_res?id=eq.%s" % re["id"], upd, "return=representation")
            if gravou:
                falhas.pop(); print("   -> segunda tentativa OK")
        flag = "  <<< NOVO!" if novos else ""
        if gravou:
            print("OK %-14s autos=%d (novos=%d) func.validade=%s%s" % (
                re["re_codigo"], len(r["autos"]), novos, r.get("func_validade") or "-", flag))
        time.sleep(0.4)
    print("\nFIM — %d auto(s) novo(s) no total. (%s)" % (novos_total, agora))
    if falhas:
        print("[!] %d RE NAO GRAVARAM: %s" % (len(falhas), ", ".join(falhas)))
        print("    Rode de novo; se insistir, confira a chave em privado/.env.")

if __name__ == "__main__":
    main()
