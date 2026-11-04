/* NASH — la app: rutas por hash, el pensum de tu carrera, cada materia con su material, subir sin repetir
   (no entra dos veces el mismo parcial), mis aportes y las estadísticas del banco.
   Todo dato que llega del servidor se escapa antes de pintarse. */
(function () {
  const N = window.NASH;
  const A = N.auth;
  const API = N.api;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const vista = $("#vista");

  // ---------- utilidades ----------
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("es-CO");
  const plural = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const diaBog = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
  const hoy = () => API.hoyISO();
  /** "2026-04-25T21:40:00Z" → "2026-04-25" en hora de Bogotá */
  const dia = (iso) => (!iso ? "" : iso.length > 10 ? diaBog.format(new Date(iso)) : iso);
  function fechaCorta(iso) {
    if (!iso) return "—";
    const [a, m, d] = dia(iso).split("-").map(Number);
    return `${d} ${MESES[m - 1]}` + (String(a) !== hoy().slice(0, 4) ? ` ${a}` : "");
  }
  function fechaLarga(iso) {
    const s = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z")).replace(",", "");
    return s[0].toUpperCase() + s.slice(1);
  }
  function saludo() {
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  }
  function peso(b) {
    if (!b) return "—";
    return b >= 1048576 ? (b / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  }
  const ext = (it) => ({ "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" }[it.archivo_tipo] || "Archivo");
  const iniciales = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const avatar = (nombre, propio) => `<span class="avatar${propio ? " propio" : ""}" aria-hidden="true">${esc(iniciales(nombre))}</span>`;
  const icono = (id) => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const etiqueta = (it) => `${N.tipoPorId[it.tipo].numero.replace(" n.º", "")} ${it.numero}`;
  const nombreMateria = (m, corto) => `${m.codigo ? m.codigo + " " : ""}${corto && m.corto ? m.corto : m.nombre}`;
  const mat = (it) => N.materiaDe(it);
  const nombreCarrera = (id, largo) => (id === "nucleo" ? "Núcleo rosarista" : N.carreraPorId[id] ? N.carreraPorId[id][largo ? "nombre" : "corto"] : id);
  const ubicacion = (m) => (m.nucleo ? "Núcleo rosarista" : m.dinamica ? "Agregada por estudiantes" : "Semestre " + N.ROMANOS[m.semestre]);
  const mayus = (s) => s[0].toUpperCase() + s.slice(1);
  const yo = () => A.sesion() || {};
  const esMio = (it) => it.autor_id === yo().sub;
  const miCarrera = () => (N.carreraPorId[A.carrera()] ? A.carrera() : "");
  function detalles(it) {
    const partes = [];
    if (it.tipo !== "apuntes") partes.push(it.con_solucion ? "Con solución" : "Sin solución");
    partes.push(`${ext(it)} · ${peso(it.archivo_bytes)}`);
    return partes.join(" · ");
  }
  /** <option> de las carreras, agrupadas por facultad */
  const opcionesCarrera = (sel) => N.FACULTADES.map((f) => `<optgroup label="${esc(f)}">${N.CARRERAS.filter((c) => c.facultad === f).map((c) => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</optgroup>`).join("");

  // ---------- datos (una lista por sesión, se refresca al subir o descargar) ----------
  let cache = null, cacheT = 0;
  function lista(forzar) {
    if (!forzar && cache && Date.now() - cacheT < 60000) return cache;
    cacheT = Date.now();
    cache = API.listar({}).then((r) => { const l = r.items || []; N.registrar(l); return l; }).catch((e) => { cache = null; throw e; });
    return cache;
  }
  const invalidar = () => { cache = null; };

  // ---------- avisos flotantes ----------
  function toast(texto, tipo) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = icono(tipo === "neg" ? "alerta" : "check") + "<span></span>";
    t.querySelector("span").textContent = texto;
    $("#toasts").appendChild(t);
    setTimeout(() => { t.classList.add("sale"); setTimeout(() => t.remove(), 200); }, tipo === "largo" ? 7000 : 4500);
  }

  // ---------- estados ----------
  const sk = (w, h) => `<span class="skeleton" style="width:${w};height:${h || 14}px"></span>`;
  const filasCargando = (n) => `<div class="feed">${Array.from({ length: n }, () => `<div class="feed-row" aria-hidden="true"><div style="display:grid;gap:8px">${sk("62%")}${sk("40%", 12)}</div>${sk("48px")}</div>`).join("")}</div>`;
  function errorEn(el, e, reintentar) {
    if (e && e.status === 401) return salirPorSesion();
    el.innerHTML = `<div class="err-box" role="alert">${icono("alerta")}<span>${esc((e && e.message) || "No se pudo cargar.")}</span><button class="btn small" type="button">Reintentar</button></div>`;
    el.querySelector("button").addEventListener("click", reintentar);
  }
  function salirPorSesion() {
    A.salir();
    location.replace("ingresar.html?volver=" + encodeURIComponent(location.hash || "#/"));
  }

  // ---------- descargas (delegadas) ----------
  vista.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-descargar]");
    if (!b) return;
    b.disabled = true;
    try {
      const r = await API.descargar(b.dataset.descargar);
      invalidar();
      const celda = b.closest("tr") && b.closest("tr").querySelector("[data-descargas]");
      if (celda) { celda.dataset.n = Number(celda.dataset.n || 0) + 1; celda.textContent = fmt(celda.dataset.n); }
      if (r.url) {
        const a = document.createElement("a");
        a.href = r.url; a.download = r.nombre || ""; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
        toast("Descargando " + (r.nombre || "el archivo") + ".");
      } else {
        toast("Modo local: la descarga quedó anotada, pero el archivo solo se puede abrir en la pestaña donde se subió.", "largo");
      }
    } catch (e) {
      if (e.status === 401) return salirPorSesion();
      toast(e.message || "No se pudo descargar.", "neg");
    } finally { b.disabled = false; }
  });

  // ---------- filas ----------
  function filaFeed(it, opciones) {
    const m = mat(it);
    const o = opciones || {};
    return `<a class="feed-row" href="#/materia/${encodeURIComponent(m.id)}?ver=${encodeURIComponent(it.material_id)}">
      <span class="f-linea"><span class="tag">${esc(etiqueta(it))}</span><span class="f-tit">${esc(it.titulo)}</span></span>
      <span class="f-sub">${o.sinMateria ? "" : esc(nombreMateria(m, true)) + " · "}${esc(it.profesor)} · ${esc(it.periodo)}${o.sinAutor ? "" : " · " + esc(esMio(it) ? "tú" : it.autor_nombre)}</span>
      <span class="f-der"><b>${fechaCorta(it.creado_en)}</b>${plural(it.descargas || 0, "descarga", "descargas")}</span>
    </a>`;
  }
  function filaTabla(it, o) {
    const m = mat(it);
    const enlaceMateria = `<a class="link" href="#/materia/${encodeURIComponent(m.id)}">${esc(nombreMateria(m, true))}</a>${o.conCarrera ? `<span class="sub">${esc(nombreCarrera(m.carrera))}</span>` : ""}`;
    return `<tr data-id="${esc(it.material_id)}">
      <td><div class="t-mat"><span class="tag">${esc(etiqueta(it))}</span><div><b>${esc(it.titulo)}</b><span class="sub">${o.conMateria ? `<span class="solo-movil">${esc(nombreMateria(m, true))} · </span>` : ""}${detalles(it)}<span class="solo-movil"> · ${esc(it.profesor)} · ${esc(it.periodo)}${o.sinAutor ? "" : " · " + esc(it.autor_nombre)}</span></span>${it.descripcion ? `<span class="sub">${esc(it.descripcion)}</span>` : ""}</div></div></td>
      ${o.conMateria ? `<td class="m-ocultar">${enlaceMateria}</td>` : ""}
      <td class="m-ocultar">${esc(it.profesor)}</td>
      <td class="m-ocultar num">${esc(it.periodo)}</td>
      ${o.sinAutor ? `<td class="m-ocultar num">${fechaCorta(it.creado_en)}</td>` : `<td class="m-ocultar"><span class="persona">${avatar(it.autor_nombre, esMio(it))}<span>${esc(esMio(it) ? it.autor_nombre + " (tú)" : it.autor_nombre)}<span class="sub">${fechaCorta(it.creado_en)}</span></span></span></td>`}
      <td class="n m-ocultar" data-descargas data-n="${Number(it.descargas) || 0}">${fmt(it.descargas)}</td>
      <td class="n m-der"><button class="btn small" type="button" data-descargar="${esc(it.material_id)}" aria-label="Descargar ${esc(etiqueta(it))}: ${esc(it.titulo)}">${icono("bajar")}<span>Descargar</span></button></td>
    </tr>`;
  }
  function tabla(items, o) {
    return `<div class="table-wrap"><table class="responsive">
      <thead><tr><th>Material</th>${o.conMateria ? "<th>Materia</th>" : ""}<th>Profesor</th><th>Periodo</th><th>${o.sinAutor ? "Subido" : "Subido por"}</th><th class="n">Descargas</th><th class="n"><span class="sr-only">Acción</span></th></tr></thead>
      <tbody>${items.map((it) => filaTabla(it, o)).join("")}</tbody></table></div>`;
  }

  // ---------- conteos por materia ----------
  function conteos(items, tipo) {
    const c = {};
    items.forEach((it) => { if (!tipo || it.tipo === tipo) c[it.materia_id] = (c[it.materia_id] || 0) + 1; });
    return c;
  }

  // ---------- elegir la carrera (la primera vez, o si se borró del navegador) ----------
  function elegirCarrera(caja, alElegir) {
    caja.innerHTML = `<section class="panel arranque" aria-labelledby="t-carrera">
      <h2 id="t-carrera">¿Qué carrera estudias?</h2>
      <p>NASH te muestra primero las materias y el material de tu carrera. Puedes cambiarla cuando quieras desde el menú.</p>
      <form class="fila-form" id="f-carrera">
        <label class="sr-only" for="i-carrera">Carrera</label>
        <select class="input" id="i-carrera" required><option value="">Elige tu carrera</option>${opcionesCarrera("")}</select>
        <button class="btn primary" type="submit">Listo</button>
      </form>
    </section>`;
    $("#f-carrera").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const v = $("#i-carrera").value;
      if (!v) { $("#i-carrera").focus(); return; }
      A.fijarCarrera(v); pintarCarreraLateral(); alElegir();
    });
  }

  // =====================================================================
  // INICIO: saludo, conteos por tipo (filtran el mapa) y las materias de tu carrera
  // =====================================================================
  async function inicio(ctx) {
    const s = yo();
    const primerNombre = String(s.nombre || "").split(" ")[0] || "de nuevo";
    titulo("Inicio");
    vista.innerHTML = `<div class="page">
      <div class="title-row">
        <div><h1>${saludo()}, ${esc(primerNombre)}</h1><p class="sub" id="dato-hoy">${fechaLarga(hoy())}</p></div>
        <div class="acciones"><a class="btn primary" href="#/subir">${icono("subir")}Subir material</a></div>
      </div>
      <div id="i-cuerpo">${filasCargando(3)}</div>
    </div>`;
    const caja = $("#i-cuerpo");
    const car = miCarrera();
    if (!car) { elegirCarrera(caja, () => render()); return; }
    const C = N.carreraPorId[car];

    let todos;
    try { todos = await lista(); } catch (e) { if (ctx.vigente()) errorEn(caja, e, () => render()); return; }
    if (!ctx.vigente()) return;
    const items = todos.filter((it) => N.esDeCarrera(it, car));
    const carrerasCon = new Set(todos.map((it) => it.carrera_id).filter((c) => c !== "nucleo")).size;
    const ultimo = items[0];

    // el dato del día
    $("#dato-hoy").textContent = items.length
      ? `${fechaLarga(hoy())}. ${C.corto} tiene ${plural(items.length, "archivo", "archivos")} en ${plural(new Set(items.map((it) => it.materia_id)).size, "materia", "materias")}; lo último es ${etiqueta(ultimo)} de ${nombreMateria(mat(ultimo), true)}.`
      : todos.length
        ? `${fechaLarga(hoy())}. ${C.corto} todavía no tiene material; en todo NASH hay ${plural(todos.length, "archivo", "archivos")} de ${plural(carrerasCon, "carrera", "carreras")}.`
        : `${fechaLarga(hoy())}. El banco está empezando: todavía no hay material de ninguna carrera.`;

    const pensum = N.tienePensum(car);
    caja.innerHTML = `
      ${items.length ? `<div class="kpis" id="kpis"></div>` : `<section class="panel arranque" aria-labelledby="t-arranque">
        <h2 id="t-arranque">${esc(C.corto)} todavía no tiene material</h2>
        <p>Lo primero que subas es lo primero que verán tus compañeros: un parcial que ya te devolvieron, un quiz, un taller o tus apuntes de una semana.</p>
        <ol class="pasos-arranque">
          <li><b>1</b>${pensum ? "Elige la materia del pensum" : "Elige la materia o escribe su nombre"}</li>
          <li><b>2</b>Escribe el profesor, el número y la fecha</li>
          <li><b>3</b>Adjunta el PDF o la foto</li>
        </ol>
        <div class="acciones"><a class="btn primary" href="#/subir">${icono("subir")}Subir el primero</a>${todos.length ? `<a class="btn" href="#/explorar">Ver lo de otras carreras</a>` : ""}</div>
      </section>`}
      <section class="panel" id="p-mapa" aria-labelledby="t-mapa">
        <header class="mapa-head"><h2 id="t-mapa">Materias de ${esc(C.corto)}</h2><p class="mapa-nota" id="mapa-nota"></p></header>
        <div id="mapa-cuerpo"></div>
      </section>
      <div class="grid" id="i-listas" style="margin-top:var(--gap)"></div>`;

    // conteos por tipo
    let tipoSel = "";
    let foco = null;
    const kpis = $("#kpis");
    if (kpis) {
      kpis.innerHTML = N.TIPOS.map((t) => {
        const delTipo = items.filter((it) => it.tipo === t.id);
        const enMaterias = new Set(delTipo.map((it) => it.materia_id)).size;
        return `<button class="kpi" type="button" aria-pressed="false" data-tipo="${t.id}">
          <span class="kpi-label">${mayus(t.plural)}</span>
          <span class="kpi-value">${fmt(delTipo.length)}</span>
          <span class="kpi-cap">${delTipo.length ? `en ${plural(enMaterias, "materia", "materias")}` : "Todavía ninguno"}</span>
        </button>`;
      }).join("");
      kpis.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-tipo]"); if (!b) return;
        tipoSel = tipoSel === b.dataset.tipo ? "" : b.dataset.tipo;
        $$("[data-tipo]", kpis).forEach((k) => k.setAttribute("aria-pressed", String(k.dataset.tipo === tipoSel)));
        pintarMapa();
      });
    }

    // el mapa: el pensum por semestre si está cargado; si no, las materias que ya tienen material
    const cuerpo = $("#mapa-cuerpo");
    const propias = N.pensumDe(car);
    const semestres = N.semestresDe(car);
    function pintarMapa() {
      const c = conteos(items, tipoSel);
      const dinamicas = N.dinamicasDe(car);
      const max = Math.max(0, ...propias.concat(dinamicas).map((m) => c[m.id] || 0));
      const t = tipoSel ? N.tipoPorId[tipoSel] : null;
      $("#t-mapa").textContent = t ? `${mayus(t.plural)} por materia` : `Materias de ${C.corto}`;
      const curso = (m) => `<li><button class="curso" type="button" data-id="${esc(m.id)}" aria-pressed="false" aria-label="${esc(nombreMateria(m))}: ${plural(c[m.id] || 0, "archivo", "archivos")}">
          <span class="c-cod">${esc(m.codigo)}</span><span class="c-n${c[m.id] ? "" : " cero"}">${fmt(c[m.id])}</span>
          <span class="c-nom">${esc(m.corto || m.nombre)}</span><span class="c-bar" style="--w:${max ? ((c[m.id] || 0) / max) * 100 : 0}%"></span></button></li>`;
      const chip = (m) => `<a href="#/materia/${encodeURIComponent(m.id)}">${esc(m.corto || m.nombre)} <span class="n">${fmt(c[m.id])}</span></a>`;
      let html = "";
      if (pensum) {
        html += `<div class="mapa" id="mapa" style="--sems:${semestres.length}">${semestres.map((s) =>
          `<div class="sem"><h3>Semestre ${N.ROMANOS[s]}</h3><ol>${propias.filter((m) => m.semestre === s).map(curso).join("")}</ol></div>`).join("")}</div>`;
        if (dinamicas.length) html += `<div class="nucleo"><span>Otras materias</span>${dinamicas.map(chip).join("")}</div>`;
      } else if (dinamicas.length) {
        html += `<div class="nucleo primero">${dinamicas.map(chip).join("")}</div>`;
      } else {
        html += `<div class="empty"><b>Aquí van a aparecer las materias de ${esc(C.nombre)}.</b>El pensum de esta carrera todavía no está cargado en NASH. Cuando subas algo, escribe el nombre de la materia: queda creada para todos y su material se reúne aquí.</div>`;
      }
      html += `<div class="nucleo"><span>Núcleo rosarista</span>${N.nucleo().map(chip).join("")}</div>`;
      if (pensum) html += `<p class="mapa-leyenda">${max ? `<span><i class="sw bar"></i>Archivos, frente a la materia con más (${fmt(max)})</span>` : ""}<span><i class="sw prer"></i>Prerrequisito de la elegida</span><span><i class="sw abre"></i>Materias que abre</span></p>`;
      cuerpo.innerHTML = html;
      marcar();
    }
    function marcar() {
      const nota = $("#mapa-nota");
      if (!pensum) { nota.textContent = N.dinamicasDe(car).length ? "Agregadas por estudiantes al subir material" : ""; return; }
      $$(".curso", cuerpo).forEach((b) => { b.classList.remove("es-foco", "es-prer", "es-abre"); b.setAttribute("aria-pressed", "false"); });
      if (!foco) { nota.textContent = "Toca una materia para ver de qué depende y qué abre; tócala otra vez para entrar."; return; }
      const m = N.porId[foco];
      const b = $(`.curso[data-id="${CSS.escape(foco)}"]`, cuerpo);
      if (b) { b.classList.add("es-foco"); b.setAttribute("aria-pressed", "true"); }
      m.prer.forEach((p) => { const x = $(`.curso[data-id="${CSS.escape(p)}"]`, cuerpo); if (x) x.classList.add("es-prer"); });
      m.abre.forEach((p) => { const x = $(`.curso[data-id="${CSS.escape(p)}"]`, cuerpo); if (x) x.classList.add("es-abre"); });
      const n = conteos(items, tipoSel)[m.id] || 0;
      const cods = (ids) => ids.map((id) => N.porId[id].codigo).join(", ");
      nota.innerHTML = `<b>${esc(nombreMateria(m))}</b> · ${m.prer.length ? "requiere " + cods(m.prer) : "sin prerrequisitos"}${m.abre.length ? " · abre " + cods(m.abre) : ""} · <a class="card-link" href="#/materia/${encodeURIComponent(m.id)}">${n ? "Ver " + plural(n, "archivo", "archivos") : "Abrir la materia"}${icono("flecha")}</a>`;
    }
    cuerpo.addEventListener("click", (ev) => {
      const b = ev.target.closest(".curso"); if (!b) return;
      if (foco === b.dataset.id) { location.hash = "#/materia/" + encodeURIComponent(b.dataset.id); return; }
      foco = b.dataset.id; marcar();
    });
    cuerpo.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && foco) { foco = null; marcar(); } });
    pintarMapa();

    // recién subidos y tus aportes (si el banco está vacío, el panel de arriba ya dice qué hacer)
    const mios = todos.filter(esMio);
    const recientes = items.length ? items : todos;
    if (!recientes.length && !mios.length) { $("#i-listas").remove(); return; }
    const descargasMias = mios.reduce((s2, it) => s2 + (Number(it.descargas) || 0), 0);
    $("#i-listas").innerHTML = `
      <section class="panel s8" aria-labelledby="t-recientes"><header><h2 id="t-recientes">${items.length ? `Recién subidos en ${esc(C.corto)}` : "Recién subidos en NASH"}</h2><a class="card-link" href="#/explorar${items.length ? "?carrera=" + car : ""}">Ver todo${icono("flecha")}</a></header>
        <div class="feed">${recientes.slice(0, 5).map((it) => filaFeed(it)).join("")}</div></section>
      <section class="panel s4" aria-labelledby="t-tuyos"><header><h2 id="t-tuyos">Tus aportes${mios.length ? ` <span class="count">· ${fmt(mios.length)}</span>` : ""}</h2>${mios.length ? `<a class="card-link" href="#/mis-aportes">Ver todos${icono("flecha")}</a>` : ""}</header>
        ${mios.length
          ? `<div class="feed">${mios.slice(0, 4).map((it) => filaFeed(it, { sinAutor: true })).join("")}</div><p class="muted" style="margin-top:14px">Lo que subiste se ha descargado <b class="num" style="color:var(--text);font-weight:500">${plural(descargasMias, "vez", "veces")}</b>.</p>`
          : `<div class="empty"><b>Aún no has subido nada.</b>Un parcial que ya te devolvieron le ahorra una semana a alguien del semestre de abajo.<a class="btn" href="#/subir">Subir material</a></div>`}</section>`;
  }

  // =====================================================================
  // MATERIA: su material con filtros, quién lo subió y su lugar en el pensum
  // =====================================================================
  async function materia(ctx) {
    const id = decodeURIComponent(ctx.partes[1] || "");
    let m = N.porId[id];
    const f = { tipo: ctx.q.get("tipo") || "", periodo: ctx.q.get("periodo") || "", profesor: ctx.q.get("profesor") || "", q: ctx.q.get("q") || "" };
    const ver = ctx.q.get("ver");
    vista.innerHTML = `<div class="page"><div id="m-pagina">${filasCargando(4)}</div></div>`;

    let items;
    try { items = await lista(); } catch (e) { if (ctx.vigente()) errorEn($("#m-pagina"), e, () => render()); return; }
    if (!ctx.vigente()) return;
    m = m || N.porId[id];
    if (!m) return noEncontrada();
    titulo(nombreMateria(m));
    const enlaceCarrera = m.nucleo ? `<span>Núcleo rosarista</span>` : `<a href="#/explorar?carrera=${esc(m.carrera)}">${esc(nombreCarrera(m.carrera))}</a>`;
    $("#m-pagina").outerHTML = `
      <nav class="crumbs" aria-label="Ruta"><a href="#/">Inicio</a><span aria-hidden="true">/</span>${enlaceCarrera}${m.nucleo ? "" : `<span aria-hidden="true">/</span><span>${esc(ubicacion(m))}</span>`}</nav>
      <div class="title-row">
        <div><h1>${m.codigo ? `<span class="cod">${esc(m.codigo)}</span>` : ""}${esc(m.nombre)}</h1><p class="sub" id="m-sub">${esc(m.nucleo ? "Núcleo rosarista, para todas las carreras" : nombreCarrera(m.carrera, true) + " · " + ubicacion(m))}${m.creditos ? " · " + plural(m.creditos, "crédito", "créditos") : ""}</p></div>
        <div class="acciones"><a class="btn primary" href="#/subir?materia=${encodeURIComponent(m.id)}">${icono("subir")}Subir material</a></div>
      </div>
      <div class="grid top">
        <section class="panel s9" aria-label="Material de ${esc(m.nombre)}"><div id="m-cuerpo"></div></section>
        <aside class="s3 rail" id="m-rail"></aside>
      </div>`;

    const propios = items.filter((it) => it.materia_id === m.id);
    const autores = {};
    propios.forEach((it) => { const a = (autores[it.autor_id] = autores[it.autor_id] || { nombre: it.autor_nombre, n: 0, propio: esMio(it) }); a.n++; });
    const gente = Object.values(autores).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
    $("#m-sub").textContent += propios.length ? ` · ${plural(propios.length, "archivo", "archivos")} de ${plural(gente.length, "estudiante", "estudiantes")}` : " · todavía sin material";

    // carril: quién lo subió y la cadena del pensum
    const c = conteos(items);
    const enlace = (x) => { const y = N.porId[x]; return `<a href="#/materia/${encodeURIComponent(y.id)}"><span class="cod">${esc(y.codigo)}</span><span>${esc(y.corto || y.nombre)}</span><span class="n">${fmt(c[y.id])}</span></a>`; };
    const enPensum = !m.nucleo && !m.dinamica;
    $("#m-rail").innerHTML = `
      <section aria-labelledby="t-gente"><h2 id="t-gente">Quién lo subió</h2>${gente.length
        ? `<ul class="gente">${gente.map((g) => `<li>${avatar(g.nombre, g.propio)}<span class="nombre">${esc(g.nombre)}${g.propio ? " (tú)" : ""}</span><span class="n">${fmt(g.n)}</span></li>`).join("")}</ul>`
        : `<p class="muted">Nadie todavía.</p>`}</section>
      <section aria-labelledby="t-cadena"><h2 id="t-cadena">${enPensum ? "En el pensum" : "Sobre la materia"}</h2>${enPensum ? `
        <p class="cadena-sub">Requiere</p>${m.prer.length ? `<div class="cadena">${m.prer.map(enlace).join("")}</div>` : `<p class="muted">Sin prerrequisitos.</p>`}
        <p class="cadena-sub">Abre</p>${m.abre.length ? `<div class="cadena">${m.abre.map(enlace).join("")}</div>` : `<p class="muted">No es prerrequisito de otra materia.</p>`}
        <p class="cadena-sub" style="margin-top:14px">Cifra a la derecha: archivos en el banco.</p>`
        : m.nucleo ? `<p class="muted">Es del núcleo institucional: la ven estudiantes de todas las carreras, así que su material le sirve a cualquiera.</p>`
        : `<p class="muted">La agregaron estudiantes de ${esc(nombreCarrera(m.carrera, true))} al subir material. No viene de un pensum cargado en NASH.</p>`}
      </section>`;

    const cuerpo = $("#m-cuerpo");
    if (!propios.length) {
      cuerpo.innerHTML = `<div class="empty"><b>Todavía no hay material de ${esc(m.nombre)}.</b>Si ya la viste y tienes un parcial devuelto, un quiz o tus apuntes, el primero en subirlo le abre la materia a los demás.<a class="btn primary" href="#/subir?materia=${encodeURIComponent(m.id)}">Subir el primero</a></div>`;
      return;
    }
    const periodos = [...new Set(propios.map((it) => it.periodo))].sort().reverse();
    const profes = [...new Set(propios.map((it) => it.profesor))].sort((a, b) => a.localeCompare(b));
    cuerpo.innerHTML = `
      <div class="filtros">
        <div class="segmented" role="group" aria-label="Tipo de material" id="m-tipos"></div>
        <div class="grupo">
        <label class="sr-only" for="m-periodo">Periodo</label>
        <select class="input" id="m-periodo"><option value="">Todos los periodos</option>${periodos.map((p) => `<option${p === f.periodo ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>
        <label class="sr-only" for="m-profe">Profesor</label>
        <select class="input" id="m-profe"><option value="">Todos los profesores</option>${profes.map((p) => `<option${p === f.profesor ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>
        <div class="buscar">${icono("lupa")}<label class="sr-only" for="m-q">Buscar en esta materia</label><input class="input" id="m-q" type="search" placeholder="Buscar en ${esc(m.corto || m.nombre)}" value="${esc(f.q)}"></div>
        </div>
      </div>
      <p class="total-linea" id="m-total" aria-live="polite"></p>
      <div id="m-tabla"></div>`;

    function pintar() {
      const base = propios.filter((it) => (!f.periodo || it.periodo === f.periodo) && (!f.profesor || it.profesor === f.profesor) && coincide(it, f.q));
      $("#m-tipos").innerHTML = [{ id: "", plural: "todo" }].concat(N.TIPOS).map((t) => {
        const n = t.id ? base.filter((it) => it.tipo === t.id).length : base.length;
        return `<button type="button" data-t="${t.id}" aria-pressed="${f.tipo === t.id}">${mayus(t.plural)} <span class="n">${fmt(n)}</span></button>`;
      }).join("");
      const vis = base.filter((it) => !f.tipo || it.tipo === f.tipo);
      const filtrado = f.tipo || f.periodo || f.profesor || f.q;
      $("#m-total").textContent = filtrado ? `${plural(vis.length, "archivo", "archivos")} de ${fmt(propios.length)}` : `${plural(vis.length, "archivo", "archivos")}, del más reciente al más antiguo`;
      $("#m-tabla").innerHTML = vis.length ? tabla(vis, {}) : `<div class="empty"><b>Nada con esos filtros.</b><button class="btn small" type="button" id="m-limpiar">Quitar filtros</button></div>`;
      const limpiar = $("#m-limpiar");
      if (limpiar) limpiar.addEventListener("click", () => { f.tipo = f.periodo = f.profesor = f.q = ""; $("#m-periodo").value = ""; $("#m-profe").value = ""; $("#m-q").value = ""; guardar(); pintar(); });
      if (ver) {
        const fila = $(`tr[data-id="${CSS.escape(ver)}"]`, cuerpo);
        if (fila) { fila.classList.add("resaltado"); fila.scrollIntoView({ block: "center" }); }
      }
    }
    function guardar() {
      const p = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
      history.replaceState(null, "", `#/materia/${encodeURIComponent(m.id)}${p.toString() ? "?" + p : ""}`);
    }
    $("#m-tipos").addEventListener("click", (ev) => { const b = ev.target.closest("[data-t]"); if (!b) return; f.tipo = b.dataset.t; guardar(); pintar(); });
    $("#m-periodo").addEventListener("change", (ev) => { f.periodo = ev.target.value; guardar(); pintar(); });
    $("#m-profe").addEventListener("change", (ev) => { f.profesor = ev.target.value; guardar(); pintar(); });
    let t0; $("#m-q").addEventListener("input", (ev) => { clearTimeout(t0); t0 = setTimeout(() => { f.q = ev.target.value.trim(); guardar(); pintar(); }, 160); });
    pintar();
  }

  const limpio = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function coincide(it, q) {
    if (!q) return true;
    const m = mat(it);
    return limpio(`${it.titulo} ${it.profesor} ${it.autor_nombre} ${m.codigo} ${m.nombre} ${nombreCarrera(m.carrera)} ${etiqueta(it)}`).includes(limpio(q));
  }

  // =====================================================================
  // EXPLORAR: todo el banco con filtros
  // =====================================================================
  async function explorar(ctx) {
    titulo("Explorar el banco");
    const f = { tipo: ctx.q.get("tipo") || "", carrera: ctx.q.get("carrera") || "", periodo: ctx.q.get("periodo") || "", orden: ctx.q.get("orden") || "", q: ctx.q.get("q") || "" };
    $("#q-lateral").value = f.q;
    vista.innerHTML = `<div class="page">
      <div class="title-row"><div><h1>Explorar el banco</h1><p class="sub" id="e-sub">Todo lo que han subido, de todas las carreras.</p></div>
        <div class="acciones"><a class="btn primary" href="#/subir">${icono("subir")}Subir material</a></div></div>
      <section class="panel" aria-label="Material del banco"><div id="e-cuerpo">${filasCargando(6)}</div></section>
    </div>`;
    let items;
    try { items = await lista(); } catch (e) { if (ctx.vigente()) errorEn($("#e-cuerpo"), e, () => render()); return; }
    if (!ctx.vigente()) return;
    const cuerpo = $("#e-cuerpo");
    if (!items.length) {
      $("#e-sub").textContent = "Todo lo que han subido, de todas las carreras.";
      cuerpo.innerHTML = `<div class="empty"><b>El banco está vacío por ahora.</b>Cuando alguien suba un parcial, un quiz, un taller o sus apuntes, aparece aquí con su materia, el profesor y quién lo subió.<a class="btn primary" href="#/subir">Subir el primero</a></div>`;
      return;
    }
    const carrerasCon = [...new Set(items.map((it) => it.carrera_id))];
    $("#e-sub").textContent = `${plural(items.length, "archivo", "archivos")} de ${plural(new Set(items.map((it) => it.materia_id)).size, "materia", "materias")} en ${plural(carrerasCon.filter((c) => c !== "nucleo").length || carrerasCon.length, "carrera", "carreras")}. Busca por título, profesor, materia o quién lo subió.`;
    const periodos = [...new Set(items.map((it) => it.periodo))].sort().reverse();
    cuerpo.innerHTML = `<div class="filtros">
        <div class="segmented" role="group" aria-label="Tipo de material" id="e-tipos"></div>
        <div class="grupo">
        <label class="sr-only" for="e-car">Carrera</label>
        <select class="input" id="e-car"><option value="">Todas las carreras</option>${opcionesCarrera(f.carrera)}</select>
        <label class="sr-only" for="e-per">Periodo</label>
        <select class="input" id="e-per"><option value="">Todos los periodos</option>${periodos.map((p) => `<option${p === f.periodo ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>
        <label class="sr-only" for="e-orden">Orden</label>
        <select class="input" id="e-orden"><option value="">Más recientes</option><option value="descargas"${f.orden === "descargas" ? " selected" : ""}>Más descargados</option></select>
        <div class="buscar">${icono("lupa")}<label class="sr-only" for="e-q">Buscar</label><input class="input" id="e-q" type="search" placeholder="Buscar" value="${esc(f.q)}"></div>
        </div>
      </div>
      <p class="total-linea" id="e-total" aria-live="polite"></p>
      <div id="e-tabla"></div>`;
    let mostrar = 40;
    function pintar() {
      const base = items.filter((it) => N.esDeCarrera(it, f.carrera) && (!f.periodo || it.periodo === f.periodo) && coincide(it, f.q));
      $("#e-tipos").innerHTML = [{ id: "", plural: "todo" }].concat(N.TIPOS).map((t) => `<button type="button" data-t="${t.id}" aria-pressed="${f.tipo === t.id}">${mayus(t.plural)} <span class="n">${fmt(t.id ? base.filter((it) => it.tipo === t.id).length : base.length)}</span></button>`).join("");
      let vis = base.filter((it) => !f.tipo || it.tipo === f.tipo);
      if (f.orden === "descargas") vis = vis.slice().sort((a, b) => (b.descargas || 0) - (a.descargas || 0));
      $("#e-total").textContent = (vis.length > mostrar ? `Mostrando ${fmt(mostrar)} de ${plural(vis.length, "archivo", "archivos")}` : plural(vis.length, "archivo", "archivos")) + (f.carrera ? ` de ${nombreCarrera(f.carrera)} y el núcleo` : "");
      $("#e-tabla").innerHTML = vis.length
        ? tabla(vis.slice(0, mostrar), { conMateria: true, conCarrera: !f.carrera }) + (vis.length > mostrar ? `<div class="mas"><button class="btn" type="button" id="e-mas">Mostrar ${fmt(Math.min(40, vis.length - mostrar))} más</button></div>` : "")
        : `<div class="empty"><b>Nada con esos filtros${f.q ? ` para «${esc(f.q)}»` : ""}.</b>${f.carrera ? `Puede que ${esc(nombreCarrera(f.carrera))} todavía no tenga material. ` : ""}Prueba con el nombre del profesor o de la materia.<button class="btn small" type="button" id="e-limpiar">Quitar filtros</button></div>`;
      const mas = $("#e-mas"); if (mas) mas.addEventListener("click", () => { mostrar += 40; pintar(); });
      const limpiar = $("#e-limpiar"); if (limpiar) limpiar.addEventListener("click", () => { Object.keys(f).forEach((k) => (f[k] = "")); ["#e-car", "#e-per", "#e-orden", "#e-q"].forEach((s) => ($(s).value = "")); guardar(); pintar(); });
    }
    function guardar() {
      const p = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
      history.replaceState(null, "", "#/explorar" + (p.toString() ? "?" + p : ""));
      $("#q-lateral").value = f.q;
    }
    $("#e-tipos").addEventListener("click", (ev) => { const b = ev.target.closest("[data-t]"); if (!b) return; f.tipo = b.dataset.t; mostrar = 40; guardar(); pintar(); });
    $("#e-car").addEventListener("change", (ev) => { f.carrera = ev.target.value; mostrar = 40; guardar(); pintar(); });
    $("#e-per").addEventListener("change", (ev) => { f.periodo = ev.target.value; mostrar = 40; guardar(); pintar(); });
    $("#e-orden").addEventListener("change", (ev) => { f.orden = ev.target.value; guardar(); pintar(); });
    let t0; $("#e-q").addEventListener("input", (ev) => { clearTimeout(t0); t0 = setTimeout(() => { f.q = ev.target.value.trim(); mostrar = 40; guardar(); pintar(); }, 160); });
    pintar();
    if (f.q) $("#e-q").focus();
  }

  // =====================================================================
  // SUBIR: formulario que no deja repetir un parcial, quiz, taller o semana
  // =====================================================================
  const NUEVA = "__nueva";
  async function subir(ctx) {
    titulo("Subir material");
    vista.innerHTML = `<div class="page"><div class="title-row"><div><h1>Subir material</h1></div></div><div id="s-pagina">${filasCargando(3)}</div></div>`;
    let items = [];
    try { items = await lista(); } catch (e) { if (e.status === 401) return salirPorSesion(); /* sin lista se puede subir igual */ }
    if (!ctx.vigente()) return;

    const pre = N.porId[ctx.q.get("materia") || ""];
    let carrera = pre && !pre.nucleo ? pre.carrera : miCarrera() || "";
    vista.innerHTML = `<div class="page">
      <div class="title-row"><div><h1>Subir material</h1><p class="sub">Queda en la materia con tu nombre. Antes de guardarlo, NASH revisa que ese parcial, quiz, taller o semana no esté ya en el banco.</p></div></div>
      <div class="grid top">
        <form class="form s7" id="f-subir" novalidate>
          <fieldset id="s-campos">
            <legend class="sr-only">Datos del material</legend>
            <div class="form-fila">
              <div class="field"><label for="s-carrera">Carrera</label><select class="input" id="s-carrera" required><option value="">Elige la carrera</option>${opcionesCarrera(carrera)}</select></div>
              <div class="field"><label for="s-materia">Materia</label><select class="input" id="s-materia" required></select></div>
            </div>
            <div class="field" id="s-nueva-fila" hidden><label for="s-nueva">Nombre de la materia</label><input class="input" id="s-nueva" maxlength="80" autocomplete="off" placeholder="Como aparece en tu horario, p. ej. Microeconomía I"><p class="hint">La materia queda creada con este nombre y tu material es el primero en ella.</p></div>
            <div class="field"><span class="label" id="l-tipo">Tipo de material</span>
              <div class="segmented" role="radiogroup" aria-labelledby="l-tipo" id="s-tipo">${N.TIPOS.map((t, i) => `<label><input type="radio" name="tipo" value="${t.id}"${i === 1 ? " checked" : ""}>${t.nombre}</label>`).join("")}</div></div>
            <div class="form-fila tres">
              <div class="field"><label for="s-fecha">Fecha en que se presentó</label><input class="input" id="s-fecha" type="date" min="2015-01-01" max="${hoy()}" required><p class="periodo-calc" id="s-periodo">El periodo sale de la fecha.</p></div>
              <div class="field"><label for="s-profe">Profesor</label><input class="input" id="s-profe" list="s-profes" autocomplete="off" maxlength="60" placeholder="Nombre y apellido" required><datalist id="s-profes"></datalist></div>
              <div class="field"><label for="s-numero" id="l-numero">Parcial n.º</label><input class="input num" id="s-numero" type="number" min="1" max="20" step="1" inputmode="numeric" required></div>
            </div>
            <div id="s-disp" aria-live="polite"></div>
            <div class="field"><label for="s-titulo">Título</label><input class="input" id="s-titulo" maxlength="90" placeholder="De qué trata, en pocas palabras" required><p class="hint"><span id="c-titulo">0</span> de 90 caracteres</p></div>
            <label class="check" id="s-sol-fila"><input type="checkbox" id="s-solucion">Incluye la solución</label>
            <div class="field"><label for="s-desc">Descripción <span class="muted">(opcional)</span></label><textarea class="input" id="s-desc" maxlength="400" rows="3" placeholder="Temas que cubre, qué puntos trae, si tiene errores conocidos"></textarea><p class="hint"><span id="c-desc">0</span> de 400 caracteres</p></div>
            <div class="field"><span class="label" id="l-archivo">Archivo</span>
              <div class="drop" id="s-drop">${icono("archivo")}<span><b>Arrastra el PDF o la foto aquí</b> o haz clic para elegirlo</span><span class="hint">PDF, JPG o PNG · hasta ${(window.NASH_CONFIG || {}).MAX_MB || 10} MB</span>
                <input type="file" id="s-archivo" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" aria-labelledby="l-archivo"></div>
              <div id="s-elegido"></div></div>
          </fieldset>
          <div class="form-pie" id="s-pie"><button class="btn primary" type="submit" id="s-enviar">${icono("subir")}Subir al banco</button><span class="razon" id="s-razon"></span></div>
        </form>
        <aside class="s5 vista">
          <section class="panel" aria-labelledby="t-vista"><header><h2 id="t-vista">Así se verá en la materia</h2></header><div id="s-preview"></div></section>
          <section class="panel" aria-labelledby="t-antes"><header><h2 id="t-antes">Antes de subir</h2></header>
            <ul class="lista-check">
              <li>${icono("check")}<span>Sube solo lo que el profesor ya devolvió o publicó.</span></li>
              <li>${icono("check")}<span>Si el parcial tiene tu nombre, tu código o tu nota, tápalos antes de escanearlo.</span></li>
              <li>${icono("check")}<span>Una foto bien iluminada sirve; un PDF escaneado sirve más.</span></li>
            </ul></section>
        </aside>
      </div>
    </div>`;

    const form = $("#f-subir");
    const el = { carrera: $("#s-carrera"), materia: $("#s-materia"), nueva: $("#s-nueva"), fecha: $("#s-fecha"), profe: $("#s-profe"), numero: $("#s-numero"), titulo: $("#s-titulo"), sol: $("#s-solucion"), desc: $("#s-desc"), archivo: $("#s-archivo") };
    let archivo = null;
    let disp = null;      // última respuesta de disponibilidad
    let choque = null;    // registro que ya ocupa ese número
    let consultando = false;
    let enviando = false;

    // ----- carrera y materia -----
    function pintarMaterias(seleccion) {
      carrera = el.carrera.value;
      if (!carrera) { el.materia.innerHTML = `<option value="">Primero elige la carrera</option>`; el.materia.disabled = true; $("#s-nueva-fila").hidden = true; return; }
      el.materia.disabled = false;
      const op = (m) => `<option value="${esc(m.id)}"${m.id === seleccion ? " selected" : ""}>${esc(nombreMateria(m))}</option>`;
      const pensum = N.pensumDe(carrera);
      const dinamicas = N.dinamicasDe(carrera);
      let html = `<option value="">Elige la materia</option>`;
      N.semestresDe(carrera).forEach((s) => { html += `<optgroup label="Semestre ${N.ROMANOS[s]}">${pensum.filter((m) => m.semestre === s).map(op).join("")}</optgroup>`; });
      if (dinamicas.length) html += `<optgroup label="${pensum.length ? "Otras materias" : "Materias de " + esc(nombreCarrera(carrera))}">${dinamicas.map(op).join("")}</optgroup>`;
      html += `<optgroup label="Núcleo rosarista">${N.nucleo().map(op).join("")}</optgroup>`;
      html += `<optgroup label="¿No está?"><option value="${NUEVA}"${seleccion === NUEVA ? " selected" : ""}>Otra materia: escribir su nombre</option></optgroup>`;
      el.materia.innerHTML = html;
      $("#s-nueva-fila").hidden = el.materia.value !== NUEVA;
    }
    const inicial = pre ? pre.id : (carrera && !N.tienePensum(carrera) && !N.dinamicasDe(carrera).length ? NUEVA : "");
    pintarMaterias(inicial);

    const tipo = () => (form.querySelector("input[name=tipo]:checked") || {}).value || "";
    const periodo = () => N.periodoDeFecha(el.fecha.value);
    const nombreNueva = () => el.nueva.value.replace(/\s+/g, " ").trim();
    /** la materia elegida: { id, nombre, carrera } o null */
    function materiaElegida() {
      const v = el.materia.value;
      if (!v) return null;
      if (v === NUEVA) { const n = nombreNueva(); return n ? { id: N.idDinamico(carrera, n), nombre: n, carrera, nueva: true } : null; }
      const m = N.porId[v];
      return m ? { id: m.id, nombre: m.nombre, carrera: m.carrera, m } : null;
    }
    const meta = () => {
      const me = materiaElegida();
      return {
        carrera_id: me ? me.carrera : carrera, materia_id: me ? me.id : "", materia_nombre: me ? me.nombre : "",
        tipo: tipo(), numero: el.numero.value === "" ? "" : Number(el.numero.value),
        titulo: el.titulo.value.trim(), profesor: el.profe.value.trim(), fecha: el.fecha.value,
        con_solucion: tipo() !== "apuntes" && el.sol.checked, descripcion: el.desc.value.trim(),
        archivo_nombre: archivo ? archivo.name : "", archivo_tipo: archivo ? archivo.type : "", archivo_bytes: archivo ? archivo.size : 0
      };
    };

    function profesSugeridos() {
      const me = materiaElegida();
      const ps = [...new Set(items.filter((it) => (me ? it.materia_id === me.id : it.carrera_id === carrera)).map((it) => it.profesor))].sort((a, b) => a.localeCompare(b));
      $("#s-profes").innerHTML = ps.map((p) => `<option value="${esc(p)}"></option>`).join("");
    }
    profesSugeridos();

    // ----- no repetir: qué números ya están -----
    let tDisp, pedido = 0;
    function revisarDisponibilidad() {
      clearTimeout(tDisp);
      const me = materiaElegida();
      const nombreOk = !me || !me.nueva || !N.validarNombreMateria(me.nombre);
      const t = tipo(), per = periodo(), prof = el.profe.value.trim();
      const listo = me && nombreOk && t && per && (t === "apuntes" || prof.length >= 3);
      if (!listo) { disp = null; choque = null; consultando = false; pintarDisp(); return; }
      consultando = true; pintarDisp();
      tDisp = setTimeout(async () => {
        const mio = ++pedido;
        try {
          const r = await API.disponibilidad({ materia: me.id, tipo: t, periodo: per, profesor: prof });
          if (mio !== pedido) return;
          disp = Object.assign({ consulta: { me, t, per, prof } }, r);
        } catch (e) {
          if (mio !== pedido) return;
          if (e.status === 401) return salirPorSesion();
          disp = { error: e.message };
        }
        consultando = false; pintarDisp();
      }, 300);
    }
    function pintarDisp() {
      const caja = $("#s-disp");
      choque = null;
      const t = N.tipoPorId[tipo()];
      if (consultando) { caja.innerHTML = `<p class="muted">Revisando qué números ya están en el banco…</p>`; actualizar(); return; }
      if (!disp) { caja.innerHTML = ""; actualizar(); return; }
      if (disp.error) { caja.innerHTML = `<p class="muted">No se pudo revisar qué números están libres (${esc(disp.error)}). Al subir se vuelve a revisar.</p>`; actualizar(); return; }
      const q = disp.consulta;
      const mismos = (disp.ocupados || []).filter((o) => o.clave === disp.clave);
      const tomados = new Set(mismos.map((o) => Number(o.numero)));
      const max = q.t === "apuntes" ? 18 : 20;
      let libre = 1; while (tomados.has(libre) && libre <= max) libre++;
      const quien = q.t === "apuntes" ? "Tus apuntes" : `${mayus(t.plural)} con ${esc(q.prof)}`;
      const nombreM = q.me.m ? nombreMateria(q.me.m, true) : q.me.nombre;
      const n = Number(el.numero.value);
      choque = mismos.find((o) => Number(o.numero) === n) || null;
      let html = "";
      if (!mismos.length) {
        html = `<p class="muted">${q.t === "apuntes" ? "Todavía no has subido apuntes" : `Todavía no hay ${t.plural} con ${esc(q.prof)}`} de ${esc(nombreM)} en ${esc(q.per)}. Cualquier número está libre.</p>`;
      } else {
        html = `<div class="ocupados"><span class="lbl">${quien} en ${esc(q.per)} ya en el banco:</span>${mismos.map((o) => `<span class="chip-num" title="${esc(o.titulo)}">${esc(N.tipoPorId[q.t].numero.replace(" n.º", ""))} ${fmt(o.numero)}</span>`).join("")}${libre <= max ? `<span class="lbl" style="margin-left:6px">Siguiente libre:</span><button class="chip-num libre" type="button" data-usar="${libre}">${fmt(libre)}</button>` : ""}</div>`;
      }
      if (choque) {
        const tipoTxt = N.tipoPorId[q.t].numero.replace(" n.º", "");
        html += `<div class="choque" role="alert"><b>${tipoTxt} ${fmt(choque.numero)} de ${esc(q.per)}${q.t === "apuntes" ? "" : " con " + esc(choque.profesor)} ya está en el banco.</b>
          <span>${q.t === "apuntes" ? "Lo subiste tú" : "Lo subió " + esc(choque.autor_nombre)} el ${fechaCorta(choque.creado_en)}: «${esc(choque.titulo)}». No se guardan dos veces.</span>
          <span class="acciones"><a class="btn small" href="#/materia/${encodeURIComponent(q.me.id)}?ver=${encodeURIComponent(choque.material_id || "")}">Ver ese material</a>${libre <= max ? `<button class="btn small" type="button" data-usar="${libre}">Usar el ${fmt(libre)}</button>` : ""}</span></div>`;
      }
      caja.innerHTML = html;
      actualizar();
    }
    $("#s-disp").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-usar]"); if (!b) return;
      el.numero.value = b.dataset.usar; errorCampo(el.numero, ""); pintarDisp(); el.numero.focus();
    });

    // ----- vista previa y estado del botón -----
    function actualizar() {
      const t = N.tipoPorId[tipo()];
      $("#l-numero").textContent = t ? t.numero : "Número";
      el.numero.max = tipo() === "apuntes" ? 18 : 20;
      $("#s-sol-fila").hidden = tipo() === "apuntes";
      const per = periodo();
      $("#s-periodo").innerHTML = per ? `Periodo <b>${per}</b>` : "El periodo sale de la fecha.";
      $("#c-titulo").textContent = el.titulo.value.length;
      $("#c-desc").textContent = el.desc.value.length;
      const mm = meta();
      const me = materiaElegida();
      const falta = (txt) => `<span style="color:var(--faint)">${txt}</span>`;
      $("#s-preview").innerHTML = `<div class="feed-row" aria-hidden="true">
          <span class="f-linea"><span class="tag">${t ? esc(t.numero.replace(" n.º", "")) : "Tipo"} ${mm.numero || "—"}</span><span class="f-tit">${mm.titulo ? esc(mm.titulo) : falta("Título del material")}</span></span>
          <span class="f-sub">${me ? esc(me.m ? nombreMateria(me.m, true) : me.nombre) : falta("Materia")} · ${mm.profesor ? esc(mm.profesor) : falta("Profesor")} · ${per || falta("Periodo")} · tú</span>
          <span class="f-der"><b>${fechaCorta(hoy())}</b>0 descargas</span></div>
        <p class="muted" style="margin-top:10px">${mm.tipo && mm.tipo !== "apuntes" ? (mm.con_solucion ? "Con solución · " : "Sin solución · ") : ""}${archivo ? `${esc(ext({ archivo_tipo: archivo.type }))} · ${peso(archivo.size)}` : "Sin archivo todavía"}</p>`;
      const razon = $("#s-razon");
      const btn = $("#s-enviar");
      if (enviando) return;
      btn.disabled = !!choque;
      razon.textContent = choque ? "Ese número ya está en el banco: cambia el número o revisa el material que ya existe." : "";
    }

    // ----- errores por campo -----
    const campoDe = { materia_id: el.materia, materia_nombre: el.nueva, tipo: form.querySelector("input[name=tipo]"), numero: el.numero, titulo: el.titulo, profesor: el.profe, fecha: el.fecha, descripcion: el.desc, archivo: el.archivo };
    function mostrarErrores(errores) {
      Object.entries(campoDe).forEach(([k, input]) => errorCampo(input, errores[k] || ""));
      const primero = Object.keys(campoDe).find((k) => errores[k]);
      if (primero) campoDe[primero].focus();
    }

    // ----- archivo -----
    function elegir(f) {
      archivo = f || null;
      const caja = $("#s-elegido");
      if (!archivo) { caja.innerHTML = ""; $("#s-drop").hidden = false; actualizar(); return; }
      const errores = API.validarMaterial(meta());
      errorCampo(el.archivo, errores.archivo || "");
      $("#s-drop").hidden = !errores.archivo;
      caja.innerHTML = errores.archivo ? "" : `<div class="archivo-elegido">${icono("archivo")}<span class="nombre">${esc(archivo.name)}</span><span class="muted num">${peso(archivo.size)}</span><button class="btn small ghost" type="button" id="s-cambiar">Cambiar</button></div>`;
      const cambiar = $("#s-cambiar");
      if (cambiar) cambiar.addEventListener("click", () => { el.archivo.value = ""; elegir(null); el.archivo.click(); });
      if (errores.archivo) archivo = null;
      actualizar();
    }
    el.archivo.addEventListener("change", () => elegir(el.archivo.files[0]));
    const drop = $("#s-drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (ev) => { ev.preventDefault(); if (ev.dataTransfer.files[0]) elegir(ev.dataTransfer.files[0]); });

    // ----- eventos de los campos -----
    el.carrera.addEventListener("change", () => {
      const c = el.carrera.value;
      pintarMaterias(c && !N.tienePensum(c) && !N.dinamicasDe(c).length ? NUEVA : "");
      errorCampo(el.carrera, ""); errorCampo(el.materia, ""); profesSugeridos(); revisarDisponibilidad(); actualizar();
    });
    el.materia.addEventListener("change", () => {
      $("#s-nueva-fila").hidden = el.materia.value !== NUEVA;
      if (el.materia.value === NUEVA) el.nueva.focus();
      profesSugeridos(); errorCampo(el.materia, ""); revisarDisponibilidad(); actualizar();
    });
    el.nueva.addEventListener("input", () => {
      errorCampo(el.nueva, "");
      // si el nombre ya está en la lista, se elige esa materia en vez de crear otra
      const ya = N.enPensum(carrera, nombreNueva()) || N.dinamicasDe(carrera).find((m) => N.slugTexto(m.nombre, 80) === N.slugTexto(nombreNueva(), 80));
      if (ya) { pintarMaterias(ya.id); toast(`«${ya.nombre}» ya está en la lista: quedó elegida.`); el.materia.focus(); }
      revisarDisponibilidad(); actualizar();
    });
    $("#s-tipo").addEventListener("change", () => { revisarDisponibilidad(); actualizar(); });
    el.fecha.addEventListener("change", () => { errorCampo(el.fecha, ""); revisarDisponibilidad(); actualizar(); });
    el.profe.addEventListener("input", () => { errorCampo(el.profe, ""); revisarDisponibilidad(); actualizar(); });
    el.numero.addEventListener("input", () => { errorCampo(el.numero, ""); pintarDisp(); });
    [el.titulo, el.desc].forEach((i) => i.addEventListener("input", () => { errorCampo(i, ""); actualizar(); }));
    el.sol.addEventListener("change", actualizar);

    // ----- enviar: crear → subir el archivo → confirmar -----
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (enviando || choque) return;
      const mm = meta();
      const errores = API.validarMaterial(mm);
      if (!el.carrera.value) errores.materia_id = "Elige la carrera y la materia.";
      if (el.materia.value === NUEVA && !nombreNueva()) errores.materia_nombre = "Escribe el nombre de la materia.";
      if (Object.keys(errores).length) { mostrarErrores(errores); $("#s-razon").textContent = "Revisa los campos marcados."; return; }
      enviando = true;
      $("#s-campos").disabled = true;
      const pie = $("#s-pie");
      const antes = pie.innerHTML;
      const pasos = ["Revisando que no esté repetido", "Subiendo el archivo", "Guardándolo en la materia"];
      pie.innerHTML = `<div class="progreso" role="status" style="width:100%"><ol class="pasos">${pasos.map((p, i) => `<li data-paso="${i}">${icono("punto")}<span>${p}</span></li>`).join("")}</ol><div class="barra"><i id="s-barra"></i></div></div>`;
      const paso = (i) => $$(".pasos li", pie).forEach((li, j) => { li.className = j < i ? "hecho" : j === i ? "ahora" : ""; li.querySelector("use").setAttribute("href", j < i ? "#i-check" : "#i-punto"); });
      const barra = (p) => { const b = $("#s-barra"); if (b) b.style.setProperty("--p", p); };
      const volverAlForm = () => { pie.innerHTML = antes; $("#s-campos").disabled = false; enviando = false; actualizar(); };
      try {
        paso(0); barra(0.05);
        const r = await API.crear(mm);
        paso(1);
        await API.subirArchivo(r.subida, archivo, (p) => barra(0.1 + p * 0.75));
        paso(2); barra(0.92);
        const c = await API.confirmar(r.material_id);
        barra(1); paso(3);
        invalidar();
        const it = c.material || Object.assign({}, mm, { material_id: r.material_id });
        N.registrar([it]);
        terminado(it);
      } catch (e) {
        volverAlForm();
        if (e.status === 401) return salirPorSesion();
        if (e.status === 409 && e.datos && e.datos.existente) {
          // otra persona lo subió mientras llenabas el formulario
          disp = null; revisarDisponibilidad();
          $("#s-razon").textContent = "Alguien lo subió hace un momento: ya está en el banco.";
          return;
        }
        if (e.status === 400 && e.datos && e.datos.errores) { mostrarErrores(e.datos.errores); $("#s-razon").textContent = e.message; return; }
        $("#s-razon").textContent = (e.message || "No se pudo subir.") + " Intenta de nuevo.";
      }
    });

    function terminado(it) {
      const m = mat(it);
      form.outerHTML = `<section class="listo s7" aria-live="polite" tabindex="-1" id="s-listo">
        <h2>Listo: ya está en ${esc(nombreMateria(m, true))}</h2>
        <p class="muted">${API.DEMO ? "Modo local: quedó guardado solo en este navegador." : "Ya lo pueden ver y descargar los demás. Las estadísticas lo cuentan en unos minutos."}</p>
        <div class="feed" style="width:100%">${filaFeed(Object.assign({ descargas: 0, creado_en: new Date().toISOString(), autor_id: yo().sub, autor_nombre: yo().nombre, periodo: N.periodoDeFecha(it.fecha) }, it))}</div>
        <div class="form-pie"><a class="btn primary" href="#/materia/${encodeURIComponent(m.id)}?ver=${encodeURIComponent(it.material_id)}">Verlo en la materia</a><a class="btn" href="#/subir?materia=${encodeURIComponent(m.id)}&otro=${Date.now()}">Subir otro</a></div>
      </section>`;
      $("#s-listo").focus();
      toast("Material subido a " + nombreMateria(m, true) + ".");
    }

    actualizar();
    if (pre) revisarDisponibilidad();
  }

  // campo con error: mensaje debajo, aria-invalid y aria-errormessage
  function errorCampo(input, texto) {
    if (!input) return;
    const field = input.closest(".field");
    if (!field) return;
    let e = field.querySelector(":scope > .error");
    if (!texto) { if (e) e.remove(); input.removeAttribute("aria-invalid"); return; }
    if (!e) { e = document.createElement("p"); e.className = "error"; e.id = (input.id || input.name) + "-error"; field.appendChild(e); }
    e.innerHTML = icono("alerta") + "<span></span>";
    e.querySelector("span").textContent = texto;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-errormessage", e.id);
  }

  // =====================================================================
  // MIS APORTES
  // =====================================================================
  async function misAportes(ctx) {
    titulo("Mis aportes");
    vista.innerHTML = `<div class="page">
      <div class="title-row"><div><h1>Mis aportes</h1><p class="sub" id="a-sub">Lo que has subido a NASH.</p></div>
        <div class="acciones"><a class="btn primary" href="#/subir">${icono("subir")}Subir material</a></div></div>
      <div class="kstrip" id="a-kpis">${[0, 1, 2].map(() => `<div>${sk("50%")}<span style="display:block;margin-top:10px">${sk("30%", 26)}</span></div>`).join("")}</div>
      <section class="panel" aria-label="Mis archivos"><div id="a-cuerpo">${filasCargando(3)}</div></section>
      <section class="panel" style="margin-top:var(--gap)" aria-labelledby="t-huecos" id="a-huecos" hidden></section>
    </div>`;
    let r;
    try { r = await API.misAportes(); } catch (e) { if (ctx.vigente()) { errorEn($("#a-cuerpo"), e, () => render()); $("#a-kpis").remove(); } return; }
    if (!ctx.vigente()) return;
    const mios = r.items || [];
    N.registrar(mios);
    const descargas = mios.reduce((s, it) => s + (Number(it.descargas) || 0), 0);
    const materias = new Set(mios.map((it) => it.materia_id)).size;
    $("#a-sub").textContent = mios.length ? "Todo lo que has subido, con cuántas veces lo han descargado." : "Todavía no has subido nada.";
    if (!mios.length) $("#a-kpis").remove();
    else $("#a-kpis").innerHTML = `<div><span class="kpi-label">Archivos subidos</span><div class="kpi-value">${fmt(mios.length)}</div></div>
      <div><span class="kpi-label">Descargas de tus archivos</span><div class="kpi-value">${fmt(descargas)}</div></div>
      <div><span class="kpi-label">Materias</span><div class="kpi-value">${fmt(materias)}</div></div>`;
    $("#a-cuerpo").innerHTML = mios.length ? tabla(mios, { conMateria: true, sinAutor: true })
      : `<div class="empty"><b>Aún no has subido nada.</b>Empieza por un parcial que ya te devolvieron o tus apuntes de una semana. Queda con tu nombre en la materia.<a class="btn primary" href="#/subir">Subir material</a></div>`;

    // materias del pensum de tu carrera que siguen vacías: donde un aporte rinde más
    const car = miCarrera();
    if (!car || !N.tienePensum(car)) return;
    try {
      const todos = await lista();
      if (!ctx.vigente()) return;
      const c = conteos(todos);
      const delPensum = N.pensumDe(car);
      const vacias = delPensum.filter((m) => !c[m.id]);
      const caja = $("#a-huecos");
      caja.hidden = false;
      caja.innerHTML = `<header><h2 id="t-huecos">Materias de ${esc(nombreCarrera(car))} sin nada todavía <span class="count">· ${fmt(vacias.length)} de ${delPensum.length}</span></h2></header>
        ${vacias.length ? `<p class="muted" style="margin-bottom:14px">Si ya viste alguna, lo primero que subas es lo único que habrá de ella.</p>
        <div class="huecos">${vacias.map((m) => `<a href="#/subir?materia=${encodeURIComponent(m.id)}">${m.codigo ? `<span class="cod">${esc(m.codigo)}</span>` : ""}${esc(m.corto || m.nombre)}</a>`).join("")}</div>`
        : `<p class="muted">Todas las materias del pensum tienen al menos un archivo.</p>`}`;
    } catch (e) { /* el bloque es opcional */ }
  }

  // =====================================================================
  // ESTADÍSTICAS
  // =====================================================================
  async function estadisticas(ctx) {
    titulo("Estadísticas");
    vista.innerHTML = `<div class="page">
      <div class="title-row"><div><h1>Estadísticas</h1><p class="sub" id="x-sub">Cómo va el banco: qué hay, de qué carreras y qué es lo que más se descarga.</p></div></div>
      <div id="x-cuerpo">${filasCargando(4)}</div>
    </div>`;
    let r;
    try { r = await API.estadisticas(); } catch (e) { if (ctx.vigente()) errorEn($("#x-cuerpo"), e, () => render()); return; }
    if (!ctx.vigente()) return;
    N.registrar(r.masDescargados || []);
    const total = r.total || 0;
    if (!total) { estadisticasVacias(); return; }
    const porCarrera = (r.porCarrera || []).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    const conMaterial = porCarrera.filter((x) => x.carrera_id !== "nucleo").length;
    const maxCar = Math.max(1, ...porCarrera.map((x) => x.total));
    const tipos = r.porTipo.slice().sort((a, b) => b.total - a.total);
    const maxTipo = Math.max(...tipos.map((x) => x.total), 1);
    const maxPer = Math.max(...r.porPeriodo.map((x) => x.total), 1);
    const perRec = r.porPeriodo.slice().reverse();
    const aportantes = r.topAportantes || [];
    const barra = (lbl, v, max, top) => `<li${top ? ' class="top"' : ""}><span class="t">${lbl}</span><span class="v">${fmt(v)}</span><span class="b" style="--w:${(v / max) * 100}%"></span></li>`;

    $("#x-cuerpo").innerHTML = `
      <div class="kstrip">
        <div><span class="kpi-label">Archivos en el banco</span><div class="kpi-value">${fmt(total)}</div></div>
        <div><span class="kpi-label">Carreras con material</span><div class="kpi-value">${fmt(conMaterial)} <span class="muted" style="font-size:var(--fs-body)">de ${N.CARRERAS.length}</span></div></div>
        <div><span class="kpi-label">Personas que han subido algo</span><div class="kpi-value">${fmt(r.autores || aportantes.length)}</div></div>
      </div>
      <div class="grid">
        <section class="panel s8" aria-labelledby="t-car"><header><h2 id="t-car">Archivos por carrera</h2><span class="meta">${fmt(total)} en total</span></header>
          <ul class="barlist grande" aria-describedby="x-car-nota">${porCarrera.map((x) => barra(esc(nombreCarrera(x.carrera_id, true)), x.total, maxCar, x.total === maxCar)).join("")}</ul>
          <p class="muted" id="x-car-nota" style="margin-top:16px">${N.CARRERAS.length - conMaterial ? `Las otras ${fmt(N.CARRERAS.length - conMaterial)} carreras todavía no tienen material.` : "Todas las carreras tienen material."}${porCarrera.some((x) => x.carrera_id === "nucleo") ? " El núcleo rosarista se cuenta aparte: le sirve a todas." : ""}</p></section>
        <section class="panel s4" aria-labelledby="t-tipo"><header><h2 id="t-tipo">Por tipo</h2></header>
          <ul class="barlist">${tipos.map((x) => barra(mayus(N.tipoPorId[x.tipo].plural), x.total, maxTipo, x.total === maxTipo && x.total > 0)).join("")}</ul>
          <p class="cadena-sub" style="margin-top:20px">Por periodo en que se presentó</p>
          <ul class="barlist">${perRec.map((x) => barra(esc(x.periodo), x.total, maxPer, x.total === maxPer)).join("")}</ul></section>
        <section class="panel s8" aria-labelledby="t-desc"><header><h2 id="t-desc">Lo más descargado</h2></header>
          <div class="table-wrap"><table class="responsive"><thead><tr><th>Material</th><th>Subido por</th><th class="n">Descargas</th></tr></thead><tbody>
          ${r.masDescargados.map((it) => { const m = mat(it); return `<tr><td><div class="t-mat"><span class="tag">${esc(etiqueta(it))}</span><div><b><a class="link" href="#/materia/${encodeURIComponent(m.id)}?ver=${encodeURIComponent(it.material_id || "")}">${esc(it.titulo)}</a></b><span class="sub">${esc(nombreMateria(m, true))} · ${esc(nombreCarrera(m.carrera))}<span class="solo-movil"> · ${esc(it.autor_nombre)}</span></span></div></div></td><td class="m-ocultar">${esc(it.autor_nombre)}</td><td class="n m-der num">${fmt(it.descargas)}</td></tr>`; }).join("")}
          </tbody></table></div></section>
        <section class="panel s4" aria-labelledby="t-aut"><header><h2 id="t-aut">Quién más aporta</h2></header>
          <ul class="gente">${aportantes.map((a) => `<li>${avatar(a.autor_nombre, a.autor_nombre === yo().nombre)}<span class="nombre">${esc(a.autor_nombre)}</span><span class="n">${plural(a.aportes, "archivo", "archivos")}</span></li>`).join("")}</ul>
          <p class="muted" style="margin-top:14px">Sus archivos suman ${plural(aportantes.reduce((s, a) => s + (a.descargas || 0), 0), "descarga", "descargas")}.</p></section>
      </div>`;
  }

  /** El banco sin material: la misma estructura con ceros y los datos que ya existen (carreras, pensum, tipos). */
  function estadisticasVacias() {
    const cero = (lbl, nota) => `<li class="cero"><span class="t">${lbl}</span><span class="v">${nota || "0"}</span><span class="b"></span></li>`;
    const barra = (lbl, v, max, nota) => `<li><span class="t">${lbl}</span><span class="v">${nota || fmt(v)}</span><span class="b" style="--w:${(v / max) * 100}%"></span></li>`;
    const porFac = N.FACULTADES.map((f) => ({ f, n: N.CARRERAS.filter((c) => c.facultad === f).length })).sort((a, b) => b.n - a.n);
    const maxFac = Math.max(1, ...porFac.map((x) => x.n));
    const car = miCarrera();
    const sems = car && N.tienePensum(car) ? N.semestresDe(car) : [];
    const cobertura = sems.length
      ? `<section class="panel s12" aria-labelledby="t-cob"><header><h2 id="t-cob">${esc(nombreCarrera(car, true))}: materias con material</h2><span class="meta">0 de ${fmt(N.pensumDe(car).length)}</span></header>
          <ul class="barlist dos">${sems.map((s) => cero("Semestre " + N.ROMANOS[s], "0 de " + N.pensumDe(car).filter((m) => m.semestre === s).length)).join("")}</ul>
          <p class="muted" style="margin-top:16px">Cada materia que reciba su primer archivo cuenta aquí.</p></section>`
      : `<section class="panel s8" aria-labelledby="t-cob"><header><h2 id="t-cob">${car ? esc(nombreCarrera(car, true)) : "Tu carrera"}</h2></header>
          <p class="muted">${car ? "Esta carrera no tiene el pensum cargado en NASH: sus materias aparecen a medida que alguien sube material y escribe el nombre." : "Elige tu carrera en el menú para ver aquí cuántas de sus materias ya tienen material."}</p></section>`;
    $("#x-cuerpo").innerHTML = `
      <div class="empty" style="margin-bottom:var(--gap)"><b>El banco está empezando.</b>Abajo está todo lo que se va a medir; las cifras se llenan con cada subida${API.DEMO ? "" : " (unos minutos después de cada una)"}.<a class="btn primary" href="#/subir">${icono("subir")}Subir el primero</a></div>
      <div class="kstrip">
        <div><span class="kpi-label">Archivos en el banco</span><div class="kpi-value">0</div></div>
        <div><span class="kpi-label">Carreras con material</span><div class="kpi-value">0 <span class="muted" style="font-size:var(--fs-body)">de ${N.CARRERAS.length}</span></div></div>
        <div><span class="kpi-label">Materias en pensums cargados</span><div class="kpi-value">${fmt(N.MATERIAS.length)}</div></div>
      </div>
      <div class="grid">
        <section class="panel s8" aria-labelledby="t-fac"><header><h2 id="t-fac">Carreras en NASH por facultad</h2><span class="meta">${fmt(N.CARRERAS.length)} en total</span></header>
          <ul class="barlist grande">${porFac.map((x) => barra(esc(x.f), x.n, maxFac, plural(x.n, "carrera", "carreras"))).join("")}</ul></section>
        <section class="panel s4" aria-labelledby="t-tipo"><header><h2 id="t-tipo">Por tipo</h2></header>
          <ul class="barlist">${N.TIPOS.map((t) => cero(mayus(t.plural))).join("")}</ul>
          <p class="muted" style="margin-top:16px">Lo más descargado y quién más aporta aparecen con los primeros archivos.</p></section>
        ${cobertura}
      </div>`;
  }

  function noEncontrada() {
    titulo("No existe");
    vista.innerHTML = `<div class="page"><div class="title-row"><div><h1>Esa página no existe</h1><p class="sub">Puede que la materia o el enlace hayan cambiado.</p></div></div><a class="btn primary" href="#/">Volver al inicio</a></div>`;
  }

  // ---------- shell ----------
  function titulo(t) {
    document.title = t + " · NASH";
    $("#titulo-movil").textContent = t;
  }
  function navActual(nombre) {
    $$("[data-nav]").forEach((a) => (a.dataset.nav === nombre ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }
  function pintarCarreraLateral() {
    const car = miCarrera();
    $("#brand-carrera").textContent = car ? nombreCarrera(car) : "Universidad del Rosario";
    $("#carrera-lateral").innerHTML = `${car ? "" : `<option value="">Elige tu carrera</option>`}${opcionesCarrera(car)}`;
  }
  const sidebar = $("#sidebar");
  const abrir = $("#abrir-menu");
  function cerrarMenu() { sidebar.classList.remove("open"); abrir.setAttribute("aria-expanded", "false"); }
  function abrirMenu() { sidebar.classList.add("open"); abrir.setAttribute("aria-expanded", "true"); $("#cerrar-menu").focus(); }
  abrir.addEventListener("click", abrirMenu);
  $("#yo-movil").addEventListener("click", abrirMenu);
  $("#cerrar-menu").addEventListener("click", () => { cerrarMenu(); abrir.focus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sidebar.classList.contains("open")) { cerrarMenu(); abrir.focus(); } });
  sidebar.addEventListener("click", (e) => { if (e.target.closest("a")) cerrarMenu(); });
  $("#buscar-lateral").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q-lateral").value.trim();
    location.hash = "#/explorar" + (q ? "?q=" + encodeURIComponent(q) : "");
  });
  $("#carrera-lateral").addEventListener("change", (e) => {
    A.fijarCarrera(e.target.value);
    pintarCarreraLateral();
    toast("Ahora ves primero " + nombreCarrera(e.target.value, true) + ".");
    const ruta = (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]) || "inicio";
    if (ruta === "inicio" || ruta === "mis-aportes") render();
  });
  $("#salir").addEventListener("click", () => { A.salir(); location.replace("index.html"); });

  // ---------- rutas ----------
  let generacion = 0;
  let primera = true;
  async function render() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [ruta, qs] = h.split("?");
    const partes = ruta.split("/").filter(Boolean);
    const q = new URLSearchParams(qs || "");
    const gen = ++generacion;
    cerrarMenu();
    const nombre = partes[0] || "inicio";
    const vistas = { inicio, explorar, materia, subir, "mis-aportes": misAportes, estadisticas };
    navActual(nombre === "materia" ? "explorar" : nombre);
    window.scrollTo(0, 0);
    if (!primera) vista.focus({ preventScroll: true });
    primera = false;
    try { await (vistas[nombre] || noEncontrada)({ partes, q, vigente: () => gen === generacion }); }
    catch (e) {
      if (gen !== generacion) return;
      if (e && e.status === 401) return salirPorSesion();
      console.error(e);
      vista.innerHTML = `<div class="page"><div class="err-box" role="alert">${icono("alerta")}<span>Algo falló al mostrar esta página: ${esc(e.message || e)}</span><button class="btn small" type="button" onclick="location.reload()">Recargar</button></div></div>`;
    }
  }

  // ---------- arranque: sesión ----------
  async function arrancar() {
    if (!A.sesion()) {
      if (A.DEMO && A.CUENTA_PRUEBA && /[?&]demo(=|&|$)/.test(location.search)) {
        const c = A.CUENTA_PRUEBA;
        try { await A.ingresar({ email: c.email, password: c.password }); } catch (e) { /* cae al ingreso normal */ }
      }
      if (!A.sesion()) { location.replace("ingresar.html?volver=" + encodeURIComponent(location.hash || "#/")); return; }
    }
    const s = yo();
    $("#yo-nombre").textContent = s.nombre || s.email;
    $("#yo-email").textContent = s.email || "";
    $("#yo-avatar").textContent = iniciales(s.nombre || s.email);
    $("#yo-movil").textContent = iniciales(s.nombre || s.email);
    $("#yo-movil").setAttribute("aria-label", `Tu cuenta: ${s.nombre || s.email}`);
    $("#nota-demo").hidden = !API.DEMO;
    pintarCarreraLateral();
    addEventListener("hashchange", render);
    render();
  }
  arrancar();
})();
