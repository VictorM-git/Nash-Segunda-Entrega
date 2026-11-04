-- NASH: consultas de Athena (grupo de trabajo "nash", base "nash_db").
-- Las tablas las crean los crawlers de Glue:
--   raw_materiales   JSON de s3://<datos>/raw/materiales/   (un objeto por material, sin particiones)
--   raw_descargas    JSON de s3://<datos>/raw/descargas/    (un objeto por descarga)
--   proc_materiales  Parquet de s3://<datos>/processed/materiales/, partición periodo (lo escribe el job ETL)
--
-- Las primeras consultas son las que usa la Lambda (backend/src/api/app.py). Las demás sirven para la
-- demostración final. Los ids de materia son "<carrera>.<código>" (macc.31, nucleo.lc) o
-- "<carrera>.<nombre>" cuando la crearon los estudiantes (economia.microeconomia-i).

-- ============================================================ las que usa la API
-- GET /publico/resumen: cuántos archivos hay por carrera, materia y tipo
SELECT carrera_id, materia_id, max(materia_nombre) AS materia_nombre, tipo, count(*) AS n, max(creado_en) AS ultimo
FROM raw_materiales
GROUP BY carrera_id, materia_id, tipo;

-- GET /materiales?materia=macc.31: la lista de una materia, con las descargas sumadas
SELECT m.material_id, m.carrera_id, m.materia_id, m.materia_nombre, m.tipo, m.numero, m.titulo, m.profesor,
       m.periodo, m.con_solucion, m.autor_nombre, m.creado_en, coalesce(d.descargas, 0) AS descargas
FROM raw_materiales m
LEFT JOIN (SELECT material_id, count(*) AS descargas FROM raw_descargas GROUP BY material_id) d
       ON d.material_id = m.material_id
WHERE m.materia_id = 'macc.31'
ORDER BY m.creado_en DESC;

-- GET /estadisticas: totales
SELECT count(*) AS total, count(DISTINCT materia_id) AS materias, count(DISTINCT autor_id) AS autores
FROM proc_materiales;

-- GET /estadisticas: archivos por carrera
SELECT carrera_id, count(*) AS total
FROM proc_materiales
GROUP BY carrera_id
ORDER BY total DESC;

-- GET /estadisticas: por tipo
SELECT tipo, count(*) AS total
FROM proc_materiales
GROUP BY tipo
ORDER BY total DESC;

-- GET /estadisticas: por periodo (la partición del Parquet)
SELECT periodo, count(*) AS total
FROM proc_materiales
GROUP BY periodo
ORDER BY periodo;

-- GET /estadisticas: quién más aporta
SELECT autor_nombre, count(*) AS aportes, sum(descargas) AS descargas
FROM proc_materiales
GROUP BY autor_id, autor_nombre
ORDER BY aportes DESC, descargas DESC
LIMIT 6;

-- GET /estadisticas: lo más descargado
SELECT material_id, titulo, carrera_id, materia_id, materia_nombre, tipo, numero, autor_nombre, descargas
FROM proc_materiales
ORDER BY descargas DESC, creado_en DESC
LIMIT 6;

-- ============================================================ para la demostración
-- La restricción dinámica vista desde Athena: no debe devolver filas.
SELECT materia_id, tipo, periodo, numero, profesor_slug, count(*) AS veces
FROM raw_materiales
WHERE tipo <> 'apuntes'
GROUP BY materia_id, tipo, periodo, numero, profesor_slug
HAVING count(*) > 1;

-- Solo lee una partición: compara "Data scanned" con la misma consulta sin WHERE.
SELECT carrera_id, materia_nombre, count(*) AS archivos
FROM proc_materiales
WHERE periodo = '2026-2'
GROUP BY carrera_id, materia_nombre
ORDER BY archivos DESC;

-- Materias que crearon los estudiantes (no vienen de un pensum cargado): no tienen semestre
SELECT carrera_id, materia_id, materia_nombre, count(*) AS archivos
FROM proc_materiales
WHERE semestre IS NULL AND carrera_id <> 'nucleo'
GROUP BY carrera_id, materia_id, materia_nombre
ORDER BY carrera_id, archivos DESC;

-- Profesores con más material en el banco
SELECT profesor, count(*) AS archivos, count(DISTINCT materia_id) AS materias
FROM proc_materiales
WHERE tipo <> 'apuntes'
GROUP BY profesor
ORDER BY archivos DESC
LIMIT 10;

-- Qué porcentaje de parciales, quices y talleres trae solución
SELECT tipo,
       count(*) AS total,
       round(100.0 * count_if(con_solucion) / count(*), 1) AS pct_con_solucion
FROM proc_materiales
WHERE tipo IN ('parcial', 'quiz', 'ejercicios')
GROUP BY tipo;

-- Descargas por día de la semana (hora de Bogotá), sobre los eventos crudos
SELECT day_of_week(from_iso8601_timestamp(creado_en) AT TIME ZONE 'America/Bogota') AS dia,
       count(*) AS descargas
FROM raw_descargas
GROUP BY 1
ORDER BY 1;

-- Cuánto tarda en llegar un parcial al banco después de presentarse (días)
SELECT tipo,
       round(avg(date_diff('day', fecha, CAST(creado_en AS date))), 1) AS dias_promedio,
       min(date_diff('day', fecha, CAST(creado_en AS date))) AS minimo
FROM proc_materiales
GROUP BY tipo;

-- MACC por semestre, con su material en una fila por semestre
SELECT semestre,
       count_if(tipo = 'parcial')    AS parciales,
       count_if(tipo = 'quiz')       AS quices,
       count_if(tipo = 'apuntes')    AS apuntes,
       count_if(tipo = 'ejercicios') AS talleres,
       sum(descargas)                AS descargas
FROM proc_materiales
WHERE carrera_id = 'macc'
GROUP BY semestre
ORDER BY semestre;
