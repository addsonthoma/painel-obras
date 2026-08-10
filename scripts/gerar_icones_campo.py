"""
Gera os icones e as telas de abertura do app Campo a partir de docs/assets/logo.png.

    python scripts/gerar_icones_campo.py

Saida em docs/campo/assets/.

Por que icone proprio: o Portal ja ocupa a tela de inicio com um icone vermelho
cheio de texto. Se o Campo usar o mesmo, o funcionario abre o errado. Aqui a
marca continua (mesmo vermelho), mas a silhueta e outra — a chama grande.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
LOGO = RAIZ / "docs" / "assets" / "logo.png"
DESTINO = RAIZ / "docs" / "campo" / "assets"

VERMELHO = (232, 74, 86)
BRANCO = (255, 255, 255)

# Telas de abertura do iOS (retrato). O Android usa o manifest e nao precisa.
SPLASHES = [
    (1179, 2556), (1170, 2532), (1284, 2778), (1290, 2796),
    (1125, 2436), (828, 1792), (750, 1334), (640, 1136),
]


def recortar_chama(logo: Image.Image) -> Image.Image:
    """A chama fica no alto, sobre o 'I' de RODRIGUES. Vira silhueta branca
    com os vaos transparentes — sobre o vermelho, os vaos mostram o fundo."""
    l, a = logo.size
    faixa = logo.crop((int(l * 0.38), 0, int(l * 0.62), int(a * 0.40))).convert("L")

    # Borda suave em vez de mascara dura: a chama tem so ~100 px no logo e vai
    # ser ampliada varias vezes. Com limiar binario o contorno sai serrilhado.
    # O vermelho da marca da ~122 em cinza; o papel, 255.
    cinza = 122
    alfa = faixa.point(lambda v: 0 if v >= 250 else
                       min(255, round((255 - v) * 255 / (255 - cinza))))

    # A chama e estreita; o topo das letras de RODRIGUES cobre a faixa inteira.
    # Corta na primeira linha em que a tinta passa de metade da largura.
    larg, alt = alfa.size
    px = alfa.load()
    corte = alt
    for y in range(alt):
        if sum(1 for x in range(larg) if px[x, y] > 128) > larg * 0.5:
            corte = y
            break
    # Recua um pouco: as primeiras linhas das letras aparecem antes de a
    # cobertura disparar, e deixariam um risco solto na base da chama.
    alfa = alfa.crop((0, 0, larg, max(1, corte - 5)))

    caixa = alfa.point(lambda v: 255 if v > 40 else 0).getbbox()
    if not caixa:
        raise SystemExit("nao encontrei a chama no logo — confira docs/assets/logo.png")

    alfa = alfa.crop(caixa)
    chama = Image.new("RGBA", alfa.size, BRANCO + (255,))
    chama.putalpha(alfa)
    return chama


def fonte(tamanho: int) -> ImageFont.FreeTypeFont:
    for caminho in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\Arial.ttf"):
        try:
            return ImageFont.truetype(caminho, tamanho)
        except OSError:
            continue
    return ImageFont.load_default()


def montar_icone(chama: Image.Image, lado: int, margem: float, rotulo: bool) -> Image.Image:
    """margem = fracao livre nas bordas. 0.10 para o icone normal,
    0.21 para o maskable (o Android recorta em circulo)."""
    img = Image.new("RGB", (lado, lado), VERMELHO)
    util = int(lado * (1 - 2 * margem))

    alt_texto = int(util * 0.20) if rotulo else 0
    alt_chama = util - alt_texto - (int(util * 0.07) if rotulo else 0)

    # thumbnail() so reduz; aqui a chama e menor que o icone e precisa crescer.
    escala = min(util / chama.width, alt_chama / chama.height)
    c = chama.resize((max(1, round(chama.width * escala)),
                      max(1, round(chama.height * escala))), Image.LANCZOS)
    topo = int(lado * margem) + (alt_chama - c.height) // 2
    img.paste(c, ((lado - c.width) // 2, topo), c)

    if rotulo:
        d = ImageDraw.Draw(img)
        f = fonte(alt_texto)
        texto = "CAMPO"
        cx, cy, dx, dy = d.textbbox((0, 0), texto, font=f)
        d.text(((lado - (dx - cx)) // 2 - cx,
                int(lado * (1 - margem)) - alt_texto - cy),
               texto, font=f, fill=BRANCO)
    return img


def montar_splash(chama: Image.Image, logo: Image.Image, l: int, a: int) -> Image.Image:
    img = Image.new("RGB", (l, a), VERMELHO)

    marca = logo.convert("RGBA")
    branca = Image.new("RGBA", marca.size, BRANCO + (0,))
    mascara = marca.convert("L").point(lambda v: 255 if v < 235 else 0)
    branca.paste(Image.new("RGBA", marca.size, BRANCO + (255,)), (0, 0), mascara)
    branca.thumbnail((int(l * 0.62), a), Image.LANCZOS)
    img.paste(branca, ((l - branca.width) // 2, (a - branca.height) // 2 - int(a * 0.03)), branca)

    d = ImageDraw.Draw(img)
    f = fonte(max(16, int(l * 0.045)))
    cx, cy, dx, dy = d.textbbox((0, 0), "CAMPO", font=f)
    d.text(((l - (dx - cx)) // 2 - cx, (a + branca.height) // 2 + int(a * 0.01)),
           "CAMPO", font=f, fill=BRANCO)
    return img


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    logo = Image.open(LOGO).convert("RGB")
    chama = recortar_chama(logo)

    saidas = {
        "icon-192.png": montar_icone(chama, 192, 0.10, True),
        "icon-512.png": montar_icone(chama, 512, 0.10, True),
        "icon-maskable-512.png": montar_icone(chama, 512, 0.21, True),
        "apple-touch-icon.png": montar_icone(chama, 180, 0.10, True),
    }
    for nome, img in saidas.items():
        img.save(DESTINO / nome)
        print(f"  {nome:<26} {img.size[0]}x{img.size[1]}")

    for l, a in SPLASHES:
        nome = f"splash-{l}x{a}.png"
        montar_splash(chama, logo, l, a).save(DESTINO / nome)
        print(f"  {nome:<26} {l}x{a}")

    # Marca branca para o cabecalho do app.
    marca = logo.convert("RGBA")
    mascara = marca.convert("L").point(lambda v: 255 if v < 235 else 0)
    branca = Image.new("RGBA", marca.size, BRANCO + (0,))
    branca.paste(Image.new("RGBA", marca.size, BRANCO + (255,)), (0, 0), mascara)
    branca.thumbnail((480, 480), Image.LANCZOS)
    branca.save(DESTINO / "marca-branca.png")
    print(f"  marca-branca.png           {branca.size[0]}x{branca.size[1]}")


if __name__ == "__main__":
    main()
