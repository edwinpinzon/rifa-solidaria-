/**
 * RIFA SOLIDARIA — Servidor
 * ─────────────────────────────────────────────────────
 * Rutas públicas:
 *   GET  /              → app HTML
 *   GET  /datos         → estado actual de boletas (JSON)
 *   POST /reservar      → comprador reserva un número
 *
 * Rutas de admin (requieren ?k=ADMIN_KEY):
 *   POST /admin/pagar   → confirmar pago de una boleta
 *   POST /admin/liberar → liberar una boleta
 *
 * Base de datos: Google Sheets (una fila por boleta)
 * WebSocket: actualiza a todos los clientes en tiempo real
 */

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { WebSocketServer } = require('ws');
const { google } = require('googleapis');

// ── Configuración desde variables de entorno ──────────────
const PORT        = process.env.PORT        || 3000;
const ADMIN_KEY   = process.env.ADMIN_KEY   || 'rifa2025admin';
const SHEET_ID    = process.env.SHEET_ID    || '';   // ID del Google Sheet
const GOOGLE_CREDS = process.env.GOOGLE_CREDS || ''; // JSON de credenciales como string

// ── Google Sheets ─────────────────────────────────────────
let sheetsClient = null;

async function initSheets() {
  if (!GOOGLE_CREDS || !SHEET_ID) {
    console.warn('⚠️  Sin credenciales de Google Sheets — usando memoria local');
    return false;
  }
  try {
    const creds = JSON.parse(GOOGLE_CREDS);
    const auth  = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets conectado');
    return true;
  } catch (e) {
    console.error('❌ Error conectando Google Sheets:', e.message);
    return false;
  }
}

// Rango: columnas A=num, B=estado, C=nombre, D=tel, E=timestamp
const RANGE = 'Boletas!A2:E101'; // filas 2–101 = boletas 00–99

async function leerSheets() {
  if (!sheetsClient) return null;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: RANGE
    });
    return res.data.values || [];
  } catch (e) {
    console.error('Error leyendo Sheets:', e.message);
    return null;
  }
}

async function escribirFila(idx, boleta) {
  if (!sheetsClient) return;
  const row  = idx + 2; // fila 2 = boleta 00
  const range = `Boletas!A${row}:E${row}`;
  try {
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          boleta.n,
          boleta.estado,
          boleta.nombre,
          boleta.tel,
          boleta.ts ? new Date(boleta.ts).toLocaleString('es-CO') : ''
        ]]
      }
    });
  } catch (e) {
    console.error('Error escribiendo Sheets:', e.message);
  }
}

// ── Estado en memoria (espejo del Sheet) ─────────────────
function initBoletas() {
  return Array.from({ length: 100 }, (_, i) => ({
    n:      String(i).padStart(2, '0'),
    estado: 'libre',
    nombre: '',
    tel:    '',
    ts:     null
  }));
}

let boletas = initBoletas();

async function cargarDesdeSheets() {
  const rows = await leerSheets();
  if (!rows) return;
  rows.forEach((row, i) => {
    if (i > 99) return;
    boletas[i] = {
      n:      String(i).padStart(2, '0'),
      estado: row[1] || 'libre',
      nombre: row[2] || '',
      tel:    row[3] || '',
      ts:     row[4] ? Date.now() : null
    };
  });
  console.log('📊 Datos cargados desde Google Sheets');
}

async function actualizarBoleta(idx, datos) {
  boletas[idx] = { ...boletas[idx], ...datos };
  await escribirFila(idx, boletas[idx]);
  broadcast({ tipo: 'actualizar', boleta: boletas[idx] });
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
  const url    = req.url.split('?')[0];
  const params = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  const isAdmin = params.get('k') === ADMIN_KEY;

  // CORS para desarrollo local
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── GET / → HTML
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const htmlPath = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8')
      .replace('__ADMIN_KEY_PLACEHOLDER__', ADMIN_KEY);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── GET /datos → estado público
  if (req.method === 'GET' && url === '/datos') {
    // Público: solo devuelve n y estado (sin nombre ni tel)
    const publico = boletas.map(b => ({
      n:      b.n,
      estado: b.estado
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(publico));
    return;
  }

  // ── GET /admin/datos → datos completos (admin)
  if (req.method === 'GET' && url === '/admin/datos') {
    if (!isAdmin) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(boletas));
    return;
  }

  // ── POST /reservar → público reserva un número
  if (req.method === 'POST' && url === '/reservar') {
    leerBody(req, async body => {
      try {
        const { n, nombre, tel } = JSON.parse(body);
        const idx = parseInt(n);
        if (isNaN(idx) || idx < 0 || idx > 99) throw new Error('Número inválido');
        if (!nombre || nombre.trim().length < 2)  throw new Error('Nombre requerido');
        if (boletas[idx].estado !== 'libre')       throw new Error('Ese número ya fue tomado');

        await actualizarBoleta(idx, {
          nombre: nombre.trim(),
          tel:    (tel||'').trim(),
          estado: 'reservado',
          ts:     Date.now()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, boleta: boletas[idx] }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── POST /admin/pagar → confirmar pago
  if (req.method === 'POST' && url === '/admin/pagar') {
    if (!isAdmin) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    leerBody(req, async body => {
      const { n } = JSON.parse(body);
      const idx   = parseInt(n);
      await actualizarBoleta(idx, { estado: 'vendido', ts: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── POST /admin/liberar → liberar boleta
  if (req.method === 'POST' && url === '/admin/liberar') {
    if (!isAdmin) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    leerBody(req, async body => {
      const { n } = JSON.parse(body);
      const idx   = parseInt(n);
      await actualizarBoleta(idx, { estado: 'libre', nombre: '', tel: '', ts: null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── POST /admin/reset → liberar todo
  if (req.method === 'POST' && url === '/admin/reset') {
    if (!isAdmin) { res.writeHead(403); res.end('{"error":"No autorizado"}'); return; }
    boletas = initBoletas();
    // Sobreescribir todo en Sheets
    if (sheetsClient) {
      const rows = boletas.map(b => [b.n, 'libre', '', '', '']);
      try {
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: RANGE,
          valueInputOption: 'RAW',
          requestBody: { values: rows }
        });
      } catch(e) { console.error('Error reset Sheets:', e.message); }
    }
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
  await initSheets();
  await cargarDesdeSheets();

  server.listen(PORT, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let localIP = 'localhost';
    for (const n of Object.values(nets).flat())
      if (n.family === 'IPv4' && !n.internal) { localIP = n.address; break; }

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   🌱  RIFA SOLIDARIA — Servidor activo   ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${PORT}            ║`);
    console.log(`║  Red:     http://${localIP}:${PORT}      ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Admin:   /?admin&k=${ADMIN_KEY}  ║`);
    console.log('╚══════════════════════════════════════════╝\n');
  });
}

main();