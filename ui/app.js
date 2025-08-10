// ui/app.js – communicates with the FastAPI backend
const modelSelect = document.getElementById('modelSelect');
const chatBox     = document.getElementById('chatBox');
const prompt      = document.getElementById('prompt');
const sendBtn     = document.getElementById('sendBtn');
const uploadBtn   = document.getElementById('uploadBtn');
const fileInput   = document.getElementById('fileInput');

let conversation = [];

// --------------------------------------------------
// Render a message bubble
// --------------------------------------------------
function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    const html = content.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`);
    div.innerHTML = html;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --------------------------------------------------
// Load available models from Ollama
// --------------------------------------------------
async function loadModels() {
    const rsp = await fetch('/api/models');
    const data = await rsp.json();
    modelSelect.innerHTML = '';
    data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        modelSelect.appendChild(opt);
    });
    if (data.models.length) modelSelect.value = data.models[0];
}
loadModels();

// --------------------------------------------------
// When the selector changes, tell the backend
// --------------------------------------------------
modelSelect.addEventListener('change', async () => {
    await fetch('/api/model', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name: modelSelect.value})
    });
});

// --------------------------------------------------
// Send a user prompt
// --------------------------------------------------
async function sendPrompt() {
    const txt = prompt.value.trim();
    if (!txt) return;
    addMessage('user', txt);
    conversation.push({role:'user', content:txt});
    prompt.value = '';

    const rsp = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({messages: conversation})
    });
    const ans = await rsp.json();
    const msg = ans.choices[0].message.content;
    addMessage('assistant', msg);
    conversation.push({role:'assistant', content:msg});

    // If a Python code block was returned, add a Run button
    const codeMatch = msg.match(/```python\n([\s\S]*?)```/);
    if (codeMatch) {
        const code = codeMatch[1];
        const runBtn = document.createElement('button');
        runBtn.textContent = 'Run';
        runBtn.onclick = () => executeCode(code);
        chatBox.lastChild.appendChild(runBtn);
    }
}

// --------------------------------------------------
// Execute generated Python code (sandboxed)
// --------------------------------------------------
async function executeCode(code) {
    const rsp = await fetch('/api/execute', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({code})
    });
    const out = await rsp.json();
    const result = `Return code: ${out.returncode}
--- stdout ---
${out.stdout}
--- stderr ---
${out.stderr}`;
    addMessage('assistant', `<pre>${result}</pre>`);
}

// --------------------------------------------------
// Upload a file
// --------------------------------------------------
uploadBtn.onclick = () => fileInput.click();

fileInput.onchange = async () => {
    const file = fileInput.files[0];
    const form = new FormData();
    form.append('file', file);
    const rsp = await fetch('/api/upload', {
        method: 'POST',
        body: form
    });
    const data = await rsp.json();
    addMessage('assistant', `Uploaded <upload:${data.filename}>`);
    fileInput.value = '';
};

sendBtn.onclick = sendPrompt;
prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
});
