/* NASH — carreras, pensums y materias.
 *
 * CARRERAS: los pregrados de la Universidad del Rosario que aparecen en los formularios. Revisa la lista contra
 *   el catálogo oficial antes de publicar; agregar o quitar una carrera es editar este arreglo (y el de
 *   backend/src/api/pensum.py).
 * PENSUMS: el plan de estudios cargado de cada carrera. Hoy solo está MACC (folleto oficial, página 09; sin
 *   electivas, menores ni opciones de grado). Una carrera sin pensum cargado funciona igual: sus materias
 *   aparecen cuando alguien sube la primera y escribe su nombre (materias "dinámicas").
 * NUCLEO: las materias del núcleo institucional, compartidas por todas las carreras.
 *
 * Id de una materia: "<carrera>.<código>" (macc.31, nucleo.lc) o, si la crearon los estudiantes,
 * "<carrera>.<slug del nombre>" (economia.microeconomia-i). El id va en la llave de S3 de cada material.
 *
 * IMPORTANTE: la Lambda (backend/src/api/pensum.py) tiene las mismas listas. Si cambias una, cambia la otra.
 */
(function () {
  const F = {
    ing: "Escuela de Ingeniería, Ciencia y Tecnología",
    eco: "Facultad de Economía",
    adm: "Escuela de Administración",
    jur: "Facultad de Jurisprudencia",
    med: "Escuela de Medicina y Ciencias de la Salud",
    int: "Facultad de Estudios Internacionales, Políticos y Urbanos",
    hum: "Escuela de Ciencias Humanas"
  };
  const C = (id, nombre, facultad, corto) => ({ id, nombre, corto: corto || nombre, facultad });

  const CARRERAS = [
    C("macc", "Matemáticas Aplicadas y Ciencias de la Computación", F.ing, "MACC"),
    C("biomedica", "Ingeniería Biomédica", F.ing),
    C("biologia", "Biología", F.ing),
    C("economia", "Economía", F.eco),
    C("finanzas", "Finanzas y Comercio Internacional", F.eco, "Finanzas y Comercio Int."),
    C("administracion", "Administración de Empresas", F.adm),
    C("negocios", "Administración de Negocios Internacionales", F.adm, "Negocios Internacionales"),
    C("logistica", "Administración en Logística y Producción", F.adm, "Logística y Producción"),
    C("jurisprudencia", "Jurisprudencia", F.jur),
    C("medicina", "Medicina", F.med),
    C("psicologia", "Psicología", F.med),
    C("fisioterapia", "Fisioterapia", F.med),
    C("fonoaudiologia", "Fonoaudiología", F.med),
    C("terapia", "Terapia Ocupacional", F.med),
    C("politica", "Ciencia Política", F.int),
    C("relaciones", "Relaciones Internacionales", F.int),
    C("urbanos", "Gestión y Desarrollo Urbanos", F.int),
    C("antropologia", "Antropología", F.hum),
    C("sociologia", "Sociología", F.hum),
    C("historia", "Historia", F.hum),
    C("filosofia", "Filosofía", F.hum),
    C("periodismo", "Periodismo y Opinión Pública", F.hum, "Periodismo"),
    C("artes-liberales", "Artes Liberales en Ciencias Sociales", F.hum, "Artes Liberales"),
    C("creacion", "Creación Literaria", F.hum)
  ];
  const carreraPorId = Object.fromEntries(CARRERAS.map((c) => [c.id, c]));
  const FACULTADES = [...new Set(CARRERAS.map((c) => c.facultad))];

  // ---------- pensums cargados ----------
  // M(código, nombre, semestre, créditos, prerrequisitos por código, extra)
  const M = (codigo, nombre, semestre, creditos, prer, extra) => Object.assign({ codigo, nombre, semestre, creditos, prer: prer || [] }, extra || {});
  const PENSUMS = {
    macc: [
      M("11", "Precálculo", 1, 3),
      M("12", "Pensamiento matemático", 1, 2),
      M("13", "Programación de computadores", 1, 3),
      M("14", "Lógica, teoría de números y conjuntos", 1, 3, [], { corto: "Lógica, números y conjuntos" }),
      M("21", "Cálculo 1", 2, 3, ["11"]),
      M("22", "Física I", 2, 3, ["11"]),
      M("23", "Algoritmos y estructuras de datos", 2, 3, ["13"], { corto: "Algoritmos y estructuras" }),
      M("24", "Lógica para ciencias de la computación", 2, 3, ["14"], { corto: "Lógica para computación" }),
      M("31", "Cálculo 2", 3, 3, ["21"]),
      M("32", "Álgebra lineal", 3, 3, ["11"]),
      M("33", "Arquitectura del computador", 3, 3, ["13"]),
      M("34", "Teoría de la computación", 3, 3, ["24"]),
      M("35", "Cornerstone Project", 3, 3, ["21", "23", "24"]),
      M("36", "Ingeniería de datos", 3, 3, ["13"]),
      M("41", "Cálculo 3", 4, 3, ["31", "32"]),
      M("42", "Optimización", 4, 3, ["31", "32"]),
      M("43", "Análisis y diseño de algoritmos", 4, 3, ["23", "34"]),
      M("44", "Probabilidad y estadística I", 4, 3, ["31"]),
      M("45", "Teoría de grafos", 4, 3, ["32"]),
      M("51", "Variable compleja", 5, 3, ["41"]),
      M("52", "Ecuaciones diferenciales", 5, 3, ["32", "41"]),
      M("53", "Análisis real", 5, 3, ["12", "14", "31", "41"]),
      M("54", "Probabilidad y estadística 2", 5, 3, ["44"]),
      M("55", "Keystone Project", 5, 3, ["35", "36", "42", "44", "45"]),
      M("61", "Topología", 6, 3, ["53"]),
      M("62", "Análisis numérico y computación científica", 6, 3, ["23", "32", "52", "13"], { corto: "Análisis numérico" }),
      M("63", "Análisis estadístico de datos", 6, 3, ["36", "54"]),
      M("65", "Redes de computadores", 6, 3, ["45"]),
      M("71", "Álgebra abstracta", 7, 3, ["14", "32"]),
      M("72", "Mathematical Modeling of Systems in Natural Sciences", 7, 3, ["13", "22", "44", "62"], { corto: "Math. Modeling in Nat. Sci." }),
      M("73", "Operating Systems", 7, 3, ["23", "33"]),
      M("81", "Geometría", 8, 3, ["52", "53"]),
      M("84", "Capstone Project", 8, 3, ["55", "72"])
    ]
  };

  // Núcleo institucional: lo comparten todas las carreras
  const NUCLEO = [
    M("lc", "Lectura crítica", 1, 2),
    M("et", "Ética", 1, 2),
    M("cr", "Cátedra Rosarista", 1, 2),
    M("ea", "Escritura académica", 2, 2),
    M("cp", "Constitución política e instrucción cívica", 2, 2, [], { corto: "Constitución política" })
  ];

  const MATERIAS = [];
  Object.entries(PENSUMS).forEach(([carrera, lista]) => lista.forEach((m) => MATERIAS.push(Object.assign(m, {
    id: `${carrera}.${m.codigo}`, carrera, nucleo: false, prer: m.prer.map((p) => `${carrera}.${p}`)
  }))));
  NUCLEO.forEach((m) => MATERIAS.push(Object.assign(m, { id: `nucleo.${m.codigo}`, carrera: "nucleo", nucleo: true, codigo: "" })));

  const porId = Object.fromEntries(MATERIAS.map((m) => [m.id, m]));
  MATERIAS.forEach((m) => (m.abre = []));
  MATERIAS.forEach((m) => m.prer.forEach((p) => porId[p] && porId[p].abre.push(m.id)));

  const TIPOS = [
    { id: "apuntes", nombre: "Apuntes", plural: "apuntes", numero: "Semana" },
    { id: "parcial", nombre: "Parcial", plural: "parciales", numero: "Parcial n.º" },
    { id: "quiz", nombre: "Quiz", plural: "quices", numero: "Quiz n.º" },
    { id: "ejercicios", nombre: "Ejercicios", plural: "ejercicios", numero: "Taller n.º" }
  ];
  const tipoPorId = Object.fromEntries(TIPOS.map((t) => [t.id, t]));
  const ROMANOS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

  /** "2026-04-17" → "2026-1"; julio a diciembre es el segundo periodo. */
  function periodoDeFecha(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
    const [a, m] = iso.split("-").map(Number);
    return `${a}-${m <= 6 ? 1 : 2}`;
  }

  /** "Microeconomía I" → "microeconomia-i" (igual que slug_texto() en la Lambda). */
  function slugTexto(txt, max) {
    return String(txt || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max || 40).replace(/-+$/, "");
  }
  /** "Prof. Andrés Vargas" → "andres-vargas" (igual que slug() en la Lambda). */
  function slug(txt) {
    const s = String(txt || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^(prof(esor|esora)?\.?\s+)/, "");
    return slugTexto(s, 40);
  }

  // ---------- materias creadas por los estudiantes ----------
  const limpiarNombre = (s) => String(s || "").replace(/\s+/g, " ").trim();
  function validarNombreMateria(nombre) {
    const n = limpiarNombre(nombre);
    if (n.length < 4 || n.length > 80) return "El nombre de la materia va de 4 a 80 caracteres.";
    if ((n.match(/\p{L}/gu) || []).length < 3) return "Escribe el nombre de la materia con letras.";
    if (!/^[\p{L}\p{N} .,:;()'&+\-]+$/u.test(n)) return "Usa solo letras, números y puntuación simple.";
    return "";
  }
  const idDinamico = (carrera, nombre) => `${carrera}.${slugTexto(limpiarNombre(nombre), 48)}`;
  /** La materia del pensum (de la carrera o del núcleo) que se llama igual, si existe. */
  function enPensum(carrera, nombre) {
    const s = slugTexto(nombre, 80);
    return MATERIAS.find((m) => (m.carrera === carrera || m.nucleo) && (slugTexto(m.nombre, 80) === s || (m.corto && slugTexto(m.corto, 80) === s))) || null;
  }
  /** Registra una materia que llegó con el material (una que no está en ningún pensum cargado). */
  function agregarMateria(id, nombre, carrera) {
    if (!id) return null;
    if (porId[id]) return porId[id];
    const c = carrera || String(id).split(".")[0];
    porId[id] = { id, codigo: "", nombre: limpiarNombre(nombre) || id, carrera: c, nucleo: c === "nucleo", dinamica: true, semestre: 0, prer: [], abre: [] };
    return porId[id];
  }
  /** Una lista de material (o el resumen público) trae materias nuevas: se registran todas. */
  function registrar(items) {
    (items || []).forEach((it) => it && agregarMateria(it.materia_id, it.materia_nombre, it.carrera_id));
  }
  /** La materia de un material, aunque no se haya registrado antes. */
  const materiaDe = (it) => porId[it.materia_id] || agregarMateria(it.materia_id, it.materia_nombre, it.carrera_id);

  const tienePensum = (carrera) => !!PENSUMS[carrera];
  const pensumDe = (carrera) => MATERIAS.filter((m) => m.carrera === carrera);
  const dinamicasDe = (carrera) => Object.values(porId).filter((m) => m.dinamica && m.carrera === carrera).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const nucleo = () => MATERIAS.filter((m) => m.nucleo);
  /** Todo lo que ve un estudiante de esa carrera: su pensum, las materias que agregaron y el núcleo. */
  const materiasDe = (carrera) => pensumDe(carrera).concat(dinamicasDe(carrera), nucleo());
  const semestresDe = (carrera) => [...new Set(pensumDe(carrera).map((m) => m.semestre))].sort((a, b) => a - b);
  /** ¿Este material le sirve a un estudiante de esa carrera? (lo de su carrera y lo del núcleo) */
  const esDeCarrera = (it, carrera) => !carrera || it.carrera_id === carrera || it.carrera_id === "nucleo";

  window.NASH = window.NASH || {};
  Object.assign(window.NASH, {
    CARRERAS, carreraPorId, FACULTADES, MATERIAS, ROMANOS, TIPOS, porId, tipoPorId,
    periodoDeFecha, slug, slugTexto, validarNombreMateria, idDinamico, enPensum, agregarMateria, registrar, materiaDe,
    tienePensum, pensumDe, dinamicasDe, nucleo, materiasDe, semestresDe, esDeCarrera,
    materia: (id) => porId[id]
  });
})();
