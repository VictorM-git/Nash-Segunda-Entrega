(function () {
  const CFG = window.NASH_CONFIG || {};
  const N = window.NASH;
  const DEMO = !CFG.API_URL;
  const MAX_BYTES = (CFG.MAX_MB || 10) * 1024 * 1024;
  const TIPOS_ARCHIVO = ["application/pdf", "image/jpeg", "image/png"];

  class ApiError extends Error {
    constructor(mensaje, status, datos) { super(mensaje); this.status = status; this.datos = datos || {}; }
  }

  function hoyISO() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function claveUnicidad(meta, autorId) { return meta.tipo === "apuntes" ? autorId : N.slug(meta.profesor); }

  function validarMaterial(m) {
    const e = {};
    const mat = N.porId[m.materia_id];
    if (!m.materia_id) e.materia_id = "Elige la materia.";
    else if (!mat || mat.dinamica) {
      const nombre = String(m.materia_nombre || "").replace(/\s+/g, " ").trim();
      const err = N.validarNombreMateria(nombre);
      const enPensum = !err && N.carreraPorId[m.carrera_id] && N.enPensum(m.carrera_id, nombre);
      if (!N.carreraPorId[m.carrera_id]) e.materia_id = "Elige la carrera.";
      else if (err) e.materia_nombre = err;
      else if (enPensum) e.materia_nombre = `Esa materia ya está en la lista: ${enPensum.codigo ? enPensum.codigo + " · " : ""}${enPensum.nombre}. Elígela ahí.`;
      else if (N.idDinamico(m.carrera_id, nombre) !== m.materia_id) e.materia_id = "Elige la materia otra vez.";
    }
    if (!N.tipoPorId[m.tipo]) e.tipo = "Elige el tipo de material.";
    const num = Number(m.numero);
    const max = m.tipo === "apuntes" ? 18 : 20;
    if (!Number.isInteger(num) || num < 1 || num > max) e.numero = m.tipo === "apuntes" ? "La semana va de 1 a 18." : `Escribe un número entre 1 y ${max}.`;
    const t = String(m.titulo || "").trim();
    if (t.length < 4 || t.length > 90) e.titulo = "El título va de 4 a 90 caracteres.";
    const p = String(m.profesor || "").trim();
    if (p.length < 3 || p.length > 60 || !/^[\p{L} .'-]+$/u.test(p)) e.profesor = "Escribe el nombre del profesor (solo letras).";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha || "") || isNaN(Date.parse(m.fecha))) e.fecha = "Escribe la fecha.";
    else if (m.fecha > hoyISO()) e.fecha = "La fecha no puede ser futura.";
    else if (m.fecha < "2015-01-01") e.fecha = "La fecha debe ser de 2015 en adelante.";
    if (String(m.descripcion || "").length > 400) e.descripcion = "Máximo 400 caracteres.";
    if (!m.archivo_nombre) e.archivo = "Adjunta el archivo.";
    else if (!TIPOS_ARCHIVO.includes(m.archivo_tipo)) e.archivo = "Solo PDF, JPG o PNG.";
    else if (!(m.archivo_bytes > 0) || m.archivo_bytes > MAX_BYTES) e.archivo = `El archivo pesa más de ${CFG.MAX_MB || 10} MB.`;
    return e;
  }

  async function pedir(ruta, { metodo = "GET", cuerpo, publico = false } = {}) {
    const headers = {};
    if (cuerpo) headers["Content-Type"] = "application/json";
    if (!publico) {
      const tok = await N.auth.token();
      if (!tok) throw new ApiError("Tu sesión terminó. Vuelve a ingresar.", 401);
      headers.Authorization = "Bearer " + tok;
    }
    let res;
    try {
      res = await fetch(CFG.API_URL.replace(/\/$/, "") + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    } catch (e) {
      throw new ApiError("No hay conexión con el servidor. Revisa tu red e intenta de nuevo.", 0);
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(datos.mensaje || datos.message || `El servidor respondió ${res.status}.`, res.status, datos);
    return datos;
  }
  const qs = (o) => {
    const p = new URLSearchParams();
    Object.entries(o || {}).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && p.set(k, v));
    const s = p.toString();
    return s ? "?" + s : "";
  };

  function subirArchivoS3(subida, archivo, alProgresar) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      Object.entries(subida.fields || {}).forEach(([k, v]) => fd.append(k, v));
      fd.append("file", archivo);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", subida.url);
      xhr.upload.onprogress = (e) => e.lengthComputable && alProgresar && alProgresar(e.loaded / e.total);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError("El archivo no se pudo guardar (" + xhr.status + "). Intenta de nuevo.", xhr.status)));
      xhr.onerror = () => reject(new ApiError("No se pudo subir el archivo. Revisa tu conexión.", 0));
      xhr.send(fd);
    });
  }

  const real = {
    resumenPublico: () => pedir("/publico/resumen", { publico: true }),
    listar: (f) => pedir("/materiales" + qs(f)),
    disponibilidad: (f) => pedir("/materiales/disponibilidad" + qs(f)),
    crear: (meta) => pedir("/materiales", { metodo: "POST", cuerpo: meta }),
    subirArchivo: subirArchivoS3,
    confirmar: (id) => pedir(`/materiales/${encodeURIComponent(id)}/confirmar`, { metodo: "POST", cuerpo: {} }),
    descargar: (id) => pedir(`/materiales/${encodeURIComponent(id)}/descarga`),
    misAportes: () => pedir("/yo/aportes"),
    estadisticas: () => pedir("/estadisticas")
  };

  const CLAVE = "nash.local.items";
  const espera = (min, max) => new Promise((r) => setTimeout(r, min + Math.random() * ((max || min) - min)));
  const archivosEnMemoria = {};
  const pendientes = {};

  function items() {
    let lista = null;
    try { lista = JSON.parse(localStorage.getItem(CLAVE)); } catch (e) {}
    return Array.isArray(lista) ? lista : [];
  }
  function guardar(lista) { try { localStorage.setItem(CLAVE, JSON.stringify(lista)); } catch (e) {} }
  function yo() { const s = N.auth.sesion(); return s ? { sub: s.sub, nombre: s.nombre } : null; }
  function requiereSesion() { if (!yo()) throw new ApiError("Tu sesión terminó. Vuelve a ingresar.", 401); }
  const ordenar = (l) => l.sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1));
  const vacio = () => ({ apuntes: 0, parcial: 0, quiz: 0, ejercicios: 0, total: 0 });

  function resumen(lista) {
    const materias = {};
    const carreras = {};
    const totales = vacio();
    lista.forEach((it) => {
      const r = (materias[it.materia_id] = materias[it.materia_id] || Object.assign({ carrera_id: it.carrera_id, materia_nombre: it.materia_nombre, ultimo: null }, vacio()));
      r[it.tipo]++; r.total++; totales[it.tipo]++; totales.total++;
      carreras[it.carrera_id] = (carreras[it.carrera_id] || 0) + 1;
      if (!r.ultimo || it.creado_en > r.ultimo) r.ultimo = it.creado_en;
    });
    return { materias, carreras, totales, fuente: "local" };
  }

  const limpio = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function filtrar(lista, f) {
    const q = limpio(f.q);
    return lista.filter((it) =>
      (!f.materia || it.materia_id === f.materia) &&
      (!f.tipo || it.tipo === f.tipo) &&
      (!f.periodo || it.periodo === f.periodo) &&
      (!f.autor || it.autor_id === f.autor) &&
      (!q || limpio(`${it.titulo} ${it.profesor} ${it.autor_nombre} ${it.materia_nombre}`).includes(q)));
  }

  const demo = {
    async resumenPublico() { await espera(150, 300); return resumen(items()); },
    async listar(f = {}) { await espera(200, 400); requiereSesion(); return { items: ordenar(filtrar(items(), f)), fuente: "local" }; },
    async disponibilidad({ materia, tipo, periodo, profesor }) {
      await espera(150, 300); requiereSesion();
      const clave = claveUnicidad({ tipo, profesor }, yo().sub);
      const ocupados = items().filter((it) => it.materia_id === materia && it.tipo === tipo && it.periodo === periodo)
        .map((it) => ({ numero: it.numero, clave: claveUnicidad(it, it.autor_id), titulo: it.titulo, autor_nombre: it.autor_nombre, profesor: it.profesor, creado_en: it.creado_en, material_id: it.material_id }))
        .sort((a, b) => a.numero - b.numero);
      return { clave, ocupados, fuente: "local" };
    },
    async crear(meta) {
      await espera(250, 450); requiereSesion();
      const errores = validarMaterial(meta);
      if (Object.keys(errores).length) throw new ApiError("Revisa los campos marcados.", 400, { errores });
      const periodo = N.periodoDeFecha(meta.fecha);
      const clave = claveUnicidad(meta, yo().sub);
      const choque = items().find((it) => it.materia_id === meta.materia_id && it.tipo === meta.tipo && it.periodo === periodo && it.numero === Number(meta.numero) && claveUnicidad(it, it.autor_id) === clave);
      if (choque) throw new ApiError("Ese material ya está en el banco.", 409, { error: "duplicado", existente: choque });
      const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const mat = N.porId[meta.materia_id];
      const carrera = mat && !mat.dinamica ? mat.carrera : meta.carrera_id;
      const nombre = mat && !mat.dinamica ? mat.nombre : String(meta.materia_nombre).replace(/\s+/g, " ").trim();
      pendientes[id] = Object.assign({}, meta, { numero: Number(meta.numero), periodo, carrera_id: carrera, materia_nombre: nombre });
      return { material_id: id, subida: { url: "local://", fields: {} } };
    },
    async subirArchivo(subida, archivo, alProgresar) {
      for (let p = 0.15; p <= 1.0001; p += 0.2) { await espera(90); alProgresar && alProgresar(Math.min(1, p)); }
      demo._ultimoArchivo = archivo;
    },
    async confirmar(id) {
      await espera(300, 500); requiereSesion();
      const meta = pendientes[id]; if (!meta) throw new ApiError("No encontramos esa subida. Empieza de nuevo.", 404);
      const u = yo();
      const it = Object.assign({}, meta, {
        material_id: id, titulo: meta.titulo.trim(), profesor: meta.profesor.trim(), profesor_slug: N.slug(meta.profesor),
        autor_id: u.sub, autor_nombre: u.nombre, creado_en: new Date().toISOString().replace(/\.\d+Z$/, "Z"), descargas: 0
      });
      if (demo._ultimoArchivo) archivosEnMemoria[id] = URL.createObjectURL(demo._ultimoArchivo);
      const lista = items(); lista.push(it); guardar(lista); delete pendientes[id];
      return { material: it };
    },
    async descargar(id) {
      await espera(150, 300); requiereSesion();
      const lista = items(); const it = lista.find((x) => x.material_id === id);
      if (!it) throw new ApiError("Ese material ya no existe.", 404);
      it.descargas = (it.descargas || 0) + 1; guardar(lista);
      return { url: archivosEnMemoria[id] || null, nombre: it.archivo_nombre, local: true };
    },
    async misAportes() { await espera(200, 400); requiereSesion(); return { items: ordenar(filtrar(items(), { autor: yo().sub })), fuente: "local" }; },
    async estadisticas() {
      await espera(300, 500); requiereSesion();
      const l = items();
      const cuenta = (clave) => { const o = {}; l.forEach((it) => (o[it[clave]] = (o[it[clave]] || 0) + 1)); return o; };
      const car = cuenta("carrera_id");
      const porCarrera = Object.keys(car).map((c) => ({ carrera_id: c, total: car[c] })).sort((a, b) => b.total - a.total);
      const porTipo = N.TIPOS.map((t) => ({ tipo: t.id, total: l.filter((it) => it.tipo === t.id).length }));
      const per = cuenta("periodo");
      const porPeriodo = Object.keys(per).sort().map((p) => ({ periodo: p, total: per[p] }));
      const aut = {};
      l.forEach((it) => { const a = (aut[it.autor_id] = aut[it.autor_id] || { autor_nombre: it.autor_nombre, aportes: 0, descargas: 0 }); a.aportes++; a.descargas += it.descargas || 0; });
      const topAportantes = Object.values(aut).sort((a, b) => b.aportes - a.aportes || b.descargas - a.descargas).slice(0, 6);
      const masDescargados = l.slice().sort((a, b) => b.descargas - a.descargas || (a.creado_en < b.creado_en ? 1 : -1)).slice(0, 6);
      return { total: l.length, materias: new Set(l.map((it) => it.materia_id)).size, autores: Object.keys(aut).length, porCarrera, porTipo, porPeriodo, topAportantes, masDescargados, fuente: "local" };
    }
  };

  N.api = Object.assign({}, DEMO ? demo : real, { DEMO, ApiError, validarMaterial, claveUnicidad, MAX_BYTES, TIPOS_ARCHIVO, hoyISO });
})();
