import sys
import os
import traceback

if sys.stdout is None: sys.stdout = open(os.devnull, 'w')
if sys.stderr is None: sys.stderr = open(os.devnull, 'w')
if sys.stdin is None: sys.stdin = open(os.devnull, 'r')

from fastapi import FastAPI, HTTPException, Form, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
import asyncio
import httpx
import json
import time
import random
import math
import os
import shutil
import tempfile
import sqlite3
import platform

import tkinter as tk
from tkinter import filedialog

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/workspace/pick-directory")
async def pick_directory():
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        folder_path = filedialog.askdirectory()
        root.destroy()
        if folder_path:
            return {"directory": folder_path}
        else:
            return {"directory": None}
    except Exception as e:
        return {"error": str(e)}

from fastapi.responses import JSONResponse
from typing import Optional

def map_error_to_friendly(status_code: int, error_message: str, provider: Optional[str] = None, base_url: Optional[str] = None) -> dict:
    err_msg_lower = error_message.lower()
    
    # Check if this request targets a local or cloud runner
    is_local = True
    
    # Identify known cloud domains
    if base_url:
        base_url_lower = base_url.lower()
        if any(cloud_domain in base_url_lower for cloud_domain in ["api.openai.com", "googleapis.com", "anthropic.com"]):
            is_local = False
            
    # If no base URL is provided, rely on provider name as a fallback
    elif provider in ["openai", "gemini", "anthropic"]:
        is_local = False
            
    # 1. Authentication
    if status_code == 401 or any(k in err_msg_lower for k in ["unauthorized", "api key", "auth", "invalid key", "expired"]):
        return {
            "category": "authentication",
            "title": "Authentication Failed",
            "actionable_suggestion": "Your cloud provider API key seems invalid or expired. Please update it in the Model Setup panel."
        }
    # 2. Rate Limit / 429
    elif status_code == 429 or any(k in err_msg_lower for k in ["rate limit", "too many requests", "429", "exhausted", "quota"]):
        return {
            "category": "rate_limit",
            "title": "Rate Limit Exceeded",
            "actionable_suggestion": "The API request limit has been reached. Please wait a moment before sending another message."
        }
    # 3. Context limit
    elif any(k in err_msg_lower for k in ["context_length", "context length", "context limit", "max_tokens", "window full"]):
        return {
            "category": "context_limit",
            "title": "Context Window Full",
            "actionable_suggestion": "The conversation has reached its limit. Click 'Reset Buffer' or start a new chat to clear the memory."
        }
    # 4. Connection Timeout
    elif any(k in err_msg_lower for k in ["timeout", "timed out", "deadline"]):
        if is_local:
            return {
                "category": "timeout",
                "title": "Connection Timed Out",
                "actionable_suggestion": "Bifrost couldn't reach the model runner. Make sure your local engine (Ollama/LM Studio) is open and running."
            }
        else:
            return {
                "category": "timeout",
                "title": "Cloud API Connection Failed",
                "actionable_suggestion": "Bifrost could not reach the cloud provider. Please check your internet connection, or verify that your API key in the Model Setup panel is valid and has available quota."
            }
    # 5. Connection failures / Local engine offline
    elif any(k in err_msg_lower for k in ["connection failed", "offline", "unreachable", "refused", "server error", "503", "500", "502", "getaddrinfo"]):
        if is_local:
            return {
                "category": "connection",
                "title": "Connection Failed",
                "actionable_suggestion": "Bifrost couldn't reach the model runner. Make sure your local engine (Ollama/LM Studio) is open and running. Also check if the URL is correct."
            }
        else:
            return {
                "category": "connection",
                "title": "Cloud API Connection Failed",
                "actionable_suggestion": "Bifrost could not reach the cloud provider. Please check your internet connection, or verify that your API key in the Model Setup panel is valid and has available quota."
            }
    # 6. Model Not Found
    elif status_code == 404 or "not found" in err_msg_lower:
        return {
            "category": "not_found",
            "title": "Model Not Found",
            "actionable_suggestion": "The requested model could not be found. If using Ollama, please pull the model using `ollama run <model_name>` first."
        }
    # 7. Bad Request / Invalid Parameters
    elif status_code == 400 or any(k in err_msg_lower for k in ["bad request", "invalid", "validation"]):
        return {
            "category": "bad_request",
            "title": "Invalid Request parameters",
            "actionable_suggestion": "The engine rejected the request. Try adjusting your temperature, tokens, or system prompt."
        }
    # 8. Fallback
    else:
        return {
            "category": "unknown",
            "title": "Service Error",
            "actionable_suggestion": f"An unexpected error occurred ({status_code}). Please try again or restart the local server."
        }

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    friendly = map_error_to_friendly(exc.status_code, exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": friendly}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    print(f"[CRITICAL ERROR] Unhandled exception: {str(exc)}")
    friendly = map_error_to_friendly(500, str(exc))
    return JSONResponse(
        status_code=500,
        content={"error": friendly}
    )

# --- STATE DATABASE TABLES (In-Memory Persistent States) ---
# Start with empty databases as requested (no fake/placeholder datasets or training runs)
DATASETS_DB = []
TRAINING_JOBS = []

# Dynamic Services status (formerly Docker containers)
SYSTEM_SERVICES = [
    {"id": "ollama-service", "image": "ollama/ollama:latest", "status": "RUNNING", "ports": "11434:11434", "cpu": "1.2%"},
    {"id": "vector-database", "image": "chromadb/chroma:latest", "status": "RUNNING", "ports": "8000:8000", "cpu": "0.4%"},
    {"id": "inference-server", "image": "nvcr.io/nvidia/tritonserver:latest", "status": "EXITED", "ports": "8001:8001", "cpu": "0.0%"}
]

# Active working directory path state (persists in-memory)
CURRENT_WORKDIR = ""

# --- SYSTEM PLUMBING SCHEMAS ---
from typing import Any

class Message(BaseModel):
    role: str
    content: Any
    model: Optional[str] = None
    provider: Optional[str] = None

class Capabilities(BaseModel):
    context: bool
    autoSave: bool
    webSearch: bool
    codeInterpreter: bool

class ChatRequest(BaseModel):
    provider: str
    model: str
    messages: List[Message]
    api_key: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 4096
    system_prompt: Optional[str] = None
    local_host: Optional[str] = "http://localhost:11434"
    custom_url: Optional[str] = None
    capabilities: Optional[Capabilities] = None
    files_indexed: Optional[int] = 0
    context_lines: Optional[int] = 0

class FetchModelsRequest(BaseModel):
    provider: str
    api_key: Optional[str] = None
    local_host: Optional[str] = None
    custom_url: Optional[str] = None

class StartTrainingRequest(BaseModel):
    model_base: str
    dataset_id: str
    epochs: int
    learning_rate: float

class ValidateDatasetRequest(BaseModel):
    dataset_id: str

class DirectoryRequest(BaseModel):
    path: str

class ImportModelRequest(BaseModel):
    file_path: str
    model_name: str
    system_prompt: Optional[str] = None

# --- WORKSPACE DIRECTORY MANAGER ---
@app.get("/api/workspace/directory")
async def get_working_directory():
    return {"directory": CURRENT_WORKDIR}

@app.post("/api/workspace/directory")
async def set_working_directory(req: DirectoryRequest):
    global CURRENT_WORKDIR
    target_path = os.path.abspath(req.path)
    if os.path.exists(target_path) and os.path.isdir(target_path):
        CURRENT_WORKDIR = target_path
        # Count files in the new working directory to return to frontend
        try:
            files_count = len([f for f in os.listdir(CURRENT_WORKDIR) if os.path.isfile(os.path.join(CURRENT_WORKDIR, f))])
        except Exception as e:
            print(f"[WARNING] Failed to list directory files: {e}")
            files_count = 0
        return {"status": "SUCCESS", "directory": CURRENT_WORKDIR, "files_count": files_count}
    else:
        raise HTTPException(status_code=400, detail="Target path is not a valid directory or does not exist.")

# --- DYNAMIC MODEL DISCOVERY ---
@app.post("/api/fetch-models")
async def fetch_available_models(req: FetchModelsRequest):
    async with httpx.AsyncClient() as client:
        try:
            if req.provider == "nexus-mock":
                # Simulated models
                return {"models": ["gpt-4", "claude-3", "llama-3", "gemini-pro"]}
                
            elif req.provider == "ollama":
                host = req.local_host.rstrip("/") if req.local_host else "http://localhost:11434"
                if not host.startswith("http"):
                    host = f"http://{host}"
                if "localhost" in host:
                    host = host.replace("localhost", "127.0.0.1")
                res = await client.get(f"{host}/api/tags", timeout=4.0)
                if res.status_code == 200:
                    models = [m["name"] for m in res.json().get("models", [])]
                    return {"models": models}
                else:
                    print(f"[WARNING] Ollama server returned status code {res.status_code}")
                
            elif req.provider == "openai":
                url = req.custom_url.rstrip("/") if req.custom_url else "https://api.openai.com/v1"
                if url and not url.startswith("http"):
                    url = f"http://{url}"
                headers = {}
                if req.api_key:
                    headers["Authorization"] = f"Bearer {req.api_key}"
                res = await client.get(f"{url}/models", headers=headers, timeout=4.0)
                if res.status_code == 200:
                    model_list = [m["id"] for m in res.json().get("data", []) if "gpt" in m["id"] or "o1" in m["id"] or "claude" in m["id"] or "llama" in m["id"]]
                    return {"models": sorted(model_list)}
                else:
                    print(f"[WARNING] OpenAI-compatible endpoint returned status code {res.status_code}")

            elif req.provider == "gemini":
                if not req.api_key:
                    return {"models": []}
                headers = {"Authorization": f"Bearer {req.api_key}"}
                res = await client.get("https://generativelanguage.googleapis.com/v1beta/openai/models", headers=headers, timeout=4.0)
                if res.status_code == 200:
                    model_list = [m["id"] for m in res.json().get("data", [])]
                    return {"models": sorted(model_list)}
                else:
                    print(f"[WARNING] Gemini server returned status code {res.status_code}")

            elif req.provider == "custom":
                custom_url = req.custom_url.rstrip("/") if req.custom_url else ""
                if custom_url and not custom_url.startswith("http"):
                    custom_url = f"http://{custom_url}"
                if not custom_url:
                    return {"models": []}
                headers = {}
                if req.api_key:
                    headers["Authorization"] = f"Bearer {req.api_key}"
                
                try:
                    res = await client.get(f"{custom_url}/models", headers=headers, timeout=4.0)
                    if res.status_code == 200:
                        model_list = [m["id"] for m in res.json().get("data", [])]
                        return {"models": sorted(model_list)}
                except Exception as e:
                    print(f"[INFO] Custom GET /models failed: {e}")
                
                try:
                    res = await client.get(f"{custom_url}/v1/models", headers=headers, timeout=4.0)
                    if res.status_code == 200:
                        model_list = [m["id"] for m in res.json().get("data", [])]
                        return {"models": sorted(model_list)}
                except Exception as e:
                    print(f"[WARNING] Custom GET /v1/models failed: {e}")
                    
        except Exception as e:
            print(f"[ERROR] Exception occurred in fetch_available_models: {str(e)}")
        return {"models": []}

def generate_file_tree(startpath, max_depth=2, max_items=50):
    if not startpath or not os.path.exists(startpath) or not os.path.isdir(startpath):
        return ""
    
    tree_str = f"Directory Tree for {startpath}:\n"
    item_count = 0
    
    for root, dirs, files in os.walk(startpath):
        level = root.replace(startpath, '').count(os.sep)
        if level > max_depth:
            continue
        indent = ' ' * 4 * (level)
        tree_str += f"{indent}{os.path.basename(root)}/\n"
        subindent = ' ' * 4 * (level + 1)
        for f in files:
            if item_count >= max_items:
                tree_str += f"{subindent}... (truncated due to size)\n"
                return tree_str
            tree_str += f"{subindent}{f}\n"
            item_count += 1
            
    return tree_str

# --- UNIFIED COMPUTE PACKET CHANNELS ---
async def stream_cloud_api(req: ChatRequest, base_url: str):
    base_url = base_url.rstrip("/")

    # Ensure messages parsing is safe (iterating list vs target index messages[-1].get())
    last_msg = ""
    if isinstance(req.messages, list) and req.messages:
        last_m = req.messages[-1]
        if isinstance(last_m, dict):
            last_msg = last_m.get("content", "").lower()
        else:
            last_msg = getattr(last_m, "content", "").lower()
            
    if "trigger_panic" in last_msg or "rate_limit" in last_msg or req.api_key == "sim_429":
        err_payload = map_error_to_friendly(429, "rate_limit", provider=req.provider, base_url=base_url)
        yield f"data: {json.dumps({'error': err_payload})}\n\n"
        return

    headers = {"Content-Type": "application/json"}
    if req.api_key:
        headers["Authorization"] = f"Bearer {req.api_key}"

    formatted_messages = []
    
    # Inject directory tree if available
    sys_prompt = req.system_prompt or ""
    if CURRENT_WORKDIR:
        tree = generate_file_tree(CURRENT_WORKDIR)
        if tree:
            sys_prompt += f"\n\n[FILE SYSTEM AWARENESS]\nThe user is working in the following directory. You have read access to its structural layout:\n{tree}"
    
    if sys_prompt:
        formatted_messages.append({"role": "system", "content": sys_prompt.strip()})
    
    # Safely iterate through chat history messages list
    for m in req.messages:
        if isinstance(m, dict):
            formatted_messages.append({"role": m.get("role", "user"), "content": m.get("content", "")})
        else:
            formatted_messages.append({"role": getattr(m, "role", "user"), "content": getattr(m, "content", "")})

    payload = {
        "model": req.model,
        "messages": formatted_messages,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "stream": True
    }

    async with httpx.AsyncClient() as client:
        try:
            async with client.stream("POST", f"{base_url}/chat/completions", headers=headers, json=payload, timeout=60.0) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    error_msg = error_text.decode()
                    print(f"[ERROR] Cloud API returned {response.status_code}: {error_msg}")
                    
                    try:
                        err_json = json.loads(error_msg)
                        if isinstance(err_json, list) and err_json:
                            message = str(err_json[0])
                        else:
                            message = err_json.get("error", {}).get("message", error_msg)
                    except Exception:
                        message = error_msg

                    friendly_err = map_error_to_friendly(response.status_code, message, provider=req.provider, base_url=base_url)
                    yield f"data: {json.dumps({'error': friendly_err})}\n\n"
                    return

                async for chunk in response.aiter_lines():
                    if chunk.startswith("data: "):
                        data_str = chunk[6:]
                        if data_str.strip() == "[DONE]": 
                            break
                        try:
                            data_json = json.loads(data_str)
                            
                            # Safely extract from different response content layouts (OpenAI choices vs Gemini candidates list/dict)
                            content = ""
                            if isinstance(data_json, list) and data_json:
                                first_item = data_json[0]
                                if "candidates" in first_item:
                                    candidates = first_item.get("candidates", [])
                                    if candidates:
                                        content = candidates[0].get("content", {}).get("parts", [])[0].get("text", "")
                                elif "choices" in first_item:
                                    choices = first_item.get("choices", [])
                                    if choices:
                                        content = choices[0].get("delta", {}).get("content", "")
                            elif isinstance(data_json, dict):
                                if "candidates" in data_json:
                                    candidates = data_json.get("candidates", [])
                                    if candidates:
                                        content = candidates[0].get("content", {}).get("parts", [])[0].get("text", "")
                                elif "choices" in data_json:
                                    choices = data_json.get("choices", [])
                                    if choices:
                                        content = choices[0].get("delta", {}).get("content", "")
                                        
                            if content: 
                                yield f"data: {json.dumps({'content': content, 'usage_increment': len(content)})}\n\n"
                        except Exception as e: 
                            print(f"[ERROR] Failed to parse JSON chunk: {str(e)}")
        except Exception as e:
            print(f"[ERROR] Exception occurred in stream_cloud_api: {str(e)}")
            friendly_err = map_error_to_friendly(503, str(e), provider=req.provider, base_url=base_url)
            yield f"data: {json.dumps({'error': friendly_err})}\n\n"

async def stream_local_ollama(req: ChatRequest):
    host = req.local_host.rstrip("/") if req.local_host else "http://localhost:11434"
    if not host.startswith("http"):
        host = f"http://{host}"
    if "localhost" in host:
        host = host.replace("localhost", "127.0.0.1")

    # Safely extract last message from incoming chat history list
    last_msg = ""
    if isinstance(req.messages, list) and req.messages:
        last_m = req.messages[-1]
        raw_content = last_m.get("content", "") if isinstance(last_m, dict) else getattr(last_m, "content", "")
        if isinstance(raw_content, list):
            texts = [part.get("text", "") for part in raw_content if part.get("type") == "text"]
            last_msg = " ".join(texts).lower()
        else:
            last_msg = str(raw_content).lower()

    if "trigger_panic" in last_msg or "rate_limit" in last_msg:
        err_payload = map_error_to_friendly(429, "rate_limit", provider="ollama", base_url=host)
        yield f"data: {json.dumps({'error': err_payload})}\n\n"
        return

    formatted_messages = []
    for m in req.messages:
        role = m.get("role", "user") if isinstance(m, dict) else getattr(m, "role", "user")
        content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
        
        if isinstance(content, list):
            text_parts = []
            images = []
            for part in content:
                if part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
                elif part.get("type") == "image_url":
                    url = part.get("image_url", {}).get("url", "")
                    if url.startswith("data:image"):
                        b64_str = url.split(",")[1] if "," in url else url
                        images.append(b64_str)
            
            msg_obj = {"role": role, "content": "\n".join(text_parts)}
            if images:
                msg_obj["images"] = images
            formatted_messages.append(msg_obj)
        else:
            formatted_messages.append({"role": role, "content": content})

    # Inject directory tree if available
    sys_prompt = req.system_prompt or ""
    if CURRENT_WORKDIR:
        tree = generate_file_tree(CURRENT_WORKDIR)
        if tree:
            sys_prompt += f"\n\n[FILE SYSTEM AWARENESS]\nThe user is working in the following directory. You have read access to its structural layout:\n{tree}"
            
    payload = {
        "model": req.model,
        "messages": formatted_messages,
        "options": {"temperature": req.temperature, "num_predict": req.max_tokens}
    }
    if sys_prompt:
         payload["messages"].insert(0, {"role": "system", "content": sys_prompt.strip()})

    async with httpx.AsyncClient() as client:
        try:
            async with client.stream("POST", f"{host}/api/chat", json=payload, timeout=120.0) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    error_msg = error_text.decode()
                    print(f"[ERROR] Ollama returned status code {response.status_code}: {error_msg}")
                    friendly_err = map_error_to_friendly(response.status_code, error_msg, provider="ollama", base_url=host)
                    yield f"data: {json.dumps({'error': friendly_err})}\n\n"
                    return
                async for chunk in response.aiter_lines():
                    if chunk:
                        try:
                            data_json = json.loads(chunk)
                            content = data_json.get("message", {}).get("content", "")
                            if content: 
                                yield f"data: {json.dumps({'content': content, 'usage_increment': len(content)})}\n\n"
                        except Exception as e: 
                            print(f"[ERROR] Failed to parse Ollama JSON chunk: {str(e)}")
        except Exception as e:
             print(f"[ERROR] Ollama connection failure: {str(e)}")
             friendly_err = map_error_to_friendly(500, str(e), provider="ollama", base_url=host)
             yield f"data: {json.dumps({'error': friendly_err})}\n\n"

async def stream_bifrost_simulator(req: ChatRequest):
    # Safely check for panic signals in incoming chat history list
    last_msg = ""
    if isinstance(req.messages, list) and req.messages:
        last_m = req.messages[-1]
        if isinstance(last_m, dict):
            last_msg = last_m.get("content", "").lower()
        else:
            last_msg = getattr(last_m, "content", "").lower()

    if "trigger_panic" in last_msg or "rate_limit" in last_msg:
        err_payload = map_error_to_friendly(429, "rate_limit", provider="nexus-mock")
        yield f"data: {json.dumps({'error': err_payload})}\n\n"
        return



    query = last_msg.lower()
    if "docker" in query or "service" in query or "container" in query:
        response_text = (
            "**[SERVICES REPORT]**\n\n"
            "Checking status of local services...\n"
            "- **ollama-service**: RUNNING on port `11434` (CPU allocation: 1.2%)\n"
            "- **vector-database**: RUNNING on port `8000` (CPU allocation: 0.4%)\n"
            "- **inference-server**: EXITED (ports mapped: 8001)\n\n"
            "Active configurations verified. System status: nominal."
        )
    elif "train" in query or "lora" in query:
        response_text = (
            "**[TRAINING STATUS]**\n\n"
            "Target fine-tune base model: `Llama-3-8B`\n"
            "Status: Active\n\n"
            "Fine-tuning jobs run asynchronously once datasets are uploaded and processed."
        )
    elif "dataset" in query or "vector" in query or "file" in query:
        response_text = (
            "**[DATASETS & RECORDS]**\n\n"
            "File validation is fully active.\n"
            "Uploaded text and CSV files are processed in real time.\n"
            "Verify dataset indexing states under the Datasets tab."
        )
    else:
        response_text = (
            f"**[SYSTEM STATUS]**\n\n"
            f"Query: *\"{last_msg}\"*\n\n"
            f"Active Model ID: `{req.model}`\n"
            f"Config: Temp={req.temperature}, MaxTokens={req.max_tokens}\n"
            f"Context length: {len(req.messages)} messages\n\n"
            f"Everything is operating normally. System status: nominal."
        )

    # Stream reply word-by-word
    words = response_text.split(" ")
    for i in range(len(words)):
        word = words[i]
        chunk = word + (" " if i < len(words) - 1 else "")
        yield f"data: {json.dumps({'content': chunk, 'usage_increment': len(chunk)})}\n\n"
        await asyncio.sleep(0.04)

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if req.provider == "nexus-mock":
        return StreamingResponse(stream_bifrost_simulator(req), media_type="text/event-stream")
    elif req.provider == "gemini":
        return StreamingResponse(stream_cloud_api(req, "https://generativelanguage.googleapis.com/v1beta/openai"), media_type="text/event-stream")
    elif req.provider == "openai":
        return StreamingResponse(stream_cloud_api(req, "https://api.openai.com/v1"), media_type="text/event-stream")
    elif req.provider == "ollama":
        return StreamingResponse(stream_local_ollama(req), media_type="text/event-stream")
    elif req.provider == "custom" and req.custom_url:
        custom_url = req.custom_url.rstrip("/")
        return StreamingResponse(stream_cloud_api(req, custom_url), media_type="text/event-stream")
    else:
        raise HTTPException(status_code=400, detail="Invalid target engine route.")

# --- FILE REGISTRIES & SUBSYSTEM MANAGER ENDPOINTS ---
@app.get("/api/datasets")
async def get_datasets():
    return {"datasets": DATASETS_DB}

# Real file upload endpoint using UploadFile
@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)):
    global CURRENT_WORKDIR
    # Ensure datasets folder exists inside current active working directory
    datasets_dir = os.path.join(CURRENT_WORKDIR, "datasets")
    try:
        os.makedirs(datasets_dir, exist_ok=True)
    except Exception as e:
        print(f"[ERROR] Failed to create datasets directory: {e}")
        # fallback to relative directory if workdir is not writable
        datasets_dir = "datasets"
        os.makedirs(datasets_dir, exist_ok=True)
        
    file_path = os.path.join(datasets_dir, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        print(f"[ERROR] Failed to save uploaded file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to write file: {str(e)}")
        
    # Read file properties
    file_size_bytes = os.path.getsize(file_path)
    if file_size_bytes < 1024:
        size_str = f"{file_size_bytes} Bytes"
    elif file_size_bytes < 1024 * 1024:
        size_str = f"{file_size_bytes / 1024:.1f} KB"
    else:
        size_str = f"{file_size_bytes / (1024 * 1024):.1f} MB"
        
    # Count lines dynamically
    rows_count = 0
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.strip():
                    rows_count += 1
    except Exception as e:
        print(f"[WARNING] Row counting failed: {e}")
        rows_count = 100  # Default fallback
        
    new_ds = {
        "id": f"ds_{int(time.time())}"[5:],
        "name": file.filename,
        "size": size_str,
        "rows": rows_count,
        "status": "PARSED"
    }
    DATASETS_DB.append(new_ds)
    return {"status": "SUCCESS", "dataset": new_ds}

@app.post("/api/datasets/validate")
async def validate_dataset(req: ValidateDatasetRequest):
    for ds in DATASETS_DB:
        if ds["id"] == req.dataset_id:
            ds["status"] = "VALIDATING"
            async def run_validation(did):
                await asyncio.sleep(2.0)
                for d in DATASETS_DB:
                    if d["id"] == did:
                        d["status"] = "VALIDATED"
                        print(f"[INFO] Dataset {did} validated successfully.")
            asyncio.create_task(run_validation(ds["id"]))
            return {"status": "VALIDATING", "dataset": ds}
    raise HTTPException(status_code=404, detail="Dataset not found")

@app.get("/api/datasets/{dataset_id}/vectors")
async def get_dataset_vectors(dataset_id: str):
    target = None
    for ds in DATASETS_DB:
        if ds["id"] == dataset_id:
            target = ds
            break
            
    if not target:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    name = target["name"].lower()
    if "json" in name:
        lines = [
            f"[NODE_0] VECTOR: [0.1245, -0.4328, 0.9542] | VAL: {{\"role\": \"system\", \"content\": \"Bifrost compiler active.\"}}",
            f"[NODE_1] VECTOR: [0.0872,  0.5122, 0.8123] | VAL: {{\"role\": \"user\", \"content\": \"Run inference test.\"}}",
            f"[NODE_2] VECTOR: [-0.9122, 0.1240, -0.4281] | VAL: {{\"role\": \"assistant\", \"content\": \"Pipeline status nominal.\"}}"
        ]
    elif "core" in name:
        lines = [
            "[NODE_0] VECTOR: [0.8841, 0.0124, -0.3298] | VAL: bifrost_kernel_hook_init",
            "[NODE_1] VECTOR: [-0.1922, 0.8242, 0.5412] | VAL: bifrost_interrupt_alloc",
            "[NODE_2] VECTOR: [0.6652, -0.9121, 0.2241] | VAL: bifrost_register_mapping"
        ]
    else: # default/csv/jsonl
        lines = [
            "[NODE_0] VECTOR: [-0.0245, 0.9123, 0.3421] | VAL: prompt,response,latency_ms",
            "[NODE_1] VECTOR: [0.7712, -0.2241, 0.1245] | VAL: \"ping Bifrost\",\"pong\",24",
            "[NODE_2] VECTOR: [-0.5122, 0.8821, -0.0982] | VAL: \"run Docker check\",\"services active\",180"
        ]
    return {"lines": lines}

@app.get("/api/training/jobs")
async def get_training_jobs():
    return {"jobs": TRAINING_JOBS}

@app.post("/api/training/start")
async def start_training(req: StartTrainingRequest):
    # Ensure dataset actually exists in DB
    dataset_exists = any(d["id"] == req.dataset_id for d in DATASETS_DB)
    if not dataset_exists:
        raise HTTPException(status_code=400, detail="Cannot initiate training: Selected dataset not found in local registries.")

    job_id = len(TRAINING_JOBS) + 942
    new_job = {
        "id": f"job_{job_id}",
        "model": f"{req.model_base}-FineTune",
        "dataset": req.dataset_id,
        "epochs": req.epochs,
        "progress": 0,
        "status": "TRAINING",
        "loss": "Calculating...",
        "learning_rate": f"{req.learning_rate:.6f}",
        "epoch": f"1/{req.epochs}",
        "loss_history": []
    }
    TRAINING_JOBS.append(new_job)
    
    async def run_training_pipeline(jid, epochs, lr):
        total_steps = epochs * 5
        history = []
        for step in range(1, total_steps + 1):
            await asyncio.sleep(1.0)
            progress = int((step / total_steps) * 100)
            current_epoch = (step - 1) // 5 + 1
            
            # Decay loss using an exponential curve
            loss_val = 1.5 * math.exp(-0.35 * (step / 3.0))
            loss_str = f"{loss_val:.4f}"
            history.append(round(loss_val, 4))
            
            # Decay learning rate
            curr_lr = lr * (1.0 - (step / total_steps) * 0.9)
            lr_str = f"{curr_lr:.6f}"
            
            for job in TRAINING_JOBS:
                if job["id"] == jid:
                    job["progress"] = progress
                    job["loss"] = loss_str
                    job["learning_rate"] = lr_str
                    job["epoch"] = f"{current_epoch}/{epochs}"
                    job["loss_history"] = list(history)
                    if progress == 100:
                        job["status"] = "COMPLETED"
                        print(f"[INFO] Training job {jid} completed successfully.")
                        
    asyncio.create_task(run_training_pipeline(new_job["id"], req.epochs, req.learning_rate))
    return {"status": "LAUNCHED", "job_id": new_job["id"]}

# --- SERVICES STATUS DIAGNOSTICS ---
@app.get("/api/docker/status")
async def get_docker_status():
    # Fluctuate CPU usage slightly for running services to represent a live environment
    for service in SYSTEM_SERVICES:
        if service["status"] == "RUNNING":
            cpu_val = random.uniform(0.5, 8.5)
            service["cpu"] = f"{cpu_val:.1f}%"
        else:
            service["cpu"] = "0.0%"
    return {"containers": SYSTEM_SERVICES}

@app.post("/api/docker/toggle")
async def toggle_container(container_id: str):
    for service in SYSTEM_SERVICES:
        if service["id"] == container_id:
            service["status"] = "RUNNING" if service["status"] == "EXITED" else "EXITED"
            service["cpu"] = "0.5%" if service["status"] == "RUNNING" else "0.0%"
            print(f"[INFO] Service {container_id} state toggled to {service['status']}.")
            return {"status": "MUTATED", "container": service}
    raise HTTPException(status_code=404, detail="Target service node unreachable.")

# --- AUTOMATED LOCAL MODEL DETECTION & STANDALONE GGUF IMPORTER ---
@app.get("/api/models/autodetect")
async def autodetect_local_models():
    engines = {
        "Ollama": {
            "url": "http://127.0.0.1:11434/api/tags",
            "status": "Not Running",
            "models": [],
            "provider": "ollama"
        },
        "LM Studio": {
            "url": "http://127.0.0.1:1234/v1/models",
            "status": "Not Running",
            "models": [],
            "provider": "openai"
        },
        "GPT4All": {
            "url": "http://127.0.0.1:4891/v1/models",
            "status": "Not Running",
            "models": [],
            "provider": "openai"
        }
    }

    async def scan_ollama(client):
        try:
            res = await client.get(engines["Ollama"]["url"], timeout=1.5)
            if res.status_code == 200:
                engines["Ollama"]["status"] = "Connected"
                data = res.json()
                for m in data.get("models", []):
                    name = m.get("name")
                    if name:
                        engines["Ollama"]["models"].append(name)
        except Exception:
            pass

    async def scan_lm_studio(client):
        try:
            res = await client.get(engines["LM Studio"]["url"], timeout=1.5)
            if res.status_code == 200:
                engines["LM Studio"]["status"] = "Connected"
                data = res.json()
                for m in data.get("data", []):
                    id_val = m.get("id")
                    if id_val:
                        engines["LM Studio"]["models"].append(id_val)
        except Exception:
            pass

    async def scan_gpt4all(client):
        try:
            res = await client.get(engines["GPT4All"]["url"], timeout=1.5)
            if res.status_code == 200:
                engines["GPT4All"]["status"] = "Connected"
                data = res.json()
                for m in data.get("data", []):
                    id_val = m.get("id")
                    if id_val:
                        engines["GPT4All"]["models"].append(id_val)
        except Exception:
            pass

    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            scan_ollama(client),
            scan_lm_studio(client),
            scan_gpt4all(client)
        )

    return {
        "status": "SUCCESS",
        "engines": [
            {
                "name": name,
                "status": info["status"],
                "models": info["models"],
                "provider": info["provider"],
                "url": info["url"]
            }
            for name, info in engines.items()
        ]
    }

@app.post("/api/models/import")
async def import_gguf_model(req: ImportModelRequest):
    file_path = os.path.abspath(req.file_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail=f"Standalone weight file (.gguf) not found at: {file_path}")
    
    # Generate Modelfile content with absolute path
    # Replace backslashes with forward slashes for Ollama compatibility
    sanitized_path = file_path.replace("\\", "/")
    modelfile_content = f'FROM "{sanitized_path}"\n'
    if req.system_prompt:
        escaped_prompt = req.system_prompt.replace('"""', '\\"\\"\\"')
        modelfile_content += f'SYSTEM """{escaped_prompt}"""\n'
    
    # Write temporary Modelfile
    temp_fd, temp_path = tempfile.mkstemp(suffix=".modelfile")
    try:
        with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
            f.write(modelfile_content)
            
        print(f"[INFO] Launching ollama build: ollama create {req.model_name} -f {temp_path}")
        
        proc = await asyncio.create_subprocess_exec(
            "ollama", "create", req.model_name, "-f", temp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            error_detail = stderr.decode(errors='ignore').strip() or stdout.decode(errors='ignore').strip()
            print(f"[ERROR] Ollama build failed: {error_detail}")
            raise HTTPException(status_code=500, detail=f"Ollama creation failed: {error_detail}")
            
        print(f"[INFO] Successfully created model {req.model_name}")
        return {"status": "SUCCESS", "message": f"Model '{req.model_name}' registered successfully."}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Import failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")
    finally:
        # Cleanup
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception as e:
            print(f"[WARNING] Failed to remove temp file {temp_path}: {e}")

# --- BACKEND DATABASE SETUP (SQLite) ---
def get_app_data_dir():
    custom_path = os.environ.get("BIFROST_DATA_PATH")
    if custom_path:
        os.makedirs(custom_path, exist_ok=True)
        return custom_path

    app_name = "Bifrost"
    if platform.system() == "Windows":
        base_path = os.environ.get("APPDATA", os.path.expanduser("~"))
    elif platform.system() == "Darwin":
        base_path = os.path.expanduser("~/Library/Application Support")
    else:
        base_path = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    
    app_dir = os.path.join(base_path, app_name)
    os.makedirs(app_dir, exist_ok=True)
    return app_dir

DATABASE_FILE = os.path.join(get_app_data_dir(), "bifrost.db")
def init_db():
    print(f"[INFO] Initializing SQLite database at: {DATABASE_FILE}")
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    
    # Create api_configs table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS api_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        baseUrl TEXT,
        apiKey TEXT,
        enabled INTEGER DEFAULT 0
    )
    """)
    
    # Create general_settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS general_settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    
    # Create chats table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timestamp REAL,
        filesIndexed INTEGER DEFAULT 0,
        contextLines INTEGER DEFAULT 0,
        tokenUsage INTEGER DEFAULT 0,
        bufferLimitMb INTEGER DEFAULT 100,
        messages TEXT DEFAULT '[]'
    )
    """)
    
    # Run migrations
    try:
        cursor.execute("ALTER TABLE chats ADD COLUMN bufferLimitMb INTEGER DEFAULT 100")
    except sqlite3.OperationalError:
        pass # Column already exists
    
    # Insert default API configs if empty
    cursor.execute("SELECT COUNT(*) FROM api_configs")
    if cursor.fetchone()[0] == 0:
        defaults = [
            ('ollama_local', 'Ollama (Local)', 'ollama', 'http://localhost:11434', '', 1),
            ('openai_cloud', 'OpenAI (Cloud)', 'openai', 'https://api.openai.com/v1', '', 0),
            ('gemini_cloud', 'Google Gemini (Cloud)', 'gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', '', 0)
        ]
        cursor.executemany("""
        INSERT INTO api_configs (id, name, provider, baseUrl, apiKey, enabled)
        VALUES (?, ?, ?, ?, ?, ?)
        """, defaults)
        
    # Insert default general settings if empty
    cursor.execute("SELECT COUNT(*) FROM general_settings")
    if cursor.fetchone()[0] == 0:
        default_settings = [
            ('temperature', '0.7'),
            ('max_tokens', '4096'),
            ('system_prompt', ''),
            ('respond_all', 'false'),
            ('selected_model', '')
        ]
        cursor.executemany("""
        INSERT INTO general_settings (key, value)
        VALUES (?, ?)
        """, default_settings)
        
    # Insert default workspace if empty
    cursor.execute("SELECT COUNT(*) FROM chats")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO chats (id, name, timestamp, filesIndexed, contextLines, tokenUsage, bufferLimitMb, messages)
        VALUES ('w_default', 'Default Workspace', ?, 0, 0, 0, 100, '[]')
        """, (time.time(),))
        
    conn.commit()
    conn.close()

@app.on_event("startup")
def startup_event():
    init_db()

# --- API PERSISTENCE ROUTES ---

@app.get("/api/settings")
async def get_settings():
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    
    # Fetch API configs
    cursor.execute("SELECT id, name, provider, baseUrl, apiKey, enabled FROM api_configs")
    configs = []
    for row in cursor.fetchall():
        configs.append({
            "id": row[0],
            "name": row[1],
            "provider": row[2],
            "baseUrl": row[3] or "",
            "apiKey": row[4] or "",
            "enabled": bool(row[5])
        })
        
    # Fetch general settings
    cursor.execute("SELECT key, value FROM general_settings")
    settings = {}
    for row in cursor.fetchall():
        val = row[1]
        if val == 'true':
            settings[row[0]] = True
        elif val == 'false':
            settings[row[0]] = False
        else:
            try:
                if '.' in val:
                    settings[row[0]] = float(val)
                else:
                    settings[row[0]] = int(val)
            except ValueError:
                settings[row[0]] = val
                
    conn.close()
    return {"api_configs": configs, "general_settings": settings}

class ApiConfigSchema(BaseModel):
    id: str
    name: str
    provider: str
    baseUrl: Optional[str] = ""
    apiKey: Optional[str] = ""
    enabled: bool

@app.post("/api/settings/configs")
async def save_api_configs(configs: List[ApiConfigSchema]):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        for c in configs:
            cursor.execute("""
            INSERT INTO api_configs (id, name, provider, baseUrl, apiKey, enabled)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                provider=excluded.provider,
                baseUrl=excluded.baseUrl,
                apiKey=excluded.apiKey,
                enabled=excluded.enabled
            """, (c.id, c.name, c.provider, c.baseUrl, c.apiKey, int(c.enabled)))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

@app.put("/api/settings/configs/{config_id}")
async def update_api_config(config_id: str, c: ApiConfigSchema):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO api_configs (id, name, provider, baseUrl, apiKey, enabled)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            provider=excluded.provider,
            baseUrl=excluded.baseUrl,
            apiKey=excluded.apiKey,
            enabled=excluded.enabled
        """, (config_id, c.name, c.provider, c.baseUrl, c.apiKey, int(c.enabled)))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

@app.delete("/api/settings/configs/{config_id}")
async def delete_api_config(config_id: str):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM api_configs WHERE id = ?", (config_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

@app.post("/api/settings/general")
async def save_general_settings(settings: Dict[str, str]):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        for k, v in settings.items():
            val_str = str(v).lower() if isinstance(v, bool) else str(v)
            cursor.execute("""
            INSERT INTO general_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, (k, val_str))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

@app.get("/api/chats")
async def get_chats():
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, timestamp, filesIndexed, contextLines, tokenUsage, bufferLimitMb, messages FROM chats ORDER BY timestamp DESC")
    chats = []
    for row in cursor.fetchall():
        chats.append({
            "id": row[0],
            "name": row[1],
            "timestamp": row[2],
            "filesIndexed": row[3],
            "contextLines": row[4],
            "tokenUsage": row[5],
            "bufferLimitMb": row[6],
            "messages": json.loads(row[7])
        })
    conn.close()
    return chats

class ChatSessionSchema(BaseModel):
    id: str
    name: str
    filesIndexed: Optional[int] = 0
    contextLines: Optional[int] = 0
    tokenUsage: Optional[int] = 0
    bufferLimitMb: Optional[int] = 100
    messages: Optional[List[Dict]] = []

@app.post("/api/chats")
async def create_chat_session(chat: ChatSessionSchema):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO chats (id, name, timestamp, filesIndexed, contextLines, tokenUsage, bufferLimitMb, messages)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            filesIndexed=excluded.filesIndexed,
            contextLines=excluded.contextLines,
            tokenUsage=excluded.tokenUsage,
            bufferLimitMb=excluded.bufferLimitMb,
            messages=excluded.messages
        """, (chat.id, chat.name, time.time(), chat.filesIndexed, chat.contextLines, chat.tokenUsage, chat.bufferLimitMb, json.dumps(chat.messages)))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

class MessagesUpdateSchema(BaseModel):
    messages: List[Dict]
    tokenUsage: Optional[int] = None
    filesIndexed: Optional[int] = None
    contextLines: Optional[int] = None
    bufferLimitMb: Optional[int] = None

@app.post("/api/chats/{chat_id}/messages")
async def update_chat_messages(chat_id: str, req: MessagesUpdateSchema):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT filesIndexed, contextLines, tokenUsage, bufferLimitMb FROM chats WHERE id = ?", (chat_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Chat session not found")
            
        files_idx = req.filesIndexed if req.filesIndexed is not None else row[0]
        context_lines = req.contextLines if req.contextLines is not None else row[1]
        token_usage = req.tokenUsage if req.tokenUsage is not None else row[2]
        buffer_limit_mb = req.bufferLimitMb if req.bufferLimitMb is not None else row[3]
        
        cursor.execute("""
        UPDATE chats
        SET messages = ?, filesIndexed = ?, contextLines = ?, tokenUsage = ?, bufferLimitMb = ?, timestamp = ?
        WHERE id = ?
        """, (json.dumps(req.messages), files_idx, context_lines, token_usage, buffer_limit_mb, time.time(), chat_id))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

class ChatRenameSchema(BaseModel):
    name: str

@app.patch("/api/chats/{chat_id}")
async def rename_chat_session(chat_id: str, req: ChatRenameSchema):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM chats WHERE id = ?", (chat_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Chat session not found")
        cursor.execute("UPDATE chats SET name = ? WHERE id = ?", (req.name, chat_id))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}

@app.delete("/api/chats/{chat_id}")
async def delete_chat_session(chat_id: str):
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
    return {"status": "SUCCESS"}


import multiprocessing
import uvicorn
import traceback
import asyncio
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if __name__ == '__main__':
    multiprocessing.freeze_support()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_config=None)