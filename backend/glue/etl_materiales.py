"""NASH: job ETL de AWS Glue (Glue 4.0, PySpark).

Lee los JSON de raw/materiales/ y raw/descargas/, suma las descargas de cada material, agrega el
semestre del pensum (si la materia es de un pensum cargado), tipa las columnas y escribe Parquet (Snappy) en processed/materiales/,
particionado por periodo. Al terminar inicia el crawler de processed, que actualiza la tabla
proc_materiales de nash_db para Athena.

Es una recarga completa: con unos miles de registros tarda lo mismo que un incremental y no deja
duplicados. Se sube a s3://<bucket-de-datos>/scripts/etl_materiales.py.

Argumentos (DefaultArguments en template.yaml): --BUCKET, --CRAWLER_PROCESSED.
"""
import sys

import boto3
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from pyspark.sql import types as T

args = getResolvedOptions(sys.argv, ["JOB_NAME", "BUCKET", "CRAWLER_PROCESSED"])
sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(args["JOB_NAME"], args)
log = glue_context.get_logger()

BUCKET = args["BUCKET"]
S3 = boto3.client("s3")

# Semestre de cada materia de los pensums cargados (igual que backend/src/api/pensum.py y frontend/js/pensum.js).
# Las materias del núcleo y las que crean los estudiantes no tienen semestre: quedan en null.
SEMESTRE = {
    "macc.11": 1, "macc.12": 1, "macc.13": 1, "macc.14": 1,
    "macc.21": 2, "macc.22": 2, "macc.23": 2, "macc.24": 2,
    "macc.31": 3, "macc.32": 3, "macc.33": 3, "macc.34": 3, "macc.35": 3, "macc.36": 3,
    "macc.41": 4, "macc.42": 4, "macc.43": 4, "macc.44": 4, "macc.45": 4,
    "macc.51": 5, "macc.52": 5, "macc.53": 5, "macc.54": 5, "macc.55": 5,
    "macc.61": 6, "macc.62": 6, "macc.63": 6, "macc.65": 6,
    "macc.71": 7, "macc.72": 7, "macc.73": 7,
    "macc.81": 8, "macc.84": 8,
}

ESQUEMA_MATERIALES = T.StructType([
    T.StructField("material_id", T.StringType()),
    T.StructField("carrera_id", T.StringType()),
    T.StructField("materia_id", T.StringType()),
    T.StructField("materia_nombre", T.StringType()),
    T.StructField("tipo", T.StringType()),
    T.StructField("numero", T.IntegerType()),
    T.StructField("titulo", T.StringType()),
    T.StructField("profesor", T.StringType()),
    T.StructField("profesor_slug", T.StringType()),
    T.StructField("fecha", T.StringType()),
    T.StructField("periodo", T.StringType()),
    T.StructField("con_solucion", T.BooleanType()),
    T.StructField("descripcion", T.StringType()),
    T.StructField("archivo_nombre", T.StringType()),
    T.StructField("archivo_tipo", T.StringType()),
    T.StructField("archivo_bytes", T.LongType()),
    T.StructField("autor_id", T.StringType()),
    T.StructField("autor_nombre", T.StringType()),
    T.StructField("creado_en", T.StringType()),
])
ESQUEMA_DESCARGAS = T.StructType([
    T.StructField("descarga_id", T.StringType()),
    T.StructField("material_id", T.StringType()),
    T.StructField("materia_id", T.StringType()),
    T.StructField("carrera_id", T.StringType()),
    T.StructField("usuario_id", T.StringType()),
    T.StructField("creado_en", T.StringType()),
])


def hay_objetos(prefijo):
    return S3.list_objects_v2(Bucket=BUCKET, Prefix=prefijo, MaxKeys=1).get("KeyCount", 0) > 0


if not hay_objetos("raw/materiales/"):
    log.info("raw/materiales/ está vacío: no hay nada que procesar.")
    job.commit()
    sys.exit(0)

materiales = (
    spark.read.schema(ESQUEMA_MATERIALES).json(f"s3://{BUCKET}/raw/materiales/")
    .where(F.col("material_id").isNotNull())
    .dropDuplicates(["material_id"])
)

if hay_objetos("raw/descargas/"):
    descargas = (
        spark.read.schema(ESQUEMA_DESCARGAS).json(f"s3://{BUCKET}/raw/descargas/")
        .dropDuplicates(["descarga_id"])
        .groupBy("material_id")
        .agg(F.count(F.lit(1)).alias("descargas"), F.max("creado_en").alias("ultima_descarga"))
    )
else:
    descargas = spark.createDataFrame([], "material_id string, descargas long, ultima_descarga string")

mapa_semestre = F.create_map(*[F.lit(x) for par in SEMESTRE.items() for x in par])

procesado = (
    materiales.join(descargas, "material_id", "left")
    .withColumn("descargas", F.coalesce(F.col("descargas"), F.lit(0)).cast("long"))
    .withColumn("semestre", mapa_semestre[F.col("materia_id")].cast("int"))
    .withColumn("fecha", F.to_date("fecha"))
    .withColumn("creado_en", F.to_timestamp("creado_en", "yyyy-MM-dd'T'HH:mm:ss'Z'"))
    .withColumn("ultima_descarga", F.to_timestamp("ultima_descarga", "yyyy-MM-dd'T'HH:mm:ss'Z'"))
    .withColumn("archivo_kb", F.round(F.col("archivo_bytes") / 1024).cast("int"))
    .select(
        "material_id", "carrera_id", "materia_id", "materia_nombre", "semestre", "tipo", "numero", "titulo", "profesor", "profesor_slug",
        "fecha", "con_solucion", "descripcion", "archivo_nombre", "archivo_tipo", "archivo_bytes", "archivo_kb",
        "autor_id", "autor_nombre", "creado_en", "descargas", "ultima_descarga", "periodo",
    )
)

total = procesado.count()
(
    procesado.repartition("periodo")
    .write.mode("overwrite")
    .partitionBy("periodo")
    .option("compression", "snappy")
    .parquet(f"s3://{BUCKET}/processed/materiales/")
)
log.info(f"processed/materiales/: {total} materiales escritos en Parquet.")

# El crawler de processed registra el esquema y las particiones (periodo=…) en proc_materiales.
try:
    boto3.client("glue").start_crawler(Name=args["CRAWLER_PROCESSED"])
except Exception as e:  # CrawlerRunningException: ya está corriendo y verá estos archivos
    log.warn(f"No se inició el crawler de processed: {e}")

job.commit()
