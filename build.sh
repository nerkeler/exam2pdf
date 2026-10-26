#!/bin/sh
set -e
cd "$(dirname "$0")"
python3 - <<'EOF'
from pathlib import Path

src = Path("frontend/src")
html = (src / "index.html").read_text(encoding="utf-8")

style = (src / "style.css").read_text(encoding="utf-8")
minipdf = (src / "mini-pdf.js").read_text(encoding="utf-8")
app = (src / "app.js").read_text(encoding="utf-8")
userscript = Path("frontend/exam2pdf.user.js").read_text(encoding="utf-8")

for name, content in [("minipdf", minipdf), ("app", app), ("userscript", userscript)]:
    if "</" + "script" in content:
        raise SystemExit(f"{name} 里包含 </script>，不能内联")

html = html.replace("<!--INLINE:style-->", "<style>\n" + style + "\n</style>")
html = html.replace("<!--INLINE:minipdf-->", "<script>\n" + minipdf + "\n</script>")
html = html.replace("<!--INLINE:app-->", "<script>\n" + app + "\n</script>")
html = html.replace("<!--INLINE:userscript-->", userscript)

out = Path("frontend/exam2pdf.html")
out.write_text(html, encoding="utf-8")
print("built:", out, out.stat().st_size, "bytes")
EOF
