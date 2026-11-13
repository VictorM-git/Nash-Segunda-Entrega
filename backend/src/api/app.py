import base64
import json
import logging
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from pensum import (CARRERAS, MATERIAS, TIPOS, TIPOS_ARCHIVO, clave_unicidad, en_pensum, error_nombre_materia,
                    id_dinamico, limpiar_nombre, materia_valida, periodo_de_fecha, slug)

log = logging.getLogger()
log.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "us-east-1")
BUCKET = os.environ["BUCKET_DATOS"]
GLUE_DB = os.environ["GLUE_DB"]
GLUE_JOB = os.environ["GLUE_JOB"]
CRAWLER_RAW = os.environ["CRAWLER_RAW"]
WORKGROUP = os.environ["ATHENA_WORKGROUP"]
MAX_MB = int(os.environ.get("MAX_MB", "10"))
MAX_BYTES = MAX_MB * 1024 * 1024
BOGOTA = timezone(timedelta(hours=-5))

s3 = boto3.client(
    "s3", region_name=REGION, endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)
athena = boto3.client("athena", region_name=REGION)
glue = boto3.client("glue", region_name=REGION)

P_MAT, P_DESC, P_ARCH, P_STAGE, P_IDX = "raw/materiales/", "raw/descargas/", "raw/archivos/", "staging/", "indice/"
RE_ID = re.compile(r"^[0-9a-f]{32}$")
RE_PERIODO = re.compile(r"^\d{4}-[12]$")
RE_SUB = re.compile(r"^[0-9a-f-]{36}$")

class ErrorApi(Exception):
    def __init__(self, status, mensaje, **extra):
        super().__init__(mensaje)
        self.status = status
        self.cuerpo = dict(extra, mensaje=mensaje)

def respuesta(status, cuerpo):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
        "body": json.dumps(cuerpo, ensure_ascii=False, default=str),
    }

def usuario(event):
    claims = (((event.get("requestContext") or {}).get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    sub = claims.get("sub", "")
    if not RE_SUB.match(sub):
        raise ErrorApi(401, "Tu sesión terminó. Vuelve a ingresar.")
    nombre = " ".join(str(claims.get("name") or claims.get("email") or "Estudiante").split())[:80]
    return {"sub": sub, "nombre": nombre, "email": claims.get("email", "")}

def cuerpo_json(event):
    b = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        b = base64.b64decode(b).decode("utf-8")
    if len(b) > 20000:
        raise ErrorApi(413, "La petición es demasiado grande.")
    try:
        datos = json.loads(b)
    except ValueError:
        raise ErrorApi(400, "El cuerpo de la petición no es JSON válido.")
    if not isinstance(datos, dict):
        raise ErrorApi(400, "El cuerpo de la petición debe ser un objeto JSON.")
    return datos

def parametros(event):
    return event.get("queryStringParameters") or {}

def ahora_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def validar_materia(m, e):
    materia = str(m.get("materia_id") or "")
    if materia in MATERIAS:
        nombre, _sem, carrera = MATERIAS[materia]
        return materia, carrera, nombre
    carrera = str(m.get("carrera_id") or "")
    nombre = limpiar_nombre(m.get("materia_nombre"))
    if not materia:
        e["materia_id"] = "Elige la materia."
    elif carrera not in CARRERAS:
        e["materia_id"] = "Elige la carrera."
    elif error_nombre_materia(nombre):
        e["materia_nombre"] = error_nombre_materia(nombre)
    elif en_pensum(carrera, nombre):
        ya = en_pensum(carrera, nombre)
        e["materia_nombre"] = f"Esa materia ya está en la lista: {MATERIAS[ya][0]}. Elígela ahí."
    elif id_dinamico(carrera, nombre) != materia or not materia_valida(materia):
        e["materia_id"] = "Elige la materia otra vez."
    return materia, carrera, nombre

def validar(m):
    e = {}
    materia, carrera, materia_nombre = validar_materia(m, e)
    tipo = str(m.get("tipo") or "")
    if tipo not in TIPOS:
        e["tipo"] = "Elige el tipo de material."
    maximo = 18 if tipo == "apuntes" else 20
    numero = m.get("numero")
    if isinstance(numero, bool) or not (isinstance(numero, int) or (isinstance(numero, str) and numero.isdigit())):
        numero = None
    else:
        numero = int(numero)
    if numero is None or not 1 <= numero <= maximo:
        e["numero"] = "La semana va de 1 a 18." if tipo == "apuntes" else f"Escribe un número entre 1 y {maximo}."
    titulo = " ".join(str(m.get("titulo") or "").split())
    if not 4 <= len(titulo) <= 90:
        e["titulo"] = "El título va de 4 a 90 caracteres."
    profesor = " ".join(str(m.get("profesor") or "").split())
    if not 3 <= len(profesor) <= 60 or not all(c.isalpha() or c in " .'-" for c in profesor):
        e["profesor"] = "Escribe el nombre del profesor (solo letras)."
    fecha_txt = str(m.get("fecha") or "")
    fecha = None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha_txt):
        try:
            fecha = date.fromisoformat(fecha_txt)
        except ValueError:
            fecha = None
    if not fecha:
        e["fecha"] = "Escribe la fecha."
    elif fecha > datetime.now(BOGOTA).date():
        e["fecha"] = "La fecha no puede ser futura."
    elif fecha < date(2015, 1, 1):
        e["fecha"] = "La fecha debe ser de 2015 en adelante."
    descripcion = str(m.get("descripcion") or "").strip()
    if len(descripcion) > 400:
        e["descripcion"] = "Máximo 400 caracteres."
    nombre = re.sub(r'[\x00-\x1f"\\/]', "", str(m.get("archivo_nombre") or "")).strip()[-120:]
    tipo_archivo = m.get("archivo_tipo")
    peso = m.get("archivo_bytes")
    if not nombre:
        e["archivo"] = "Adjunta el archivo."
    elif tipo_archivo not in TIPOS_ARCHIVO:
        e["archivo"] = "Solo PDF, JPG o PNG."
    elif isinstance(peso, bool) or not isinstance(peso, int) or not 0 < peso <= MAX_BYTES:
        e["archivo"] = f"El archivo pesa más de {MAX_MB} MB."
    limpio = {
        "carrera_id": carrera, "materia_id": materia, "materia_nombre": materia_nombre,
        "tipo": tipo, "numero": numero, "titulo": titulo, "profesor": profesor,
        "profesor_slug": slug(profesor), "fecha": fecha_txt,
        "periodo": periodo_de_fecha(fecha_txt) if fecha else "",
        "con_solucion": bool(m.get("con_solucion")) and tipo != "apuntes",
        "descripcion": descripcion, "archivo_nombre": nombre, "archivo_tipo": tipo_archivo, "archivo_bytes": peso,
    }
    return limpio, e

def prefijo(materia, tipo, periodo, numero=None, clave=None):
    p = f"{P_MAT}{materia}__{tipo}__{periodo}__"
    if numero is not None:
        p += f"n{numero}__{clave}__"
    return p

def leer_llave(key):
    nombre = key[len(P_MAT):]
    if not nombre.endswith(".json"):
        return None
    partes = nombre[:-5].split("__")
    if len(partes) != 6 or not partes[3].startswith("n") or not partes[3][1:].isdigit():
        return None
    materia, tipo, periodo, n, clave, material_id = partes
    return {"materia_id": materia, "tipo": tipo, "periodo": periodo, "numero": int(n[1:]),
            "clave": clave, "material_id": material_id, "key": key}

def listar(pref):
    llaves = []
    for pagina in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=pref):
        llaves.extend(o["Key"] for o in pagina.get("Contents", []))
    return llaves

def leer_json(key):
    return json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())

def escribir_json(key, datos):
    s3.put_object(Bucket=BUCKET, Key=key, ContentType="application/json",
                  Body=json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

def resumen_registro(r):
    return {k: r.get(k) for k in ("material_id", "numero", "titulo", "profesor", "autor_nombre", "creado_en")}

def buscar_duplicado(m, clave):
    for key in listar(prefijo(m["materia_id"], m["tipo"], m["periodo"], m["numero"], clave)):
        info = leer_llave(key)
        if not info:
            continue
        try:
            return resumen_registro(leer_json(key))
        except ClientError:
            return {"material_id": info["material_id"], "numero": info["numero"]}
    return None

_tablas = {}

def existe_tabla(nombre):
    estado = _tablas.get(nombre)
    if estado is True:
        return True
    if estado and time.time() - estado < 30:
        return False
    try:
        glue.get_table(DatabaseName=GLUE_DB, Name=nombre)
        _tablas[nombre] = True
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "EntityNotFoundException":
            _tablas[nombre] = time.time()
            return False
        raise

def asegurar_tabla(nombre):
    if existe_tabla(nombre):
        return
    try:
        glue.start_crawler(Name=CRAWLER_RAW)
        log.info("Tabla %s aún no existe: crawler %s iniciado", nombre, CRAWLER_RAW)
    except ClientError as e:
        if e.response["Error"]["Code"] != "CrawlerRunningException":
            log.warning("No se pudo iniciar el crawler: %s", e)

def lanzar_etl():
    try:
        glue.start_job_run(JobName=GLUE_JOB)
        return "iniciado"
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConcurrentRunsExceededException":
            return "en-curso"
        log.warning("No se pudo iniciar el job de Glue: %s", e)
        return "pendiente"

def convertir(valor, tipo):
    if valor is None:
        return None
    if tipo in ("integer", "bigint", "smallint", "tinyint"):
        return int(valor)
    if tipo == "boolean":
        return valor == "true"
    if tipo in ("double", "float", "real") or tipo.startswith("decimal"):
        return float(valor)
    return valor

def filas(qid):
    out, columnas, token = [], None, None
    while True:
        kw = {"QueryExecutionId": qid, "MaxResults": 1000}
        if token:
            kw["NextToken"] = token
        r = athena.get_query_results(**kw)
        datos = r["ResultSet"]["Rows"]
        if columnas is None:
            columnas = [(c["Name"], c["Type"]) for c in r["ResultSet"]["ResultSetMetadata"]["ColumnInfo"]]
            datos = datos[1:]
        for fila in datos:
            out.append({n: convertir(c.get("VarCharValue"), t) for (n, t), c in zip(columnas, fila["Data"])})
        token = r.get("NextToken")
        if not token:
            return out

def consultar(sqls):
    ids = {}
    for nombre, sql in sqls.items():
        ids[nombre] = athena.start_query_execution(
            QueryString=sql, WorkGroup=WORKGROUP, QueryExecutionContext={"Database": GLUE_DB}
        )["QueryExecutionId"]
    pendientes, estados, pausa, limite = dict(ids), {}, 0.25, time.time() + 24
    while pendientes and time.time() < limite:
        time.sleep(pausa)
        pausa = min(pausa * 1.5, 1.0)
        for nombre, qid in list(pendientes.items()):
            st = athena.get_query_execution(QueryExecutionId=qid)["QueryExecution"]["Status"]
            if st["State"] in ("SUCCEEDED", "FAILED", "CANCELLED"):
                estados[nombre] = st
                del pendientes[nombre]
    if pendientes:
        for qid in pendientes.values():
            try:
                athena.stop_query_execution(QueryExecutionId=qid)
            except ClientError:
                pass
        raise ErrorApi(504, "Athena tardó demasiado en responder. Intenta de nuevo.")
    resultado = {}
    for nombre, st in estados.items():
        if st["State"] != "SUCCEEDED":
            razon = st.get("StateChangeReason", "")
            log.error("Athena falló en %s: %s", nombre, razon)
            raise ErrorApi(502, "La consulta en Athena falló.", detalle=razon[:300])
        resultado[nombre] = filas(ids[nombre])
    return resultado

_cache = {}

def en_cache(clave, segundos, calcular):
    hit = _cache.get(clave)
    if hit and time.time() - hit[0] < segundos:
        return hit[1]
    valor = calcular()
    _cache[clave] = (time.time(), valor)
    return valor

def texto_sql(s):
    return "'" + str(s).replace("'", "''") + "'"

COLUMNAS = ("m.material_id, m.carrera_id, m.materia_id, m.materia_nombre, m.tipo, m.numero, m.titulo, m.profesor, m.profesor_slug, m.fecha, "
            "m.periodo, m.con_solucion, m.descripcion, m.archivo_nombre, m.archivo_tipo, m.archivo_bytes, "
            "m.autor_id, m.autor_nombre, m.creado_en")

def sql_materiales(condiciones):
    if existe_tabla("raw_descargas"):
        union = ("LEFT JOIN (SELECT material_id, count(*) AS descargas FROM raw_descargas GROUP BY material_id) d "
                 "ON d.material_id = m.material_id")
        descargas = "coalesce(d.descargas, 0) AS descargas"
    else:
        union, descargas = "", "0 AS descargas"
    donde = " AND ".join(condiciones) or "true"
    return f"SELECT {COLUMNAS}, {descargas} FROM raw_materiales m {union} WHERE {donde} ORDER BY m.creado_en DESC LIMIT 1000"

def r_resumen(event, _u):
    def calcular():
        materias, carreras = {}, {}
        totales = {"apuntes": 0, "parcial": 0, "quiz": 0, "ejercicios": 0, "total": 0}
        if existe_tabla("raw_materiales"):
            sql = ("SELECT carrera_id, materia_id, max(materia_nombre) AS materia_nombre, tipo, count(*) AS n, "
                   "max(creado_en) AS ultimo FROM raw_materiales GROUP BY carrera_id, materia_id, tipo")
            for f in consultar({"r": sql})["r"]:
                if f["tipo"] not in TIPOS or not materia_valida(f["materia_id"] or ""):
                    continue
                r = materias.setdefault(f["materia_id"], {
                    "carrera_id": f["carrera_id"], "materia_nombre": f["materia_nombre"],
                    "apuntes": 0, "parcial": 0, "quiz": 0, "ejercicios": 0, "total": 0, "ultimo": None})
                r[f["tipo"]] += f["n"]
                r["total"] += f["n"]
                totales[f["tipo"]] += f["n"]
                totales["total"] += f["n"]
                carreras[f["carrera_id"]] = carreras.get(f["carrera_id"], 0) + f["n"]
                if f["ultimo"] and (not r["ultimo"] or f["ultimo"] > r["ultimo"]):
                    r["ultimo"] = f["ultimo"]
        return {"materias": materias, "carreras": carreras, "totales": totales, "fuente": "athena"}
    return en_cache("resumen", 60, calcular)

def r_listar(event, _u):
    q = parametros(event)
    cond = []
    if q.get("materia"):
        if not materia_valida(q["materia"]):
            raise ErrorApi(400, "Materia desconocida.")
        cond.append(f"m.materia_id = {texto_sql(q['materia'])}")
    if q.get("carrera"):
        if q["carrera"] not in CARRERAS:
            raise ErrorApi(400, "Carrera desconocida.")
        cond.append(f"m.carrera_id IN ({texto_sql(q['carrera'])}, 'nucleo')")
    if q.get("tipo"):
        if q["tipo"] not in TIPOS:
            raise ErrorApi(400, "Tipo desconocido.")
        cond.append(f"m.tipo = {texto_sql(q['tipo'])}")
    if q.get("periodo"):
        if not RE_PERIODO.match(q["periodo"]):
            raise ErrorApi(400, "El periodo es como 2026-1.")
        cond.append(f"m.periodo = {texto_sql(q['periodo'])}")
    if q.get("q"):
        texto = re.sub(r"[^0-9a-záéíóúüñ ]", " ", q["q"].lower())[:60].strip()
        if texto:
            cond.append(f"strpos(lower(m.titulo || ' ' || m.profesor || ' ' || m.autor_nombre || ' ' || m.materia_nombre), {texto_sql(texto)}) > 0")
    if not existe_tabla("raw_materiales"):
        return {"items": [], "fuente": "athena"}
    return {"items": consultar({"l": sql_materiales(cond)})["l"], "fuente": "athena"}

def r_disponibilidad(event, u):
    q = parametros(event)
    materia, tipo, periodo, profesor = q.get("materia", ""), q.get("tipo", ""), q.get("periodo", ""), q.get("profesor", "")
    if not materia_valida(materia) or tipo not in TIPOS or not RE_PERIODO.match(periodo):
        raise ErrorApi(400, "Faltan la materia, el tipo o el periodo.")
    clave = clave_unicidad(tipo, profesor, u["sub"])
    if not clave:
        raise ErrorApi(400, "Escribe el profesor.")
    ocupados = []
    for key in listar(prefijo(materia, tipo, periodo)):
        info = leer_llave(key)
        if not info:
            continue
        propio = info["clave"] == clave
        item = {"numero": info["numero"], "clave": info["clave"] if (propio or tipo != "apuntes") else "otro",
                "material_id": info["material_id"]}
        if propio:
            try:
                item.update({k: v for k, v in resumen_registro(leer_json(key)).items() if k != "material_id"})
            except ClientError:
                pass
        ocupados.append(item)
    ocupados.sort(key=lambda x: x["numero"])
    return {"clave": clave, "ocupados": ocupados, "fuente": "s3"}

def r_crear(event, u):
    m, errores = validar(cuerpo_json(event))
    if errores:
        raise ErrorApi(400, "Revisa los campos marcados.", errores=errores)
    clave = clave_unicidad(m["tipo"], m["profesor"], u["sub"])
    existente = buscar_duplicado(m, clave)
    if existente:
        raise ErrorApi(409, "Ese material ya está en el banco.", error="duplicado", existente=existente)
    material_id = uuid.uuid4().hex
    archivo_key = f"{P_ARCH}{material_id}.{TIPOS_ARCHIVO[m['archivo_tipo']]}"
    escribir_json(f"{P_STAGE}{material_id}.json", dict(
        m, material_id=material_id, clave=clave, archivo_key=archivo_key,
        autor_id=u["sub"], autor_nombre=u["nombre"], pedido_en=ahora_iso()))
    post = s3.generate_presigned_post(
        Bucket=BUCKET, Key=archivo_key,
        Fields={"Content-Type": m["archivo_tipo"]},
        Conditions=[{"Content-Type": m["archivo_tipo"]}, ["content-length-range", 1, MAX_BYTES]],
        ExpiresIn=600,
    )
    return 201, {"material_id": material_id, "subida": {"url": post["url"], "fields": post["fields"]}}

def r_confirmar(event, u):
    material_id = (event.get("pathParameters") or {}).get("id", "")
    if not RE_ID.match(material_id):
        raise ErrorApi(404, "No encontramos esa subida. Empieza de nuevo.")
    try:
        p = leer_json(f"{P_STAGE}{material_id}.json")
    except ClientError:
        raise ErrorApi(404, "No encontramos esa subida (pudo vencer). Empieza de nuevo.")
    if p.get("autor_id") != u["sub"]:
        raise ErrorApi(403, "Esa subida no es tuya.")
    try:
        cabecera = s3.head_object(Bucket=BUCKET, Key=p["archivo_key"])
    except ClientError:
        raise ErrorApi(400, "El archivo no llegó a S3. Vuelve a subirlo.")
    if cabecera["ContentLength"] > MAX_BYTES or cabecera.get("ContentType") != p["archivo_tipo"]:
        s3.delete_object(Bucket=BUCKET, Key=p["archivo_key"])
        raise ErrorApi(400, "El archivo no coincide con lo declarado (tipo o tamaño).")
    existente = buscar_duplicado(p, p["clave"])
    if existente:
        s3.delete_object(Bucket=BUCKET, Key=p["archivo_key"])
        raise ErrorApi(409, "Ese material ya está en el banco.", error="duplicado", existente=existente)
    registro = {k: p[k] for k in ("material_id", "carrera_id", "materia_id", "materia_nombre", "tipo", "numero", "titulo", "profesor", "profesor_slug",
                                   "fecha", "periodo", "con_solucion", "descripcion", "archivo_nombre", "archivo_tipo",
                                   "autor_id", "autor_nombre")}
    registro["archivo_bytes"] = cabecera["ContentLength"]
    registro["creado_en"] = ahora_iso()
    escribir_json(prefijo(p["materia_id"], p["tipo"], p["periodo"], p["numero"], p["clave"]) + f"{material_id}.json", registro)
    escribir_json(f"{P_IDX}{material_id}.json", {
        "carrera_id": p["carrera_id"], "materia_id": p["materia_id"], "archivo_key": p["archivo_key"],
        "archivo_nombre": p["archivo_nombre"], "archivo_tipo": p["archivo_tipo"]})
    s3.delete_object(Bucket=BUCKET, Key=f"{P_STAGE}{material_id}.json")
    asegurar_tabla("raw_materiales")
    _cache.pop("resumen", None)
    _cache.pop("estadisticas", None)
    return {"material": dict(registro, descargas=0), "glue": lanzar_etl()}

def r_descarga(event, u):
    material_id = (event.get("pathParameters") or {}).get("id", "")
    if not RE_ID.match(material_id):
        raise ErrorApi(404, "Ese material ya no existe.")
    try:
        idx = leer_json(f"{P_IDX}{material_id}.json")
    except ClientError:
        raise ErrorApi(404, "Ese material ya no existe.")
    descarga_id = uuid.uuid4().hex
    dia = datetime.now(BOGOTA).strftime("%Y-%m-%d")
    escribir_json(f"{P_DESC}{dia}__{material_id}__{descarga_id}.json", {
        "descarga_id": descarga_id, "material_id": material_id, "materia_id": idx["materia_id"],
        "carrera_id": idx.get("carrera_id", ""),
        "usuario_id": u["sub"], "creado_en": ahora_iso()})
    asegurar_tabla("raw_descargas")
    url = s3.generate_presigned_url("get_object", ExpiresIn=300, Params={
        "Bucket": BUCKET, "Key": idx["archivo_key"], "ResponseContentType": idx["archivo_tipo"],
        "ResponseContentDisposition": f"attachment; filename*=UTF-8''{quote(idx['archivo_nombre'])}"})
    return {"url": url, "nombre": idx["archivo_nombre"]}

def r_aportes(event, u):
    if not existe_tabla("raw_materiales"):
        return {"items": [], "fuente": "athena"}
    return {"items": consultar({"a": sql_materiales([f"m.autor_id = {texto_sql(u['sub'])}"])})["a"], "fuente": "athena"}

SQL_ESTADISTICAS = {
    "resumen": ("SELECT count(*) AS total, count(DISTINCT materia_id) AS materias, count(DISTINCT autor_id) AS autores "
                "FROM proc_materiales"),
    "carrera": "SELECT carrera_id, count(*) AS total FROM proc_materiales GROUP BY carrera_id ORDER BY total DESC",
    "tipo": "SELECT tipo, count(*) AS total FROM proc_materiales GROUP BY tipo ORDER BY total DESC",
    "periodo": "SELECT periodo, count(*) AS total FROM proc_materiales GROUP BY periodo ORDER BY periodo",
    "aportantes": ("SELECT autor_nombre, count(*) AS aportes, sum(descargas) AS descargas FROM proc_materiales "
                   "GROUP BY autor_id, autor_nombre ORDER BY aportes DESC, descargas DESC LIMIT 6"),
    "descargados": ("SELECT material_id, titulo, carrera_id, materia_id, materia_nombre, tipo, numero, autor_nombre, "
                    "descargas FROM proc_materiales ORDER BY descargas DESC, creado_en DESC LIMIT 6"),
}

def r_estadisticas(event, _u):
    def calcular():
        vacio = {"total": 0, "materias": 0, "autores": 0, "porCarrera": [], "porTipo": [{"tipo": t, "total": 0} for t in TIPOS],
                 "porPeriodo": [], "topAportantes": [], "masDescargados": [], "fuente": "athena"}
        if not existe_tabla("proc_materiales"):
            return dict(vacio, mensaje="El job de Glue aún no ha creado proc_materiales.")
        r = consultar(SQL_ESTADISTICAS)
        res = (r["resumen"] or [{}])[0]
        tip = {f["tipo"]: f["total"] for f in r["tipo"]}
        return dict(vacio,
                    total=res.get("total") or 0, materias=res.get("materias") or 0, autores=res.get("autores") or 0,
                    porCarrera=[f for f in r["carrera"] if f["carrera_id"]],
                    porTipo=[{"tipo": t, "total": tip.get(t, 0)} for t in TIPOS],
                    porPeriodo=r["periodo"],
                    topAportantes=[dict(f, descargas=f["descargas"] or 0) for f in r["aportantes"]],
                    masDescargados=r["descargados"])
    return en_cache("estadisticas", 60, calcular)

RUTAS = {
    "GET /publico/resumen": (r_resumen, False),
    "GET /materiales": (r_listar, True),
    "GET /materiales/disponibilidad": (r_disponibilidad, True),
    "POST /materiales": (r_crear, True),
    "POST /materiales/{id}/confirmar": (r_confirmar, True),
    "GET /materiales/{id}/descarga": (r_descarga, True),
    "GET /yo/aportes": (r_aportes, True),
    "GET /estadisticas": (r_estadisticas, True),
}

def handler(event, _context):
    ruta = event.get("routeKey", "")
    entrada = RUTAS.get(ruta)
    if not entrada:
        return respuesta(404, {"mensaje": "Ruta no encontrada."})
    funcion, con_sesion = entrada
    try:
        u = usuario(event) if con_sesion else None
        r = funcion(event, u)
        status, cuerpo = r if isinstance(r, tuple) else (200, r)
        return respuesta(status, cuerpo)
    except ErrorApi as e:
        if e.status >= 500:
            log.error("%s → %s %s", ruta, e.status, e.cuerpo)
        return respuesta(e.status, e.cuerpo)
    except Exception:
        log.exception("Error no controlado en %s", ruta)
        return respuesta(500, {"mensaje": "Algo falló en el servidor. Intenta de nuevo."})
