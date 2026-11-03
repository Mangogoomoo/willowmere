"""Bundle Willowmere into one self-contained HTML file.

Usage:
    python tools/build_single_file.py            # three.js from the jsDelivr CDN
    python tools/build_single_file.py --offline  # inline lib/three.min.js too
    python tools/build_single_file.py --db out.html   # bundle the database page
    python tools/build_single_file.py --db-url=URL    # point the game's Database button at URL
    python tools/build_single_file.py --db --game-url=URL out.html  # database "Back to game" link

The modular source in js/ stays the place to edit; this only produces a
shareable single file (dist/willowmere.html by default).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CDN = "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"


def build(offline=False, out=None, page="index.html", db_url=None, game_url=None):
    html = (ROOT / page).read_text(encoding="utf-8")
    if game_url:
        html = html.replace('href="index.html"', 'href="%s"' % game_url)

    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + css + "\n</style>")

    def inline(match):
        src = match.group(1)
        if src == "lib/three.min.js":
            if offline:
                return "<script>\n" + (ROOT / src).read_text(encoding="utf-8") + "\n</script>"
            return '<script src="%s"></script>' % CDN
        code = (ROOT / src).read_text(encoding="utf-8")
        if db_url and src == "js/core/config.js":
            code = code.replace("DB_URL: 'db.html'", "DB_URL: '%s'" % db_url)
        return "<script>/* %s */\n%s\n</script>" % (src, code)

    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    out = Path(out) if out else ROOT / "dist" / "willowmere.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print("wrote", out, "(%d KB)" % (out.stat().st_size // 1024))


if __name__ == "__main__":
    args = sys.argv[1:]
    offline = "--offline" in args
    page = "db.html" if "--db" in args else "index.html"
    db_url = next((a.split("=", 1)[1] for a in args if a.startswith("--db-url=")), None)
    game_url = next((a.split("=", 1)[1] for a in args if a.startswith("--game-url=")), None)
    rest = [a for a in args if not a.startswith("--")]
    build(offline, rest[0] if rest else None, page, db_url, game_url)
