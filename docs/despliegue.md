# Desplegar NASH en AWS

Hay dos caminos: una cuenta propia, o AWS Academy (Learner Lab). Lo único que cambia es el parámetro
`LabRoleArn`.

## 0. Requisitos

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) con
  credenciales. En Learner Lab: *AWS Details → AWS CLI → Show*, y se pegan en `~/.aws/credentials`.
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).
- Python 3.12. Solo hace falta para `sam build`; la Lambda no tiene dependencias externas.

Revisa con `aws sts get-caller-identity` que la CLI apunta a la cuenta correcta.

## 1. Desplegar la pila

```bash
cd backend
sam build
sam deploy --guided
```

Respuestas sugeridas:

| Pregunta | Valor |
| --- | --- |
| Stack Name | `nash` |
| AWS Region | `us-east-1` (en Learner Lab, la del laboratorio) |
| Parameter Prefijo | `nash` |
| Parameter LabRoleArn | Cuenta propia: vacío. **Learner Lab:** `arn:aws:iam::<cuenta>:role/LabRole` |
| Parameter DominiosPermitidos | `urosario.edu.co` |
| Parameter MaxMB | `10` |
| Parameter OrigenLocal | `http://localhost:8765` |
| Confirm changes before deploy | `y` |
| Allow SAM CLI IAM role creation | `y` (con LabRole no crea ninguno) |
| ApiFunction has no authentication… | `y`: es la ruta pública `/publico/resumen` |
| Save arguments to configuration file | `y` |

Al final se imprimen las **salidas** (Outputs). Guárdalas; también están en CloudFormation → nash →
Outputs.

> Si falla `WebBucketPolicy` con *AccessDenied … BlockPublicPolicy*, la cuenta tiene el bloqueo de
> acceso público a nivel de cuenta. Desactívalo en S3 → *Block Public Access settings for this account*
> y vuelve a desplegar. En Learner Lab suele venir apagado.

## 2. Subir el script del job ETL

```bash
aws s3 cp glue/etl_materiales.py s3://<DataBucketName>/scripts/etl_materiales.py
```

## 3. Conectar el frontend

Edita `frontend/js/config.js` con las salidas:

```js
window.NASH_CONFIG = {
  API_URL: "<ApiUrl>",
  REGION: "<Region>",
  COGNITO_USER_POOL_ID: "<UserPoolId>",
  COGNITO_CLIENT_ID: "<UserPoolClientId>",
  DOMINIOS_PERMITIDOS: ["urosario.edu.co"],
  MAX_MB: 10
};
```

Con `API_URL` y `COGNITO_CLIENT_ID` llenos, el modo demostración se apaga solo.

## 4. Subir el sitio

```bash
cd ..   # raíz del proyecto
aws s3 sync frontend/ s3://<WebBucketName>/ --delete
```

Abre `<WebsiteURL>`.

## 5. Primera prueba de punta a punta

1. **Crear cuenta** con un correo @urosario.edu.co. Llega un código de Cognito. Con cualquier otro
   dominio, la Lambda de pre-registro lo rechaza.
2. **Subir material** (por ejemplo un parcial en PDF). En S3 aparecen tres objetos:
   - `raw/materiales/macc.31__parcial__2026-1__n2__…json`
   - `raw/archivos/<id>.pdf`
   - `indice/<id>.json`
3. Intenta subir **el mismo parcial otra vez**. El formulario lo bloquea y la API responde 409.
4. La primera subida inicia el **crawler raw**, que crea `raw_materiales`. A partir de ahí la lista de la
   materia sale de Athena. Revisa en Glue → Crawlers que haya terminado (1 o 2 minutos).
5. La confirmación inicia el **job ETL**. Al terminar (unos 2 minutos), este corre el **crawler
   processed**, que crea `proc_materiales`. Entonces se llena la pantalla de Estadísticas.
6. En la consola de Athena, elige el grupo de trabajo **nash** y corre `backend/athena/consultas.sql`.

## 6. Problemas comunes

| Síntoma | Causa y arreglo |
| --- | --- |
| "No hay conexión con la API… CORS" | El sitio no se abrió desde `WebsiteURL` ni desde `OrigenLocal`. Si usas otro dominio, agrégalo en `CorsConfiguration` (HttpApi) y en `CorsRules` (DataBucket). |
| "S3 rechazó el archivo (403)" | El POST firmado venció (10 minutos) o el archivo supera `MaxMB`. |
| Las listas salen vacías justo después de subir | El crawler raw todavía no ha creado `raw_materiales` (solo pasa la primera vez). Espera a que termine. |
| Estadísticas en cero | Aún no corre el job ETL, o falta `scripts/etl_materiales.py` en el bucket (paso 2). |
| El correo con el código no llega | Cognito usa su remitente por defecto: unos 50 correos al día. Revisa el correo no deseado. |
| En Learner Lab todo deja de responder | La sesión del laboratorio venció: vuelve a iniciarla y actualiza las credenciales de la CLI. |

## 7. Probar sin la nube

```bash
cd frontend
python -m http.server 8765
```

Abre `http://localhost:8765`. Sin API configurada todo corre en modo local: el banco empieza vacío y vive solo en ese navegador.

- Cuenta de prueba: `prueba@urosario.edu.co`, contraseña `nash2026`.
- `app.html?demo` entra directo con esa cuenta.

## 8. Borrar todo

```bash
aws s3 rm s3://<WebBucketName> --recursive
aws s3 rm s3://<DataBucketName> --recursive
sam delete --stack-name nash
```

CloudFormation no borra buckets con objetos; por eso se vacían antes.
