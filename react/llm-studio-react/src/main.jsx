===== src/main.jsx =====
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App.jsx";
import Chat from "./pages/Chat.jsx";
import Profiles from "./pages/Profiles.jsx";
import Files from "./pages/Files.jsx";
import Knowledge from "./pages/Knowledge.jsx";
import Models from "./pages/Models.jsx";
import ExportPage from "./pages/Export.jsx";
import Dev from "./pages/Dev.jsx";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Chat /> },
      { path: "profiles", element: <Profiles /> },
      { path: "files", element: <Files /> },
      { path: "knowledge", element: <Knowledge /> },
      { path: "models", element: <Models /> },
      { path: "export", element: <ExportPage /> },
      { path: "dev", element: <Dev /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);


===== src/App.jsx =====
import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { AppCtx } from "./lib/context";

export default function App() {
  const [provider, setProvider] = useState("…");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [useRag, setUseRag] = useState(true);
  const [profileId, setProfileId] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  async function refreshModels() {
    try {
      const d = await api.models.list();
      setProvider(d.provider);
      setModels(d.models || ["fallback-local"]);
      const cfg = await api.settings.get();
      setModel(cfg.model || d.models?.[0] || "fallback-local");
      setUseRag(!!cfg.rag_enabled);
    } catch {
      setModels(["fallback-local"]);
      setProvider("unknown");
    }
  }

  useEffect(() => {
    refreshModels();
  }, []);

  return (
    <AppCtx.Provider value={{
      provider, models, model, setModel, useRag, setUseRag,
      profileId, setProfileId, sessionId, setSessionId, refreshModels
    }}>
      <header className="hdr">
        <h1>LLM Studio — React</h1>
        <span className="pill">{provider}</span>
        <nav className="nav">
          <NavLink to="/">Chat</NavLink>
          <NavLink to="/profiles">Profiles</NavLink>
          <NavLink to="/files">Files</NavLink>
          <NavLink to="/knowledge">Knowledge</NavLink>
          <NavLink to="/models">Models</NavLink>
          <NavLink to="/export">Export</NavLink>
          <NavLink to="/dev">Developer</NavLink>
        </nav>
        <div className="right">
          <label>Model{" "}
            <select value={model} onChange={e=>setModel(e.target.value)}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </header>
      <main><Outlet/></main>
    </AppCtx.Provider>
  );
}


===== src/lib/api.js =====
const BASE = import.meta.env.VITE_API_BASE?.replace(/\/+$/,'') || "";

async function j(method, path, body, headers={}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body instanceof FormData ? headers : {"Content-Type":"application/json", ...headers},
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get("content-type")||"";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  settings: {
    get: () => j("GET","/api/settings"),
    put: (p) => j("PUT","/api/settings", p),
  },
  chat: {
    stream: async (payload, onDelta) => {
      const res = await fetch(BASE+"/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf="";
      for(;;){
        const {value,done} = await reader.read(); if(done) break;
        buf += dec.decode(value,{stream:true}); const parts = buf.split("\n\n"); buf = parts.pop();
        for(const p of parts){
          const line=p.trim(); if(!line) continue;
          if(line.startsWith("data: ")){ try{ const d=JSON.parse(line.slice(6)); onDelta(d.delta||""); }catch{} }
        }
      }
    }
  },
  models: {
    list: () => j("GET","/api/models"),
    pull: async (name, onLine) => {
      const fd = new FormData(); fd.append("name", name);
      const res = await fetch(BASE+"/api/models/pull", {method:"POST", body: fd});
      const reader = res.body.getReader(); const dec=new TextDecoder(); let buf="";
      for(;;){
        const {value,done}=await reader.read(); if(done) break;
        buf+=dec.decode(value,{stream:true}); const parts=buf.split("\n\n"); buf=parts.pop();
        for(const p of parts){ const line=p.trim(); if(!line) continue;
          if(line.startsWith("data: ")) onLine(line.slice(6));
        }
      }
    },
    delete: (name)=> j("DELETE", "/api/models/delete?name="+encodeURIComponent(name)),
  },
  files: {
    upload: (files, ingest=false) => {
      const fd=new FormData(); Array.from(files).forEach(f=>fd.append("files",f));
      return j("POST", "/api/files/upload?ingest="+(ingest?"true":"false"), fd);
    },
    list: () => j("GET","/api/files/list"),
    delete: (name)=> j("DELETE","/api/files/delete?name="+encodeURIComponent(name)),
    downloadUrl: (name)=> BASE+"/api/files/download?name="+encodeURIComponent(name),
  },
  rag: {
    docs: ()=> j("GET","/api/rag/docs"),
    addUrl: (url)=> { const fd=new FormData(); fd.append("url",url); return j("POST","/api/rag/add_url", fd); },
    reindex: ()=> j("POST","/api/rag/reindex"),
  },
  export: {
    archiveUrl: (scope,hours,inc)=> `${BASE}/api/export/archive?scope=${scope}&hours=${hours}&include_uploads=${inc?"true":"false"}`,
    chatTxtUrl: (sid)=> `${BASE}/api/export/chat/${sid}?fmt=txt`,
  },
  sessions: {
    profiles: { list:()=>j("GET","/api/profiles"), create:(name)=>j("POST","/api/profiles",{name}), del:(id)=>j("DELETE","/api/profiles/"+id) },
    sessions: { list:(pid)=>j("GET","/api/sessions?profile_id="+pid), create:(pid,title)=>j("POST","/api/sessions",{profile_id:pid,title}), rename:(sid,title)=>j("PUT","/api/sessions/"+sid,{title}), del:(sid)=>j("DELETE","/api/sessions/"+sid) },
    messages: { list:(sid)=>j("GET","/api/sessions/"+sid+"/messages"), add:(sid,role,content)=>j("POST","/api/sessions/"+sid+"/messages",{role,content}) }
  },
  dev: {
    info: (token)=> j("GET","/api/dev/info?token="+encodeURIComponent(token)),
    update: (action, token)=> j("POST", "/api/dev/update?action="+encodeURIComponent(action)+"&token="+encodeURIComponent(token)),
    restart: (token)=> j("POST","/api/dev/restart?token="+encodeURIComponent(token)),
  }
};


===== src/lib/context.js =====
import { createContext } from "react";
export const AppCtx = createContext(null);


===== src/pages/Chat.jsx =====
import { useContext, useEffect, useRef, useState } from "react";
import { AppCtx } from "../lib/context";
import { api } from "../lib/api";

export default function Chat(){
  const { model, useRag, sessionId } = useContext(AppCtx);
  const [msgs, setMsgs] = useState([{role:"system", content:"You are a helpful assistant."}]);
  const taRef = useRef();

  useEffect(()=>{ // load existing messages when session changes
    (async ()=>{
      if(!sessionId) return setMsgs([{role:"system", content:"You are a helpful assistant."}]);
      const m = await api.sessions.messages.list(sessionId);
      setMsgs([{role:"system", content:"You are a helpful assistant."}, ...(m.messages||[])]);
    })();
  }, [sessionId]);

  async function send(){
    const text = taRef.current.value.trim(); if(!text) return;
    taRef.current.value = "";
    const next = [...msgs, {role:"user", content:text}];
    setMsgs(next);
    if(sessionId) await api.sessions.messages.add(sessionId,"user",text);

    const idx = next.length;
    setMsgs(curr => [...curr, {role:"assistant", content:""}]);
    let reply = "";
    await api.chat.stream({messages: next, model, stream:true, use_rag: useRag}, d=>{
      reply += d; setMsgs(curr => { const copy=[...curr]; copy[idx]={role:"assistant", content:reply}; return copy; });
    });
    if(sessionId) await api.sessions.messages.add(sessionId,"assistant",reply);
  }

  return (
    <section className="pad">
      <div className="chatlog">
        {msgs.filter(m=>m.role!=="system").map((m,i)=>(
          <div key={i} className={"msg "+(m.role==="user"?"you":"bot")}>
            <div className="role">{m.role}</div>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
      </div>
      <div className="composer">
        <textarea ref={taRef} placeholder="Type and press Enter…" onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); }}}/>
        <label><input type="checkbox" defaultChecked={useRag} onChange={e=>{}} disabled/> RAG</label>
        <button onClick={send}>Send</button>
      </div>
    </section>
  );
}


===== src/pages/Profiles.jsx =====
import { useContext, useEffect, useState } from "react";
import { AppCtx } from "../lib/context";
import { api } from "../lib/api";
import { Link } from "react-router-dom";

export default function Profiles(){
  const { profileId, setProfileId, sessionId, setSessionId } = useContext(AppCtx);
  const [profiles, setProfiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");

  async function loadProfiles(){ const d=await api.sessions.profiles.list(); setProfiles(d.profiles||[]); }
  async function loadSessions(){ if(!profileId){ setSessions([]); return; } const d=await api.sessions.sessions.list(profileId); setSessions(d.sessions||[]); }

  useEffect(()=>{ loadProfiles(); },[]);
  useEffect(()=>{ loadSessions(); },[profileId]);

  return (
    <section className="pad">
      <h3>Profiles</h3>
      <div className="row">
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="New profile name"/>
        <button onClick={async ()=>{ if(!name) return; await api.sessions.profiles.create(name); setName(""); await loadProfiles(); }}>Create</button>
      </div>
      <table><thead><tr><th>ID</th><th>Name</th><th>Actions</th></tr></thead><tbody>
        {profiles.map(p=>(
          <tr key={p.id}>
            <td>{p.id}</td><td>{p.name}</td>
            <td>
              <button onClick={()=>{ setProfileId(p.id); setSessionId(null); }}>Select</button>{" "}
              <button onClick={async()=>{ await api.sessions.profiles.del(p.id); if(profileId===p.id){ setProfileId(null); setSessionId(null);} await loadProfiles(); }}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody></table>

      <h3 className="mt">Sessions {profileId ? `(Profile ${profileId})` : ""}</h3>
      <div className="row">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="New session title"/>
        <button disabled={!profileId} onClick={async()=>{ if(!profileId||!title) return; await api.sessions.sessions.create(profileId,title); setTitle(""); await loadSessions(); }}>Create</button>
      </div>
      <table><thead><tr><th>ID</th><th>Title</th><th>Actions</th></tr></thead><tbody>
        {sessions.map(s=>(
          <tr key={s.id}>
            <td>{s.id}</td><td>{s.title}</td>
            <td>
              <button onClick={()=> setSessionId(s.id)}>Open</button>{" "}
              <button onClick={async()=>{ const t=prompt("New title?", s.title); if(!t) return; await api.sessions.sessions.rename(s.id,t); await loadSessions(); }}>Rename</button>{" "}
              <a href={api.export.chatTxtUrl(s.id)} target="_blank" rel="noreferrer">Export</a>{" "}
              <button onClick={async()=>{ await api.sessions.sessions.del(s.id); if(sessionId===s.id) setSessionId(null); await loadSessions(); }}>Delete</button>{" "}
              <Link to="/">Go to Chat</Link>
            </td>
          </tr>
        ))}
      </tbody></table>
    </section>
  );
}


===== src/pages/Files.jsx =====
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Files(){
  const [rows, setRows] = useState([]);
  const [ingest, setIngest] = useState(false);

  async function refresh(){ const d = await api.files.list(); setRows(d.files||[]); }
  useEffect(()=>{ refresh(); },[]);

  return (
    <section className="pad">
      <div className="row">
        <input id="file" type="file" multiple onChange={(e)=> window._files = e.target.files }/>
        <label><input type="checkbox" checked={ingest} onChange={e=>setIngest(e.target.checked)} /> Ingest</label>
        <button onClick={async ()=>{ if(!window._files?.length) return; await api.files.upload(window._files, ingest); await refresh(); }}>Upload</button>
      </div>
      <table><thead><tr><th>Name</th><th>Size</th><th>Actions</th></tr></thead><tbody>
        {rows.map(r=>(
          <tr key={r.name}>
            <td>{r.name}</td><td>{r.size}</td>
            <td>
              <a href={api.files.downloadUrl(r.name)}>Download</a>{" "}
              <button onClick={async()=>{ await api.files.delete(r.name); await refresh(); }}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody></table>
    </section>
  );
}


===== src/pages/Knowledge.jsx =====
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Knowledge(){
  const [url, setUrl] = useState("");
  const [chunks, setChunks] = useState(0);
  const [docs, setDocs] = useState([]);

  async function refresh(){
    const d = await api.rag.docs();
    setChunks(d.chunks||0); setDocs(d.docs||[]);
  }
  useEffect(()=>{ refresh(); },[]);

  return (
    <section className="pad">
      <div className="row">
        <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/article"/>
        <button onClick={async()=>{ if(!url) return; await api.rag.addUrl(url); setUrl(""); await refresh(); }}>Add URL</button>
        <button onClick={async()=>{ await api.rag.reindex(); await refresh(); }}>Reindex</button>
        <span className="muted">Chunks: {chunks}</span>
      </div>
      <table><thead><tr><th>ID</th><th>Title</th></tr></thead><tbody>
        {docs.map(d=> <tr key={d.id}><td>{d.id}</td><td>{d.title}</td></tr>)}
      </tbody></table>
    </section>
  );
}


===== src/pages/Models.jsx =====
import { useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import { AppCtx } from "../lib/context";

export default function Models(){
  const { refreshModels } = useContext(AppCtx);
  const [rows, setRows] = useState([]);
  const [pull, setPull] = useState("");
  const [log, setLog] = useState("");

  async function load(){
    const d = await api.models.list();
    setRows(d.models||[]); 
  }
  useEffect(()=>{ load(); },[]);

  return (
    <section className="pad">
      <div className="row">
        <input value={pull} onChange={e=>setPull(e.target.value)} placeholder="model:tag"/>
        <button onClick={async()=>{
          setLog(""); await api.models.pull(pull, line=> setLog(s=>s + (line+"\n")));
          await load(); await refreshModels();
        }}>Pull</button>
      </div>
      <pre className="pre">{log}</pre>
      <table><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody>
        {rows.map(n=>(
          <tr key={n}><td>{n}</td>
            <td>
              <button onClick={async()=>{ await api.settings.put({model:n}); await refreshModels(); }}>Use</button>{" "}
              <button onClick={async()=>{ await api.models.delete(n); await load(); await refreshModels(); }}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody></table>
    </section>
  );
}


===== src/pages/Export.jsx =====
import { api } from "../lib/api";
import { useState } from "react";

export default function ExportPage(){
  const [scope,setScope]=useState("latest");
  const [hours,setHours]=useState(48);
  const [inc,setInc]=useState(false);
  const url = api.export.archiveUrl(scope,hours,inc);
  return (
    <section className="pad">
      <div className="row">
        <select value={scope} onChange={e=>setScope(e.target.value)}>
          <option value="latest">Latest (lookback)</option>
          <option value="all">All files</option>
        </select>
        <input type="number" value={hours} onChange={e=>setHours(Number(e.target.value))}/>
        <label><input type="checkbox" checked={inc} onChange={e=>setInc(e.target.checked)}/> Include uploads</label>
        <a className="btn" href={url}>Download</a>
      </div>
    </section>
  );
}


===== src/pages/Dev.jsx =====
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Dev(){
  const [token,setToken]=useState("");
  const [info,setInfo]=useState(null);
  const [log,setLog]=useState("");

  useEffect(()=>{ // try to fetch token exposed by backend (localhost only)
    (async()=>{ try{ const t=await (await fetch((import.meta.env.VITE_API_BASE||"")+"/ui/token")).json(); setToken(t.admin_token||""); }catch{} })();
  },[]);

  return (
    <section className="pad">
      <div className="row">
        <input value={token} onChange={e=>setToken(e.target.value)} placeholder="Admin token"/>
        <button onClick={async()=> setInfo(await api.dev.info(token))}>Load Info</button>
      </div>
      <div className="row">
        <button onClick={async()=> setLog(s=>s+"\n"+JSON.stringify(await api.dev.update("git_pull",token),null,2))}>git pull</button>
        <button onClick={async()=> setLog(s=>s+"\n"+JSON.stringify(await api.dev.update("pip_install",token),null,2))}>pip install -r</button>
        <button onClick={async()=> setLog(s=>s+"\n"+JSON.stringify(await api.dev.update("reindex",token),null,2))}>Reindex RAG</button>
        <button onClick={async()=> setLog(s=>s+"\n"+JSON.stringify(await api.dev.update("vacuum_db",token),null,2))}>VACUUM DB</button>
        <button onClick={async()=> { await api.dev.restart(token); setLog(s=>s+"\nRestarting…"); }}>Restart</button>
      </div>
      {info && <pre className="pre">{JSON.stringify(info,null,2)}</pre>}
      <pre className="pre">{log}</pre>
    </section>
  );
}


===== src/styles.css =====
:root{--bg:#0f172a;--panel:#111827;--ink:#e5e7eb;--muted:#9ca3af;--acc:#22d3ee}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.hdr{display:flex;gap:8px;align-items:center;border-bottom:1px solid #1f2937;padding:10px 16px;flex-wrap:wrap}
h1{margin:0;font-size:16px}
.pill{background:#0b1220;border:1px solid #1f2937;border-radius:999px;padding:6px 10px;color:var(--muted)}
.nav a{color:var(--ink);text-decoration:none;padding:6px 10px;border:1px solid #1f2937;border-radius:10px;background:#111827;margin-right:6px}
.nav a.active{border-color:#22d3ee}
.right{margin-left:auto}
main{min-height:calc(100vh - 60px)}
.pad{padding:16px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.mt{margin-top:16px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{border-bottom:1px solid #1f2937;padding:8px;text-align:left}
.muted{color:#9ca3af}
.btn{display:inline-block;padding:8px 10px;border:1px solid #1f2937;border-radius:10px;background:#111827;color:var(--ink);text-decoration:none}
.chatlog{padding-bottom:8px}
.msg{display:flex;gap:10px;margin:8px 0}
.role{width:80px;text-align:right;color:#22d3ee;font-weight:600}
.you .role{color:#a3e635}
.bubble{background:#0b1220;border:1px solid #1f2937;border-radius:14px;padding:10px 12px;white-space:pre-wrap;max-width:900px}
.composer{display:flex;gap:8px;align-items:center}
textarea{flex:1;min-height:56px;max-height:160px;resize:vertical;background:#0a0f1d;color:var(--ink);border:1px solid #1f2937;border-radius:12px;padding:10px}
.pre{background:#0a0f1d;border:1px solid #1f2937;border-radius:10px;padding:8px;max-height:280px;overflow:auto}
