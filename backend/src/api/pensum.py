import re
import unicodedata

CARRERAS = {
    "macc": "Matemáticas Aplicadas y Ciencias de la Computación",
    "biomedica": "Ingeniería Biomédica",
    "biologia": "Biología",
    "economia": "Economía",
    "finanzas": "Finanzas y Comercio Internacional",
    "administracion": "Administración de Empresas",
    "negocios": "Administración de Negocios Internacionales",
    "logistica": "Administración en Logística y Producción",
    "jurisprudencia": "Jurisprudencia",
    "medicina": "Medicina",
    "psicologia": "Psicología",
    "fisioterapia": "Fisioterapia",
    "fonoaudiologia": "Fonoaudiología",
    "terapia": "Terapia Ocupacional",
    "politica": "Ciencia Política",
    "relaciones": "Relaciones Internacionales",
    "urbanos": "Gestión y Desarrollo Urbanos",
    "antropologia": "Antropología",
    "sociologia": "Sociología",
    "historia": "Historia",
    "filosofia": "Filosofía",
    "periodismo": "Periodismo y Opinión Pública",
    "artes-liberales": "Artes Liberales en Ciencias Sociales",
    "creacion": "Creación Literaria",
}

PENSUMS = {
    "macc": {
        "11": ("Precálculo", 1), "12": ("Pensamiento matemático", 1), "13": ("Programación de computadores", 1),
        "14": ("Lógica, teoría de números y conjuntos", 1),
        "21": ("Cálculo 1", 2), "22": ("Física I", 2), "23": ("Algoritmos y estructuras de datos", 2),
        "24": ("Lógica para ciencias de la computación", 2),
        "31": ("Cálculo 2", 3), "32": ("Álgebra lineal", 3), "33": ("Arquitectura del computador", 3),
        "34": ("Teoría de la computación", 3), "35": ("Cornerstone Project", 3), "36": ("Ingeniería de datos", 3),
        "41": ("Cálculo 3", 4), "42": ("Optimización", 4), "43": ("Análisis y diseño de algoritmos", 4),
        "44": ("Probabilidad y estadística I", 4), "45": ("Teoría de grafos", 4),
        "51": ("Variable compleja", 5), "52": ("Ecuaciones diferenciales", 5), "53": ("Análisis real", 5),
        "54": ("Probabilidad y estadística 2", 5), "55": ("Keystone Project", 5),
        "61": ("Topología", 6), "62": ("Análisis numérico y computación científica", 6),
        "63": ("Análisis estadístico de datos", 6), "65": ("Redes de computadores", 6),
        "71": ("Álgebra abstracta", 7), "72": ("Mathematical Modeling of Systems in Natural Sciences", 7),
        "73": ("Operating Systems", 7),
        "81": ("Geometría", 8), "84": ("Capstone Project", 8),
    },
}
NUCLEO = {
    "lc": "Lectura crítica", "et": "Ética", "cr": "Cátedra Rosarista", "ea": "Escritura académica",
    "cp": "Constitución política e instrucción cívica",
}
CORTOS = {"nucleo.cp": "Constitución política", "macc.14": "Lógica, números y conjuntos",
          "macc.23": "Algoritmos y estructuras", "macc.24": "Lógica para computación",
          "macc.62": "Análisis numérico", "macc.72": "Math. Modeling in Nat. Sci."}

MATERIAS = {f"{c}.{cod}": (nombre, sem, c) for c, pensum in PENSUMS.items() for cod, (nombre, sem) in pensum.items()}
MATERIAS.update({f"nucleo.{cod}": (nombre, None, "nucleo") for cod, nombre in NUCLEO.items()})

TIPOS = ("apuntes", "parcial", "quiz", "ejercicios")
TIPOS_ARCHIVO = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
RE_NOMBRE_MATERIA = re.compile(r"^[\w .,:;()'&+\-]+$")

def periodo_de_fecha(iso: str) -> str:
    anio, mes = int(iso[0:4]), int(iso[5:7])
    return f"{anio}-{1 if mes <= 6 else 2}"

def sin_tildes(texto: str) -> str:
    s = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in s if not ("̀" <= c <= "ͯ"))

def slug_texto(texto: str, maximo: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", sin_tildes(texto).lower()).strip("-")
    return s[:maximo].rstrip("-")

def slug(texto: str) -> str:
    s = re.sub(r"^(prof(esor|esora)?\.?\s+)", "", sin_tildes(texto).lower())
    return slug_texto(s, 40)

def limpiar_nombre(nombre) -> str:
    return " ".join(str(nombre or "").split())

def error_nombre_materia(nombre: str) -> str:
    n = limpiar_nombre(nombre)
    if not 4 <= len(n) <= 80:
        return "El nombre de la materia va de 4 a 80 caracteres."
    if sum(c.isalpha() for c in n) < 3:
        return "Escribe el nombre de la materia con letras."
    if not RE_NOMBRE_MATERIA.match(n) or "_" in n:
        return "Usa solo letras, números y puntuación simple."
    return ""

def id_dinamico(carrera: str, nombre: str) -> str:
    return f"{carrera}.{slug_texto(limpiar_nombre(nombre), 48)}"

def en_pensum(carrera: str, nombre: str):
    s = slug_texto(nombre, 80)
    for mid, (n, _sem, c) in MATERIAS.items():
        if c in (carrera, "nucleo") and (slug_texto(n, 80) == s or slug_texto(CORTOS.get(mid, ""), 80) == s):
            return mid
    return None

RE_ID_MATERIA = re.compile(r"^[a-z][a-z-]{1,30}\.[a-z0-9][a-z0-9-]{0,47}$")

def materia_valida(mid: str) -> bool:
    if mid in MATERIAS:
        return True
    return bool(RE_ID_MATERIA.match(mid or "")) and mid.split(".")[0] in CARRERAS

def clave_unicidad(tipo: str, profesor: str, autor_id: str) -> str:
    return autor_id if tipo == "apuntes" else slug(profesor)
