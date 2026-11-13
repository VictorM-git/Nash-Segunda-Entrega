(function () {
  const N = window.NASH;
  const A = N.auth;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, uno, varios) => `${Number(n || 0).toLocaleString("es-CO")} ${n === 1 ? uno : varios}`;

  const s = A.sesion();
  if (s) {
    $$('[data-sesion="fuera"]').forEach((el) => (el.hidden = true));
    $$('[data-sesion="dentro"]').forEach((el) => (el.hidden = false));
    const nombre = s.nombre || s.email || "";
    const ini = nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
    $$('[data-yo="nombre"]').forEach((el) => (el.textContent = nombre));
    $$('[data-yo="iniciales"]').forEach((el) => (el.textContent = ini));
  }
  $$("[data-salir]").forEach((b) => b.addEventListener("click", () => { A.salir(); location.reload(); }));
  const nCarreras = $("#n-carreras");
  if (nCarreras) nCarreras.textContent = N.CARRERAS.length;

  const boton = $(".menu-word");
  const hoja = $("#menu-movil");
  if (boton && hoja) {
    const cerrar = () => { hoja.hidden = true; boton.setAttribute("aria-expanded", "false"); boton.textContent = "Menú"; };
    boton.addEventListener("click", () => {
      const abrir = hoja.hidden;
      hoja.hidden = !abrir;
      boton.setAttribute("aria-expanded", String(abrir));
      boton.textContent = abrir ? "Cerrar" : "Menú";
    });
    hoja.addEventListener("click", (e) => e.target.closest("a") && cerrar());
    document.addEventListener("keydown", (e) => e.key === "Escape" && !hoja.hidden && (cerrar(), boton.focus()));
  }

  const selector = $("#l-carrera");
  const tabsCaja = $("#tabs");
  const lista = $("#filas-pensum");
  const pie = $("#pie-pensum");
  let conteos = null;
  let carrera = (s && N.carreraPorId[A.carrera()] ? A.carrera() : "") || "macc";
  let tab = null;

  if (selector) {
    selector.innerHTML = N.FACULTADES.map((f) => `<optgroup label="${esc(f)}">${N.CARRERAS.filter((c) => c.facultad === f).map((c) => `<option value="${c.id}"${c.id === carrera ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</optgroup>`).join("");
    selector.addEventListener("change", () => { carrera = selector.value; tab = null; pintarTabs(); pintar(true); });
  }

  const total = (m) => (conteos && conteos.materias[m.id] ? conteos.materias[m.id].total : 0);
  const valor = (m) => (conteos ? plural(total(m), "archivo", "archivos") : "Ver material");
  function nota(m) {
    if (m.nucleo) return "núcleo rosarista, para todas las carreras";
    if (m.dinamica) return "agregada por estudiantes";
    if (!m.prer.length) return "sin prerrequisitos";
    return "requiere " + m.prer.map((p) => N.porId[p].codigo).join(", ");
  }
  function partes() {
    const p = N.semestresDe(carrera).map((sem) => ({ id: "s" + sem, label: N.ROMANOS[sem], nombre: "Semestre " + N.ROMANOS[sem], materias: N.pensumDe(carrera).filter((m) => m.semestre === sem) }));
    const din = N.dinamicasDe(carrera);
    if (!N.tienePensum(carrera) || din.length) p.push({ id: "otras", label: N.tienePensum(carrera) ? "Otras" : "Materias", nombre: N.tienePensum(carrera) ? "Otras materias" : "Materias", txt: true, materias: din });
    p.push({ id: "nucleo", label: "Núcleo", nombre: "Núcleo rosarista", txt: true, materias: N.nucleo() });
    return p;
  }
  function pintarTabs() {
    const ps = partes();
    if (!ps.some((p) => p.id === tab)) tab = ps[0].id;
    tabsCaja.innerHTML = ps.map((p) => `<button role="tab" type="button" class="${p.txt ? "txt" : ""}" aria-selected="${p.id === tab}" tabindex="${p.id === tab ? 0 : -1}" data-tab="${p.id}" aria-label="${esc(p.nombre)}">${esc(p.label)}</button>`).join("");
  }
  function pintar(animar) {
    const C = N.carreraPorId[carrera];
    const p = partes().find((x) => x.id === tab);
    const materias = p.materias;
    const html = materias.length
      ? materias.map((m) => `<li><a href="app.html#/materia/${encodeURIComponent(m.id)}"><span class="cod">${m.codigo ? esc(m.codigo) : "·"}</span><span class="nom">${esc(m.nombre)}<small>${nota(m)}</small></span><span class="val">${valor(m)}</span></a></li>`).join("")
      : `<li class="vacio"><b>Todavía no hay materias de ${esc(C.nombre)} con material.</b><span>El pensum de esta carrera no está cargado en NASH: sus materias aparecen aquí cuando alguien sube la primera y escribe su nombre.</span><a class="button" href="${s ? "app.html#/subir" : "ingresar.html#crear"}">${s ? "Subir el primero" : "Crear cuenta y subir el primero"}</a></li>`;
    const aplicar = () => {
      lista.innerHTML = html;
      lista.classList.remove("cambiando");
      const archivos = materias.reduce((t, m) => t + total(m), 0);
      const enCarrera = conteos && conteos.carreras ? conteos.carreras[carrera] || 0 : null;
      pie.textContent = `${C.corto} · ${p.nombre}: ${plural(materias.length, "materia", "materias")}` +
        (conteos ? ` y ${plural(archivos, "archivo", "archivos")} en el banco.` : ".") +
        (enCarrera !== null && p.id !== "nucleo" ? ` En toda la carrera: ${plural(enCarrera, "archivo", "archivos")}.` : "");
    };
    if (animar && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      lista.classList.add("cambiando");
      setTimeout(aplicar, 160);
    } else aplicar();
  }
  function elegir(id, enfocar) {
    tab = id;
    $$("[role=tab]", tabsCaja).forEach((t) => {
      const si = t.dataset.tab === id;
      t.setAttribute("aria-selected", String(si));
      t.tabIndex = si ? 0 : -1;
      if (si && enfocar) t.focus();
    });
    pintar(true);
  }
  if (tabsCaja) {
    tabsCaja.addEventListener("click", (e) => { const t = e.target.closest("[role=tab]"); if (t) elegir(t.dataset.tab); });
    tabsCaja.addEventListener("keydown", (e) => {
      const tabs = $$("[role=tab]", tabsCaja);
      const i = tabs.findIndex((t) => t.dataset.tab === tab);
      const ir = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
      if (ir === undefined) return;
      e.preventDefault(); elegir(tabs[ir].dataset.tab, true);
    });
    pintarTabs();
    pintar(false);
    N.api.resumenPublico()
      .then((r) => {
        conteos = r;
        N.registrar(Object.entries(r.materias || {}).map(([id, v]) => ({ materia_id: id, materia_nombre: v.materia_nombre, carrera_id: v.carrera_id })));
        pintarTabs(); pintar(false);
        pintarBanco(r);
      })
      .catch(() => pintarBanco(null));
  }

  function pintarBanco(r) {
    const num = (n) => Number(n || 0).toLocaleString("es-CO");
    const poner = (id, v) => { const el = $("#" + id); if (el) el.textContent = v; };
    const caja = $("#top-carreras");
    if (!caja) return;
    poner("k-carreras", N.CARRERAS.length);
    if (!r) {
      ["k-archivos", "k-activas", "k-materias", "k-evaluaciones"].forEach((id) => poner(id, "—"));
      caja.innerHTML = `<li class="barras-vacio">No se pudo leer el banco en este momento.</li>`;
      return;
    }
    const t = r.totales || {};
    const carreras = Object.entries(r.carreras || {}).filter(([id, n]) => n > 0);
    poner("k-archivos", num(t.total));
    poner("k-activas", num(carreras.length));
    poner("k-materias", num(Object.values(r.materias || {}).filter((m) => m.total > 0).length));
    poner("k-evaluaciones", num((t.parcial || 0) + (t.quiz || 0)));
    if (!carreras.length) {
      caja.innerHTML = `<li class="barras-vacio">Todavía nadie ha subido material. La primera carrera que suba algo abre esta lista.</li>`;
      return;
    }
    const top = carreras.sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = top[0][1];
    caja.innerHTML = top.map(([id, n]) => {
      const c = N.carreraPorId[id];
      const nombre = id === "nucleo" ? "Núcleo rosarista" : c ? c.nombre : id;
      return `<li><span class="b-nom">${esc(nombre)}</span><span class="b-val">${plural(n, "archivo", "archivos")}</span><span class="b-pista" aria-hidden="true"><i style="width:${Math.round((n / max) * 100)}%"></i></span></li>`;
    }).join("");
  }

  const targets = document.querySelectorAll("[data-reveal]");
  if (!("IntersectionObserver" in window)) targets.forEach((el) => el.classList.add("is-in"));
  else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    targets.forEach((el) => io.observe(el));
    addEventListener("load", () => setTimeout(() => targets.forEach((el) => {
      const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add("is-in");
    }), 2500));
  }
})();
