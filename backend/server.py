# backend/server.py
import re
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from . import utils

app = FastAPI(
    title="LLM‑Studio Backend",
    description="Local LLM router + file upload/download + code execution",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AVAILABLE_MODELS = utils.list_available_models()
CURRENT_MODEL = AVAILABLE_MODELS[0] if AVAILABLE_MODELS else "llama2"

def _inject_file_refs(message: str) -> str:
    def repl(m):
        fname = m.group(1)
        fpath = utils.UPLOAD_DIR / fname
        if not fpath.is_file():
            return f"<missing file {fname}>"
        content = fpath.read_text(errors="ignore")[:200_000]
        return f"<file:{fname}>\\n{content}\\n</file:{fname}>"
    return re.sub(r"<upload:([^>]+)>", repl, message)

@app.get("/api/models")
def get_models():
    return {"models": utils.list_available_models()}

@app.post("/api/model")
def set_model(payload: dict = Body(...)):
    global CURRENT_MODEL
    name = payload.get("name")
    if not name or name not in utils.list_available_models():
        raise HTTPException(status_code=400, detail="Model not found")
    CURRENT_MODEL = name
    return {"status": "ok", "model": CURRENT_MODEL}

@app.post("/api/chat")
def chat_endpoint(payload: dict = Body(...)):
    messages = payload.get("messages", [])
    temperature = payload.get("temperature", 0.7)
    max_tokens = payload.get("max_tokens", 1024)

    for msg in messages:
        if msg["role"] == "user":
            msg["content"] = _inject_file_refs(msg["content"])

    response = utils.chat_with_model(
        model=CURRENT_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    dest = utils.UPLOAD_DIR / file.filename
    with dest.open("wb") as out:
        while chunk := await file.read(64 * 1024):
            out.write(chunk)
    return {"filename": file.filename, "size": dest.stat().st_size}

@app.get("/api/download/{filename}")
def download_file(filename: str):
    fpath = utils.UPLOAD_DIR / filename
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=fpath, filename=filename, media_type="application/octet-stream")

@app.post("/api/execute")
def execute_code(payload: dict = Body(...)):
    code = payload.get("code", "")
    if not code.strip():
        raise HTTPException(status_code=400, detail="Empty code")
    rc, out, err = utils.run_python_code(code)
    return {"returncode": rc, "stdout": out, "stderr": err}

if __name__ == "__main__":
    uvicorn.run(
        "backend.server:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=False,
    )
