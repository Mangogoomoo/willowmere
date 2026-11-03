"""Bundle Willowmere into one self-contained HTML file.

Usage:
    python tools/build_single_file.py            # three.js from the jsDelivr CDN
    python tools/build_single_file.py --offline  # inline lib/three.min.js too

The modular source in js/ stays the place to edit; this only produces a
shareable single file (dist/willowmere.html by default).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CDN = "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"


def build(offline=False, out=None):
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + css + "\n</style>")

    def inline(match):
        src = match.group(1)
        if src == "lib/three.min.js":
            if offline:
                return "<script>\n" + (ROOT / src).read_text(encoding="utf-8") + "\n</script>"
            return '<script src="%s"></script>' % CDN
        code = (ROOT / src).read_text(encoding="utf-8")
        return "<script>/* %s */\n%s\n</script>" % (src, code)

    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    out = Path(out) if out else ROOT / "dist" / "willowmere.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print("wrote", out, "(%d KB)" % (out.stat().st_size // 1024))


if __name__ == "__main__":
    args = sys.argv[1:]
    offline = "--offline" in args
    rest = [a for a in args if not a.startswith("--")]
    build(offline, rest[0] if rest else None)
