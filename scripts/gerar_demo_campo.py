"""
Gera o beta de arquivo unico da pagina /campo/ — o que se manda para o
Henrique abrir no celular sem precisar de servidor, login ou banco.

    python scripts/gerar_demo_campo.py

Le docs/campo/{index.html,campo.css,campo.js}, embute CSS e JS, e escreve
o resultado onde for pedido (padrao: ao lado, campo-beta.html).

Fonte unica: nao existe copia paralela do app. Mexeu em docs/campo/,
roda de novo e o beta acompanha.
"""
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CAMPO = RAIZ / "docs" / "campo"


def main() -> int:
    destino = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else CAMPO / "campo-beta.html"

    html = (CAMPO / "index.html").read_text(encoding="utf-8")
    css = (CAMPO / "campo.css").read_text(encoding="utf-8")
    js = (CAMPO / "campo.js").read_text(encoding="utf-8")

    if "const CAMPO_DEMO = true" not in js:
        print("AVISO: CAMPO_DEMO nao esta em true — o beta vai tentar falar com o Supabase.")

    # Fica so o miolo do <body>: o publicador ja envolve com html/head/body.
    corpo = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    corpo = re.sub(r'\s*<script src="campo\.js"></script>', "", corpo)

    saida = f"<style>\n{css}\n</style>\n{corpo.strip()}\n<script>\n{js}\n</script>\n"

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(saida, encoding="utf-8")
    print(f"gerado: {destino}  ({len(saida) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
