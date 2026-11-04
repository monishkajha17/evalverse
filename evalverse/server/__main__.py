"""Run the EvalVerse API server.

    python -m evalverse.server
"""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = ROOT / "out" / "evalverse.db"
DEFAULT_MEDIA = ROOT / "out" / "media"


def main() -> None:
    host = os.environ.get("EVALVERSE_HOST", "127.0.0.1")
    port = int(os.environ.get("EVALVERSE_PORT", "8000"))
    db = os.environ.get("EVALVERSE_DB", str(DEFAULT_DB))
    media = os.environ.get("EVALVERSE_MEDIA_DIR", str(DEFAULT_MEDIA))
    os.environ.setdefault("EVALVERSE_DB", db)
    os.environ.setdefault("EVALVERSE_MEDIA_DIR", media)
    print(f"EvalVerse API  http://{host}:{port}")
    print(f"  db     {db}")
    print(f"  media  {media}")
    uvicorn.run(
        "evalverse.server.app:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
