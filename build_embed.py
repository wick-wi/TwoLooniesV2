"""Build script: build React app, copy to public/, and embed index.html for Vercel."""
import subprocess
import sys
from pathlib import Path

def main():
    root = Path(__file__).parent
    frontend = root / "frontend"
    public = root / "public"
    
    # 1. Build React app
    print("Building React app...")
    result = subprocess.run(
        "npm ci && npm run build",
        cwd=frontend,
        shell=True,
    )
    if result.returncode != 0:
        sys.exit(1)
    
    # 2. Copy to public
    build_dir = frontend / "build"
    public.mkdir(exist_ok=True)
    for f in build_dir.iterdir():
        if f.is_file():
            (public / f.name).write_bytes(f.read_bytes())
        else:
            dest = public / f.name
            dest.mkdir(exist_ok=True)
            for sf in f.rglob("*"):
                if sf.is_file():
                    rel = sf.relative_to(f)
                    (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                    (dest / rel).write_bytes(sf.read_bytes())
    
    # 3. Embed index.html (fallback when public/ not in function bundle)
    index_path = public / "index.html"
    if index_path.exists():
        html_repr = repr(index_path.read_text(encoding="utf-8"))
        (root / "embedded_index.py").write_text(
            f"# Auto-generated - do not edit\nINDEX_HTML = {html_repr}\n",
            encoding="utf-8",
        )
        print("Embedded index.html")
    print("Build complete.")

if __name__ == "__main__":
    main()
