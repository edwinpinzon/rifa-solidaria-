# 🌱 Rifa Solidaria — Guía de Despliegue Completa

---

## ¿Qué vas a tener al final?

- Una URL pública tipo `https://rifa-solidaria.onrender.com`
- Cualquier persona puede entrar, ver números disponibles y reservar su boleta
- Tú entras con tu clave y ves todo: nombres, teléfonos, confirmas pagos
- Los datos se guardan en Google Sheets (abierto en tu computador)
- Todo en tiempo real 🔴

---

## PASO 1 — Crear el Google Sheet

1. Ve a https://sheets.google.com
2. Crea una hoja nueva, llámala **"Rifa Solidaria"**
3. En la pestaña de abajo (Sheet1), renómbrala a **`Boletas`**
4. En la fila 1 escribe estos encabezados (una palabra por columna):
   ```
   A1: Numero   B1: Estado   C1: Nombre   D1: Telefono   E1: Fecha
   ```
5. Copia la URL de la hoja. Tiene esta forma:
   ```
   https://docs.google.com/spreadsheets/d/AQUI_ESTA_EL_ID/edit
   ```
   Guarda ese ID (la parte larga entre `/d/` y `/edit`)

---

## PASO 2 — Crear credenciales de Google

1. Ve a https://console.cloud.google.com
2. Crea un proyecto nuevo (llámalo "rifa")
3. Busca **"Google Sheets API"** en la barra y actívala
4. Ve a **"Credenciales"** → **"Crear credenciales"** → **"Cuenta de servicio"**
5. Ponle un nombre (ej: `rifa-bot`) y crea
6. Entra a la cuenta de servicio creada → pestaña **"Claves"**
7. **Agregar clave** → **JSON** → se descarga un archivo `.json`
8. Abre ese archivo con un editor de texto, **copia TODO el contenido**

### Dar acceso al Sheet:
- En el archivo JSON que descargaste, busca el campo `"client_email"` — copia ese email
- Ve a tu Google Sheet → botón **Compartir**
- Pega ese email y dale permiso de **Editor**
- Haz clic en **Enviar**

---

## PASO 3 — Subir a GitHub

1. En tu computador, dentro de la carpeta `rifa-app`:
   ```bash
   git init
   git add .
   git commit -m "Rifa Solidaria - primera versión"
   ```
2. Ve a https://github.com → **New repository**
3. Llámalo `rifa-solidaria`, privado o público (tú decides)
4. Sigue las instrucciones que GitHub te da para subir el código

---

## PASO 4 — Desplegar en Render (gratis)

1. Ve a https://render.com y crea cuenta (puedes entrar con GitHub)
2. Click en **"New +"** → **"Web Service"**
3. Conecta tu repositorio `rifa-solidaria`
4. Configura así:
   - **Name:** `rifa-solidaria`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`

5. Antes de crear, ve a **"Environment Variables"** y agrega estas 3:

   | Variable       | Valor |
   |---------------|-------|
   | `ADMIN_KEY`   | La clave que quieras (ej: `Martha2025`) |
   | `SHEET_ID`    | El ID del Sheet que copiaste en Paso 1 |
   | `GOOGLE_CREDS`| TODO el contenido del archivo JSON (en una sola línea) |

   > 💡 Para poner el JSON en una línea: abre el archivo .json,
   > selecciona todo, copia y pégalo directo en el campo de Render.

6. Click **"Create Web Service"**
7. Render construye la app (tarda 2-3 minutos)
8. Cuando aparezca ✅ `Live`, tu URL estará lista arriba

---

## PASO 5 — Probar

Tu app tiene dos URLs:

| URL | Para quién |
|-----|-----------|
| `https://rifa-solidaria.onrender.com` | Todos — ver talonario y reservar |
| `https://rifa-solidaria.onrender.com/?k=TuClave` | Solo tú — panel admin |

### Comparte por WhatsApp:
```
🌱 RIFA SOLIDARIA 🌱
Reserva tu boleta aquí 👇
https://rifa-solidaria.onrender.com

🎟️ $10.000 · 🎁 Mercado $100.000
📅 ~25 Abril · Lotería de Boyacá
💳 Nequi/Daviplata: 321 808 6437
```

---

## PASO 6 — Tu flujo de trabajo diario

1. Alguien reserva una boleta → la ves en Google Sheets y en tu panel admin
2. Te envían el comprobante de pago por WhatsApp
3. Entras a `/?k=TuClave`, buscas el nombre, click → **"Confirmar pago"** ✅
4. La boleta cambia de 🟡 Reservado a 🟢 Vendido en tiempo real para todos

---

## ⚠️ Nota sobre el plan gratuito de Render

El plan gratuito "duerme" la app si no hay visitas en 15 minutos.
La primera visita después puede tardar 30 segundos en cargar.
Para la rifa esto está bien — si quieres que siempre esté rápida,
el plan de $7/mes en Render lo soluciona.

---

## Archivos del proyecto

```
rifa-app/
├── server.js      ← Servidor Node.js (no tocar)
├── index.html     ← La app completa
├── package.json   ← Dependencias
├── .env.example   ← Ejemplo de variables de entorno
├── .gitignore     ← Excluye .env y node_modules
└── GUIA.md        ← Este archivo
```
