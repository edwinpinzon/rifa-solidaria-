/**
 * RIFA SOLIDARIA — Servidor
 * ─────────────────────────────────────────────────────
 * Persistencia: Google Sheets via Apps Script (doGet/doPost)
 * Los datos sobreviven reinicios de Render.
 *
 * Variables de entorno necesarias:
 *   ADMIN_KEY      → clave del panel admin
 *   APPS_SCRIPT_URL → URL de tu Apps Script publicado
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT            = process.env.PORT            || 3000;
const ADMIN_KEY       = process.env.ADMIN_KEY       || 'rifa2025admin';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';

// ── Sesiones admin ────────────────────────────────────────
const sessions = new Map();

function crearToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  return token;
}

function tokenValido(req) {
  const token = req.headers['x-token'] || '';
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) { sessions.delete(token); return false; }
  return true;
}

// ── Apps Script API ───────────────────────────────────────
async function scriptGet() {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const res  = await fetch(APPS_SCRIPT_URL, { redirect: 'follow' });
    const data = await res.json();
    return data.ok ? data.boletas : null;
  } catch (e) {
    console.error('Error leyendo Apps Script:', e.message);
    return null;
  }
}

async function scriptPost(body) {
  if (!APPS_SCRIPT_URL) return { ok: false, error: 'Sin Apps Script URL' };
  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method:   'POST',
      redirect: 'follow',
      headers:  { 'Content-Type': 'application/json' },
      body:     JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error('Error escribiendo Apps Script:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Estado en memoria (espejo del Sheet) ──────────────────
function initBoletas() {
  return Array.from({ length: 100 }, (_, i) => ({
    n: String(i).padStart(2, '0'), estado: 'libre',
    nombre: '', tel: '', ts: null
  }));
}

let boletas = initBoletas();

async function cargarDesdeScript() {
  const data = await scriptGet();
  if (!data || !Array.isArray(data)) {
    console.warn('⚠️  Sin datos de Apps Script — usando memoria vacía');
    return;
  }
  boletas = data;
  console.log('📊 Datos cargados desde Google Sheets via Apps Script');
}

// ── WebSocket ─────────────────────────────────────────────
const server  = http.createServer(handleRequest);
const wss     = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ tipo: 'init', boletas }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(msg) {
  const txt = JSON.stringify(msg);
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(txt); });
}

// ── HTTP ──────────────────────────────────────────────────
async function handleRequest(req, res) {
  const url = req.url.split('?')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET / → HTML
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // GET /datos → público
  if (req.method === 'GET' && url === '/datos') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(boletas.map(b => ({ n: b.n, estado: b.estado }))));
    return;
  }

  // POST /admin/login
  if (req.method === 'POST' && url === '/admin/login') {
    leerBody(req, body => {
      try {
        const { clave } = JSON.parse(body);
        if (clave === ADMIN_KEY) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, token: crearToken() }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Clave incorrecta' }));
        }
      } catch { res.writeHead(400); res.end('{"ok":false}'); }
    });
    return;
  }

  // GET /admin/datos
  if (req.method === 'GET' && url === '/admin/datos') {
    if (!tokenValido(req)) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(boletas));
    return;
  }

  // POST /reservar → público
  if (req.method === 'POST' && url === '/reservar') {
    leerBody(req, async body => {
      try {
        const { n, nombre, tel } = JSON.parse(body);
        const idx = parseInt(n);
        if (isNaN(idx) || idx < 0 || idx > 99) throw new Error('Número inválido');
        if (!nombre || nombre.trim().length < 2)  throw new Error('Nombre requerido');
        if (boletas[idx].estado !== 'libre')       throw new Error('Ese número ya fue tomado');

        // Guardar en Sheets via Apps Script
        const r = await scriptPost({ accion: 'reservar', n, nombre, tel });
        if (!r.ok) throw new Error(r.error || 'Error guardando');

        // Actualizar memoria
        boletas[idx] = r.boleta;
        broadcast({ tipo: 'actualizar', boleta: boletas[idx] });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, boleta: boletas[idx] }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /admin/pagar
  if (req.method === 'POST' && url === '/admin/pagar') {
    if (!tokenValido(req)) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    leerBody(req, async body => {
      const { n } = JSON.parse(body);
      const idx   = parseInt(n);
      await scriptPost({ accion: 'pagar', n, key: ADMIN_KEY });
      boletas[idx].estado = 'vendido';
      boletas[idx].ts     = Date.now();
      broadcast({ tipo: 'actualizar', boleta: boletas[idx] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // POST /admin/liberar
  if (req.method === 'POST' && url === '/admin/liberar') {
    if (!tokenValido(req)) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    leerBody(req, async body => {
      const { n } = JSON.parse(body);
      const idx   = parseInt(n);
      await scriptPost({ accion: 'liberar', n, key: ADMIN_KEY });
      boletas[idx] = { n: String(idx).padStart(2,'0'), estado:'libre', nombre:'', tel:'', ts:null };
      broadcast({ tipo: 'actualizar', boleta: boletas[idx] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // POST /admin/reset
  if (req.method === 'POST' && url === '/admin/reset') {
    if (!tokenValido(req)) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    await scriptPost({ accion: 'reset', key: ADMIN_KEY });
    boletas = initBoletas();
    broadcast({ tipo: 'init', boletas });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404); res.end('Not found');
}

function leerBody(req, cb) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => cb(body));
}

// ── Arrancar ──────────────────────────────────────────────
async function main() {
  console.log('🔄 Cargando datos desde Google Sheets...');
  await cargarDesdeScript();

  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   🌱  RIFA SOLIDARIA — Servidor activo   ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  http://localhost:${PORT}                     ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log(APPS_SCRIPT_URL
      ? '║  ✅ Apps Script conectado                ║'
      : '║  ⚠️  Sin APPS_SCRIPT_URL                 ║');
    console.log('╚══════════════════════════════════════════╝\n');
  });
}

main();
