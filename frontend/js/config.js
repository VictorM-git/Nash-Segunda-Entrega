/* NASH — configuración del frontend.
 *
 * Mientras API_URL y COGNITO_CLIENT_ID estén vacíos, la página funciona en MODO LOCAL: el banco empieza
 * vacío y las cuentas y lo que subas quedan solo en este navegador. Sirve para probar el diseño sin la nube.
 *
 * Para usar el banco real, despliega el backend (ver PROYECTO-FINAL-CN.md, "Conectar la base de datos")
 * y copia aquí las salidas de la pila (sam deploy las imprime al final; también están en
 * CloudFormation → nash → Outputs).
 */
window.NASH_CONFIG = {
  // Salida "ApiUrl", p. ej. "https://abc123.execute-api.us-east-1.amazonaws.com"
  API_URL: "",

  // Región donde desplegaste el stack
  REGION: "us-east-1",

  // Salidas "UserPoolId" y "UserPoolClientId"
  COGNITO_USER_POOL_ID: "",
  COGNITO_CLIENT_ID: "",

  // Solo se aceptan cuentas con estos dominios (la Lambda de pre-registro también lo valida)
  DOMINIOS_PERMITIDOS: ["urosario.edu.co"],

  // Tamaño máximo de archivo en MB (debe coincidir con MAX_MB de la Lambda)
  MAX_MB: 10
};
