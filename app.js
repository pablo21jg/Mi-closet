/* =========================================================
   Mi Clóset — Fase 1
   Recomendación por reglas (sin IA): ocasión + clima + rotación
   ========================================================= */

// ---------- CONFIGURACIÓN (puedes ajustar estos valores) ----------
const CONFIG = {
  // Si el teléfono no da ubicación, se usa Ciudad de Guatemala
  ubicacionDefecto: { lat: 14.6349, lon: -90.5069, nombre: "Ciudad de Guatemala" },
  // Rango de formalidad [mín, máx] para cada ocasión
  ocasiones: {
    oficina:    { nombre: "Oficina",    rango: [2, 4] },
    obra:       { nombre: "Obra",       rango: [1, 3], obra: true },
    casual:     { nombre: "Casual",     rango: [1, 2] },
    salida:     { nombre: "Salida",     rango: [2, 4] },
    semiformal: { nombre: "Semiformal", rango: [3, 4] },
    formal:     { nombre: "Formal",     rango: [4, 5] },
  },
  // Colores que combinan con todo
  neutros: ["blanco", "negro", "gris", "azul marino", "beige", "cafe", "café", "crema", "camel"],
  // Temperatura mínima esperada → nivel de abrigo necesario
  abrigoPorTemp(tMin) {
    if (tMin < 15) return 3;   // chaqueta o suéter grueso
    if (tMin < 19) return 2;   // una capa ligera
    return 1;                  // sin capa
  },
  lluviaUmbral: 50,
  // Perfil de estilo (sacado de tus fotos de Pinterest). Se usa en las reglas y, en la Fase 2, se le envía a Gemini.
  perfilEstilo: "Smart casual / business casual. Paleta: azul marino, gris, beige/caqui, verde olivo, café, blanco y celeste. " +
    "Firma: camisa de cuello (celeste o blanca) debajo de suéter liso de cuello redondo, V o media cremallera, con el cuello asomando. " +
    "Siempre contraste claro/oscuro entre arriba y pantalón (suéter oscuro + chino beige, o suéter claro + pantalón azul marino). " +
    "Pantalones: chinos o jeans oscuros. Zapatos de cuero café (mocasines, derby, botines) o tenis blancos. Casi todo liso, pocos estampados.",
  paleta: ["azul marino", "gris", "beige", "verde", "cafe", "café", "blanco", "negro", "camel", "crema"],           // % de probabilidad para considerar "llueve"
  diasSinUsoMax: 30,          // tope para el puntaje de rotación
};

const TIPOS_BASE = ["camisa", "playera"];
const TIPOS_CAPA = ["sueter", "chaqueta"];
const NOMBRE_TIPO = {
  camisa: "camisa", playera: "playera", sueter: "suéter",
  chaqueta: "chaqueta", pantalon: "pantalón", zapatos: "zapatos",
};
const COLOR_HEX = {
  blanco: "#d9d6cf", negro: "#2b2b2b", gris: "#8a8f93", "azul marino": "#26344f",
  azul: "#4a78b0", beige: "#c9b48f", cafe: "#7a5233", "café": "#7a5233",
  verde: "#5f7a46", rojo: "#a83a32", vino: "#6e2433", amarillo: "#c9a634",
  naranja: "#c46b2c", rosado: "#c98a9a", morado: "#6c4f86", crema: "#d8ccb0", camel: "#b48a55",
};

// ---------- ESTADO (guardado en el teléfono) ----------
const CLAVE = "closet-estado-v1";
let estado = cargarEstado();
let prendas = [];
let clima = null;          // { tActual, tMin, tMax, lluvia, fuente }
let climaManual = null;    // sobreescritura del usuario
let momentoManual = "";
let ocasionSel = null;
let ranking = [];          // combinaciones ordenadas
let indiceMostrado = 0;
let mostradas = [];

function cargarEstado() {
  try {
    const e = JSON.parse(localStorage.getItem(CLAVE));
    if (e && e.usos) return e;
  } catch (_) {}
  return { usos: {}, historial: [], lavanderia: [], ultimoRespaldo: null };
}
function guardarEstado() {
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); }
  catch (e) { alert("No se pudo guardar en el teléfono: " + e.message); }
}

// ---------- UTILIDADES ----------
const $ = (s) => document.querySelector(s);
const hoyISO = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-DD
function diasDesde(fechaISO) {
  if (!fechaISO) return null;
  const ms = new Date(hoyISO()) - new Date(fechaISO);
  return Math.round(ms / 86400000);
}
function ultimoUso(id) {
  const lista = estado.usos[id];
  return lista && lista.length ? lista[lista.length - 1] : null;
}
const esNeutro = (p) => CONFIG.neutros.includes((p.color_base || "").toLowerCase());
const enLavanderia = (id) => estado.lavanderia.includes(id);
const nombrePrenda = (p) => `${NOMBRE_TIPO[p.tipo] || p.tipo} ${p.color}`;
function momentoActual() {
  if (momentoManual) return momentoManual;
  const h = new Date().getHours();
  return h < 12 ? "manana" : h < 18 ? "tarde" : "noche";
}

// ---------- CARGA DEL CATÁLOGO ----------
async function cargarPrendas() {
  const r = await fetch("prendas.json", { cache: "no-cache" });
  const datos = await r.json();
  prendas = datos.filter((p) => p.activa !== false);
}

// ---------- CLIMA (Open-Meteo, sin clave) ----------
function obtenerUbicacion() {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(CONFIG.ubicacionDefecto);
    navigator.geolocation.getCurrentPosition(
      (pos) => ok({ lat: pos.coords.latitude, lon: pos.coords.longitude, nombre: "tu ubicación" }),
      () => ok(CONFIG.ubicacionDefecto),
      { timeout: 6000, maximumAge: 3600000 }
    );
  });
}

async function cargarClima() {
  const cache = JSON.parse(localStorage.getItem("closet-clima") || "null");
  const fresco = cache && Date.now() - cache.hora < 30 * 60 * 1000;
  let datos = fresco ? cache.datos : null;
  if (!datos) {
    try {
      const u = await obtenerUbicacion();
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${u.lat}&longitude=${u.lon}` +
        `&current=temperature_2m&hourly=temperature_2m,precipitation_probability` +
        `&forecast_days=2&timezone=auto`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      datos = await r.json();
      datos._lugar = u.nombre;
      localStorage.setItem("closet-clima", JSON.stringify({ hora: Date.now(), datos }));
    } catch (e) {
      if (cache) datos = cache.datos; // sin internet: usa el último clima conocido
    }
  }
  clima = datos ? resumirClima(datos) : null;
}

// Resume las próximas horas según el momento del día
function resumirClima(d) {
  const ahora = new Date();
  const inicioH = { manana: 7, tarde: 13, noche: 19 }[momentoActual()];
  const desde = new Date(ahora);
  if (momentoManual) desde.setHours(inicioH, 0, 0, 0);
  const hasta = new Date(desde.getTime() + 9 * 3600000); // ventana de ~9 horas
  const t = [], p = [];
  d.hourly.time.forEach((iso, i) => {
    const h = new Date(iso);
    if (h >= new Date(desde.getTime() - 3600000) && h <= hasta) {
      t.push(d.hourly.temperature_2m[i]);
      p.push(d.hourly.precipitation_probability[i] ?? 0);
    }
  });
  if (!t.length) return null;
  return {
    tActual: Math.round(d.current?.temperature_2m ?? t[0]),
    tMin: Math.round(Math.min(...t)),
    tMax: Math.round(Math.max(...t)),
    lluvia: Math.max(...p),
    lugar: d._lugar || "",
  };
}

function climaEfectivo() {
  if (climaManual) return climaManual;
  return clima || { tActual: 20, tMin: 17, tMax: 24, lluvia: 0, lugar: "(sin datos, valores típicos)" };
}

function pintarClima() {
  const c = climaEfectivo();
  const m = { manana: "mañana", tarde: "tarde", noche: "noche" }[momentoActual()];
  const lluvia = c.lluvia >= CONFIG.lluviaUmbral ? ` · 🌧️ ${c.lluvia}% lluvia` : ` · lluvia ${c.lluvia}%`;
  $("#clima-texto").innerHTML =
    `<b>${c.tActual} °C</b> ahora · ${c.tMin}–${c.tMax} °C en la ${m}${lluvia}` +
    `<span class="ayuda">· ${climaManual ? "manual" : c.lugar}</span>`;
}

// ---------- MOTOR DE RECOMENDACIÓN (reglas, sin IA) ----------
function generarCombinaciones(ocasion, relajado = false) {
  const [fMin0, fMax0] = CONFIG.ocasiones[ocasion].rango;
  const fMin = relajado ? fMin0 - 1 : fMin0;
  const fMax = relajado ? fMax0 + 1 : fMax0;
  const c = climaEfectivo();
  const abrigo = CONFIG.abrigoPorTemp(c.tMin);
  const llueve = c.lluvia >= CONFIG.lluviaUmbral;

  const disponible = (p) => !enLavanderia(p.id) && p.formalidad >= fMin && p.formalidad <= fMax;
  let bases = prendas.filter((p) => TIPOS_BASE.includes(p.tipo) && disponible(p));
  // Si una categoría aún no está en el catálogo (p. ej. faltan fotos), se omite sin romper la app
  const hay = (tipo) => prendas.some((p) => p.tipo === tipo);
  let pantalones = prendas.filter((p) => p.tipo === "pantalon" && disponible(p));
  let zapatos = prendas.filter((p) => p.tipo === "zapatos" && disponible(p));
  if (llueve && zapatos.some((z) => z.lluvia === true)) zapatos = zapatos.filter((z) => z.lluvia !== false);
  // Obra: si hay prendas marcadas "obra": true en una categoría, solo se usan esas
  if (CONFIG.ocasiones[ocasion].obra) {
    const soloObra = (lista, tipo) => (prendas.some((p) => p.tipo === tipo && p.obra) ? lista.filter((p) => p.obra) : lista);
    bases = bases.filter((p) => p.obra);
    pantalones = soloObra(pantalones, "pantalon");
    zapatos = soloObra(zapatos, "zapatos");
  }
  if (!hay("pantalon")) pantalones = [null];
  if (!hay("zapatos")) zapatos = [null];

  let capas = [null];
  if (abrigo >= 2) {
    const cs = prendas.filter((p) => TIPOS_CAPA.includes(p.tipo) && disponible(p) && (p.abrigo || 2) >= 2);
    // Todas las capas son válidas; con mucho frío, las más abrigadoras solo suman puntos (así hay rotación)
    capas = cs.length ? cs : [null];
  }

  const combos = [];
  for (const b of bases) for (const pa of pantalones) for (const z of zapatos) for (const ca of capas) {
    const piezas = [b, ca, pa, z].filter(Boolean);
    const v = evaluar(piezas, b, pa, ocasion);
    if (v) {
      if (abrigo === 3 && ca && (ca.abrigo || 2) >= 3) v.puntaje += 1.5;
      combos.push({ base: b, capa: ca, pantalon: pa, zapatos: z, ...v });
    }
  }
  combos.sort((a, b) => b.puntaje - a.puntaje);
  return { combos, abrigo, llueve, faltaCapa: abrigo >= 2 && capas[0] === null };
}

function evaluar(piezas, base, pantalon, ocasion) {
  // 1) Formalidad coherente
  const forms = piezas.map((p) => p.formalidad);
  if (Math.max(...forms) - Math.min(...forms) > 2) return null;
  if (pantalon && Math.abs(base.formalidad - pantalon.formalidad) > 1) return null;
  // 2) Máximo una prenda con patrón (liso y textura no cuentan como patrón)
  if (piezas.filter((p) => !["liso", "textura"].includes(p.patron || "liso")).length > 1) return null;
  // 3) Máximo dos colores no neutros
  const colores = [...new Set(piezas.filter((p) => !esNeutro(p)).map((p) => p.color_base))];
  if (colores.length > 2) return null;

  // Puntaje de rotación: días sin usar de cada prenda (nunca usada = máximo)
  let rot = 0, masOlvidada = null, maxDias = -1;
  for (const p of piezas) {
    const d = diasDesde(ultimoUso(p.id));
    const val = d === null ? CONFIG.diasSinUsoMax : Math.min(d, CONFIG.diasSinUsoMax);
    rot += val;
    if (val > maxDias) { maxDias = val; masOlvidada = { prenda: p, dias: d }; }
  }
  let puntaje = rot / piezas.length;
  if (colores.length === 2) puntaje -= 3;
  puntaje += puntosEstilo(piezas, base, pantalon, ocasion);
  // En obra, los colores claros se ensucian: penalización (no se excluyen)
  if (CONFIG.ocasiones[ocasion].obra && ["blanco", "beige", "crema"].includes(base.color_base)) puntaje -= 8;
  // Cerca del centro del rango de la ocasión = mejor
  const [a, b] = CONFIG.ocasiones[ocasion].rango;
  const prom = forms.reduce((x, y) => x + y, 0) / forms.length;
  puntaje -= Math.abs(prom - (a + b) / 2) * 2;
  // Penaliza repetir exactamente el mismo conjunto en los últimos 14 días
  const ids = piezas.map((p) => p.id).sort().join("|");
  const repetido = estado.historial.some((h) => diasDesde(h.fecha) <= 14 && [...h.ids].sort().join("|") === ids);
  if (repetido) puntaje -= 15;
  puntaje += Math.random() * 3; // un poco de variedad
  return { puntaje, colores, prom, masOlvidada };
}

// Reglas de tu estilo: suman o restan puntos (no prohíben)
const NIVEL = { claro: 3, medio: 2, oscuro: 1 };
function puntosEstilo(piezas, base, pantalon, ocasion) {
  let pts = 0;
  const capa = piezas.find((p) => TIPOS_CAPA.includes(p.tipo));
  const zapatos = piezas.find((p) => p.tipo === "zapatos");
  const sub = (p) => (p?.subtipo || "").toLowerCase();
  // 1) Tu firma: camisa de cuello debajo de un suéter liso
  if (capa && capa.tipo === "sueter" && !sub(capa).includes("capucha")) {
    if (base.tipo === "camisa" || sub(base).includes("polo")) pts += 3;
    if (base.patron === "estampado") pts -= 4;
  }
  // 1b) Contraste entre la camisa y la capa: que el cuello se note (camisa clara bajo suéter oscuro, o al revés)
  if (capa && base.tono && capa.tono) {
    const d = Math.abs(NIVEL[base.tono] - NIVEL[capa.tono]);
    if (d >= 1) pts += 3;
    if (base.tono === "oscuro" && capa.tono === "oscuro") pts -= 5;
  }
  // El fleece y los sudaderos son deportivos: fuera de casual/obra restan
  if (capa && /fleece|capucha/.test(sub(capa)) && !["casual", "obra"].includes(ocasion)) pts -= 3;
  // 2) Contraste claro/oscuro entre lo que se ve arriba y el pantalón
  const arriba = capa || base;
  if (pantalon && pantalon.tono && arriba.tono) {
    const dif = Math.abs(NIVEL[arriba.tono] - NIVEL[pantalon.tono]);
    if (dif >= 1) pts += 2;
    if (arriba.tono === "oscuro" && pantalon.tono === "oscuro") pts -= 4;
  }
  // 3) Paleta: tus colores suman; los muy encendidos restan fuera de casual/salida
  const formal = !["casual", "salida", "obra"].includes(ocasion);
  for (const p of piezas) {
    const enPaleta = CONFIG.paleta.includes(p.color_base) || (p.color_base === "azul" && p.tono === "claro");
    if (enPaleta) pts += 0.5;
    else if (formal && ["naranja", "rojo", "amarillo", "morado"].includes(p.color_base)) pts -= 2;
  }
  // 4) Zapatos: café con azul marino/gris/beige/verde; negro no va con café o beige
  if (zapatos && pantalon) {
    if (["cafe", "café"].includes(zapatos.color_base) && ["azul marino", "gris", "beige", "verde", "azul"].includes(pantalon.color_base)) pts += 2;
    if (zapatos.color_base === "negro" && ["cafe", "café", "beige"].includes(pantalon.color_base)) pts -= 3;
  }
  return pts;
}

function avisos(c, info) {
  const a = [];
  const cl = climaEfectivo();
  if (c.capa) a.push(`🧥 mín ${cl.tMin} °C` + (cl.tMax >= 22 ? ` · máx ${cl.tMax} °C` : ""));
  else if (info.faltaCapa) a.push(`⚠️ ${cl.tMin} °C y no hay capa disponible`);
  if (info.llueve) a.push(c.zapatos && c.zapatos.lluvia === false ? `⚠️ ${cl.lluvia}% lluvia y zapatos no aptos` : `🌧️ ${cl.lluvia}% lluvia`);
  if (info.relajado) a.push(`≈ lo más cercano a ${CONFIG.ocasiones[ocasionSel].nombre.toLowerCase()}`);
  return a.map((x) => `<span>${x}</span>`).join("");
}
const art = (p) => (["pantalon", "sueter", "zapatos"].includes(p.tipo) ? (p.tipo === "zapatos" ? "los" : "el") : "la");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- INTERFAZ: HOY ----------
function pintarOcasiones() {
  const cont = $("#ocasiones");
  cont.innerHTML = "";
  for (const [clave, o] of Object.entries(CONFIG.ocasiones)) {
    const b = document.createElement("button");
    b.className = "chip" + (clave === ocasionSel ? " sel" : "");
    b.textContent = o.nombre;
    b.onclick = () => {
      ocasionSel = clave;
      try { localStorage.setItem("closet-ocasion", clave); } catch (_) {}
      pintarOcasiones(); recomendar();
    };
    cont.appendChild(b);
  }
}

let infoActual = null;
function recomendar() {
  let res = generarCombinaciones(ocasionSel);
  let relajado = false;
  if (!res.combos.length) { res = generarCombinaciones(ocasionSel, true); relajado = true; }
  infoActual = { ...res, relajado };
  ranking = res.combos;
  indiceMostrado = 0;
  mostradas = [];
  mostrarCombo();
}

function mostrarCombo() {
  const cont = $("#resultado");
  if (!ranking.length) {
    cont.innerHTML = `<div class="tarjeta aviso">No encontré una combinación válida. Revisa si tienes mucha ropa en la lavandería o si faltan prendas de este nivel de formalidad en el catálogo.</div>`;
    return;
  }
  const c = ranking[indiceMostrado];
  mostradas.push(c);
  cont.innerHTML = `
    <div class="torre">
      <div class="t-arriba${c.capa ? " doble" : ""}">${celda(c.base)}${c.capa ? celda(c.capa) : ""}</div>
      ${celda(c.pantalon, "Pantalón")}
      ${celda(c.zapatos, "Zapatos")}
    </div>
    <div class="avisos">${avisos(c, infoActual)}</div>
    <div class="acciones">
      <button class="sec" id="otra">🔄 Otra opción</button>
      <button class="pri" id="puesto">✅ Me lo puse</button>
    </div>
    <div id="post-uso"></div>`;
  $("#otra").onclick = otraOpcion;
  $("#puesto").onclick = () => meLoPuse(c);
}

// Una celda de la torre: foto de la prenda, o un hueco gris si aún no hay fotos de esa categoría
function celda(p, faltante = "") {
  if (!p) return `<div class="t vacio">${faltante}<br><small>(faltan fotos)</small></div>`;
  const hex = COLOR_HEX[(p.color_base || "").toLowerCase()] || "#999";
  return `<div class="t t-${p.tipo}" title="${nombrePrenda(p)}">
    <img src="fotos/${p.id}.jpg" alt="${nombrePrenda(p)}"
      onerror="this.outerHTML='<div class=\\'vacio\\' style=\\'background:${hex};color:#fff\\'>${p.subtipo || p.tipo}<br>${p.color}</div>'">
  </div>`;
}

// Busca la siguiente combinación que cambie al menos 2 prendas respecto a las ya mostradas
function otraOpcion() {
  const ids = (c) => [c.base, c.capa, c.pantalon, c.zapatos].filter(Boolean).map((p) => p.id);
  for (let i = indiceMostrado + 1; i < ranking.length; i++) {
    const cand = ids(ranking[i]);
    const distinta = mostradas.every((m) => cand.filter((x) => !ids(m).includes(x)).length >= 2);
    if (distinta) { indiceMostrado = i; return mostrarCombo(); }
  }
  // Se acabaron las muy distintas: vuelve a empezar
  mostradas = [];
  indiceMostrado = (indiceMostrado + 1) % ranking.length;
  mostrarCombo();
}

function meLoPuse(c) {
  const piezas = [c.base, c.capa, c.pantalon, c.zapatos].filter(Boolean);
  const hoy = hoyISO();
  for (const p of piezas) {
    estado.usos[p.id] = estado.usos[p.id] || [];
    if (ultimoUso(p.id) !== hoy) estado.usos[p.id].push(hoy);
  }
  estado.historial.unshift({ fecha: hoy, ocasion: ocasionSel, ids: piezas.map((p) => p.id) });
  guardarEstado();
  $("#puesto").disabled = true;
  $("#puesto").textContent = "Registrado ✔";
  // Sugerir mandar la prenda de arriba a lavar
  const pl = $("#post-uso");
  pl.innerHTML = `<p class="ok">¡Listo! Quedó en tu historial.</p>
    <button class="sec ancho" id="lavar-base">🧺 Mandar ${art(c.base)} ${nombrePrenda(c.base)} a la lavandería</button>`;
  $("#lavar-base").onclick = (e) => {
    if (!enLavanderia(c.base.id)) estado.lavanderia.push(c.base.id);
    guardarEstado();
    e.target.disabled = true;
    e.target.textContent = "En la lavandería 🧺";
  };
}

// ---------- INTERFAZ: CLÓSET ----------
function tarjetaPrenda(p, etiqueta = "") {
  const hex = COLOR_HEX[(p.color_base || "").toLowerCase()] || "#999";
  return `<div class="pieza${enLavanderia(p.id) ? " sucia" : ""}" data-id="${p.id}">
    <img class="foto" src="fotos/${p.id}.jpg" alt="${nombrePrenda(p)}" loading="lazy"
      onerror="this.outerHTML='<div class=\\'placeholder\\' style=\\'background:${hex}\\'>${p.subtipo || p.tipo}<br>${p.color}</div>'">
    <div class="etiqueta">${etiqueta ? `<b>${etiqueta}</b>` : ""}${p.subtipo || ""} ${p.color}</div>
  </div>`;
}

function pintarCloset() {
  const tipo = $("#filtro-tipo").value;
  const soloSucia = $("#solo-lavanderia").checked;
  const lista = prendas.filter((p) => (!tipo || p.tipo === tipo) && (!soloSucia || enLavanderia(p.id)));
  const g = $("#grid-closet");
  g.innerHTML = lista.length ? lista.map((p) => tarjetaPrenda(p)).join("") : `<p class="aviso">Nada por aquí.</p>`;
  g.querySelectorAll(".pieza").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      if (enLavanderia(id)) estado.lavanderia = estado.lavanderia.filter((x) => x !== id);
      else estado.lavanderia.push(id);
      guardarEstado();
      el.classList.toggle("sucia");
    };
  });
}

// ---------- INTERFAZ: HISTORIAL Y RESPALDO ----------
function pintarHistorial() {
  const porId = Object.fromEntries(prendas.map((p) => [p.id, p]));
  const h = estado.historial.slice(0, 60);
  $("#lista-historial").innerHTML = h.length
    ? h.map((e) => `<div class="hist-item"><b>${e.fecha} · ${CONFIG.ocasiones[e.ocasion]?.nombre || e.ocasion}</b>
        ${e.ids.map((id) => (porId[id] ? nombrePrenda(porId[id]) : id)).join(" · ")}</div>`).join("")
    : `<p class="aviso">Todavía no has registrado nada. Usa "Me lo puse" en la pestaña Hoy.</p>`;
  const u = estado.ultimoRespaldo;
  const d = diasDesde(u);
  $("#ultimo-respaldo").textContent = u ? `Último respaldo: ${u} (hace ${d} días)` : "Nunca has exportado un respaldo.";
}

function exportar() {
  estado.ultimoRespaldo = hoyISO();
  guardarEstado();
  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo-closet-${hoyISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  pintarHistorial();
}

function importar(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const e = JSON.parse(r.result);
      if (!e.usos || !e.historial) throw new Error("archivo no válido");
      if (!confirm("Esto reemplazará el historial actual del teléfono. ¿Continuar?")) return;
      estado = { lavanderia: [], ultimoRespaldo: null, ...e };
      guardarEstado();
      pintarHistorial();
      alert("Respaldo importado ✔");
    } catch (err) { alert("No se pudo importar: " + err.message); }
  };
  r.readAsText(f);
  ev.target.value = "";
}

// ---------- NAVEGACIÓN Y ARRANQUE ----------
function cambiarVista(v) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("activa", t.dataset.vista === v));
  document.querySelectorAll(".vista").forEach((s) => s.classList.toggle("oculta", s.id !== "vista-" + v));
  if (v === "closet") pintarCloset();
  if (v === "historial") pintarHistorial();
}

async function iniciar() {
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => cambiarVista(t.dataset.vista)));
  $("#filtro-tipo").onchange = pintarCloset;
  $("#solo-lavanderia").onchange = pintarCloset;
  $("#todo-limpio").onclick = () => {
    if (!estado.lavanderia.length) return;
    if (confirm(`¿Sacar ${estado.lavanderia.length} prenda(s) de la lavandería?`)) {
      estado.lavanderia = []; guardarEstado(); pintarCloset();
    }
  };
  $("#exportar").onclick = exportar;
  $("#importar").onchange = importar;
  $("#aplicar-manual").onclick = async () => {
    momentoManual = $("#momento-manual").value;
    const t = parseFloat($("#temp-manual").value);
    climaManual = isNaN(t) ? null : { tActual: t, tMin: t, tMax: t, lluvia: $("#lluvia-manual").checked ? 80 : 0, lugar: "" };
    if (!climaManual) await cargarClima();
    pintarClima();
    if (ocasionSel) recomendar();
  };
  $("#usar-auto").onclick = async () => {
    climaManual = null; momentoManual = "";
    $("#temp-manual").value = ""; $("#momento-manual").value = ""; $("#lluvia-manual").checked = false;
    await cargarClima(); pintarClima();
    if (ocasionSel) recomendar();
  };

  pintarOcasiones();
  try { await cargarPrendas(); }
  catch (e) { $("#resultado").innerHTML = `<p class="aviso">No pude cargar prendas.json: ${e.message}</p>`; }
  await cargarClima();
  pintarClima();
  // Ocasión inicial: la última que elegiste; si no hay, Oficina entre semana y Casual el fin de semana
  const guardada = localStorage.getItem("closet-ocasion");
  const dia = new Date().getDay();
  ocasionSel = CONFIG.ocasiones[guardada] ? guardada : dia === 0 || dia === 6 ? "casual" : "oficina";
  pintarOcasiones();
  recomendar();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

iniciar();
