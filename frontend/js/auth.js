/* NASH — autenticación.
 * Con AWS: Amazon Cognito (User Pool) llamado directamente con fetch, sin SDK
 *   (SignUp, ConfirmSignUp, InitiateAuth USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH, ForgotPassword…).
 * Sin AWS (config.js sin COGNITO_CLIENT_ID): MODO LOCAL, con cuentas guardadas solo en este navegador.
 *
 * El ID token (JWT) que devuelve Cognito se manda a API Gateway en la cabecera Authorization;
 * el autorizador JWT de API Gateway lo valida antes de invocar la Lambda.
 */
(function () {
  const CFG = window.NASH_CONFIG || {};
  const DEMO = !CFG.COGNITO_CLIENT_ID;
  const CLAVE_SESION = "nash.sesion";
  const CLAVE_CUENTAS = "nash.local.cuentas";
  const CLAVE_CARRERA = "nash.carrera";
  // Cuenta que ya existe en modo local, para probar sin registrarse
  const CUENTA_PRUEBA = { email: "prueba@urosario.edu.co", password: "nash2026", nombre: "Estudiante de prueba", sub: "u-prueba", carrera: "macc" };

  // ---------- almacenamiento tolerante a fallos (modo privado, cookies bloqueadas) ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }
  };
  let memoria = null; // respaldo si localStorage no está disponible

  // ---------- errores en español ----------
  const MENSAJES = {
    UsernameExistsException: "Ya existe una cuenta con ese correo. Ingresa o recupera tu contraseña.",
    InvalidPasswordException: "La contraseña no cumple las reglas: mínimo 8 caracteres, con letras y números.",
    CodeMismatchException: "El código no coincide. Revisa el correo e inténtalo de nuevo.",
    ExpiredCodeException: "El código venció. Pide uno nuevo.",
    NotAuthorizedException: "Correo o contraseña incorrectos.",
    UserNotConfirmedException: "Tu cuenta aún no está confirmada. Escribe el código que te llegó al correo.",
    UserNotFoundException: "No hay ninguna cuenta con ese correo.",
    LimitExceededException: "Demasiados intentos. Espera unos minutos.",
    TooManyRequestsException: "Demasiados intentos. Espera unos minutos.",
    InvalidParameterException: "Revisa los datos: algún campo no es válido."
  };
  function errorCognito(tipo, mensaje) {
    const code = String(tipo || "").split("#").pop();
    let texto = MENSAJES[code] || mensaje || "No se pudo completar la operación.";
    // La Lambda de pre-registro rechaza dominios no permitidos: "PreSignUp failed with error …"
    if (code === "UserLambdaValidationException") texto = String(mensaje || "").replace(/^PreSignUp failed with error\s*/i, "").replace(/\.$/, "") + ".";
    const err = new Error(texto);
    err.code = code;
    return err;
  }

  function dominioValido(email) {
    const dom = String(email || "").toLowerCase().split("@")[1] || "";
    return (CFG.DOMINIOS_PERMITIDOS || []).includes(dom);
  }
  function validarRegistro({ nombre, email, password }) {
    if (!nombre || nombre.trim().length < 3) throw new Error("Escribe tu nombre completo.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) throw new Error("Escribe un correo válido.");
    if (!dominioValido(email)) throw new Error(`Usa tu correo institucional (@${(CFG.DOMINIOS_PERMITIDOS || [])[0]}).`);
    if (!password || password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))
      throw new Error("La contraseña necesita mínimo 8 caracteres, con letras y números.");
  }

  // ---------- JWT ----------
  function claims(jwt) {
    try {
      const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(atob(b64).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
      return JSON.parse(json);
    } catch (e) { return {}; }
  }
  function guardarSesion(r, refreshAnterior) {
    const c = claims(r.IdToken);
    const s = {
      idToken: r.IdToken, accessToken: r.AccessToken,
      refreshToken: r.RefreshToken || refreshAnterior,
      expira: Date.now() + (r.ExpiresIn || 3600) * 1000 - 60000,
      email: c.email, nombre: c.name || c.email, sub: c.sub
    };
    memoria = s; store.set(CLAVE_SESION, s);
    return s;
  }

  // ---------- Cognito real ----------
  async function cognito(accion, cuerpo) {
    const res = await fetch(`https://cognito-idp.${CFG.REGION}.amazonaws.com/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService." + accion },
      body: JSON.stringify(cuerpo)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw errorCognito(data.__type, data.message);
    return data;
  }

  const real = {
    async registrar({ nombre, email, password }) {
      validarRegistro({ nombre, email, password });
      const r = await cognito("SignUp", {
        ClientId: CFG.COGNITO_CLIENT_ID, Username: email.trim().toLowerCase(), Password: password,
        UserAttributes: [{ Name: "email", Value: email.trim().toLowerCase() }, { Name: "name", Value: nombre.trim() }]
      });
      return { necesitaConfirmar: !r.UserConfirmed, destino: (r.CodeDeliveryDetails || {}).Destination };
    },
    confirmar: ({ email, codigo }) => cognito("ConfirmSignUp", { ClientId: CFG.COGNITO_CLIENT_ID, Username: email.trim().toLowerCase(), ConfirmationCode: String(codigo).trim() }),
    reenviarCodigo: (email) => cognito("ResendConfirmationCode", { ClientId: CFG.COGNITO_CLIENT_ID, Username: email.trim().toLowerCase() }),
    async ingresar({ email, password }) {
      const r = await cognito("InitiateAuth", {
        ClientId: CFG.COGNITO_CLIENT_ID, AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email.trim().toLowerCase(), PASSWORD: password }
      });
      if (!r.AuthenticationResult) throw new Error("Cognito pidió un paso extra que NASH no maneja (" + r.ChallengeName + ").");
      return guardarSesion(r.AuthenticationResult);
    },
    async refrescar(s) {
      const r = await cognito("InitiateAuth", {
        ClientId: CFG.COGNITO_CLIENT_ID, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: s.refreshToken }
      });
      return guardarSesion(r.AuthenticationResult, s.refreshToken);
    },
    olvide: (email) => cognito("ForgotPassword", { ClientId: CFG.COGNITO_CLIENT_ID, Username: email.trim().toLowerCase() }),
    restablecer: ({ email, codigo, password }) => cognito("ConfirmForgotPassword", {
      ClientId: CFG.COGNITO_CLIENT_ID, Username: email.trim().toLowerCase(), ConfirmationCode: String(codigo).trim(), Password: password
    })
  };

  // ---------- modo local (solo en este navegador) ----------
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  function cuentas() {
    const c = store.get(CLAVE_CUENTAS) || {};
    const d = CUENTA_PRUEBA;
    if (!c[d.email]) c[d.email] = { nombre: d.nombre, password: d.password, confirmado: true, sub: d.sub, carrera: d.carrera };
    return c;
  }
  function tokenDemo(cuenta, email) {
    const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, "");
    return "demo." + b64({ sub: cuenta.sub, email, name: cuenta.nombre }) + ".firma";
  }
  const demo = {
    async registrar({ nombre, email, password, carrera }) {
      validarRegistro({ nombre, email, password });
      await espera(500);
      const c = cuentas(); email = email.trim().toLowerCase();
      if (c[email]) throw errorCognito("UsernameExistsException");
      const codigo = String(Math.floor(100000 + Math.random() * 900000));
      c[email] = { nombre: nombre.trim(), password, confirmado: false, codigo, sub: "u-" + Math.random().toString(36).slice(2, 10), carrera: carrera || "" };
      store.set(CLAVE_CUENTAS, c);
      return { necesitaConfirmar: true, destino: email, codigoDemo: codigo };
    },
    async confirmar({ email, codigo }) {
      await espera(400);
      const c = cuentas(); const u = c[email.trim().toLowerCase()];
      if (!u) throw errorCognito("UserNotFoundException");
      if (u.codigo !== String(codigo).trim()) throw errorCognito("CodeMismatchException");
      u.confirmado = true; delete u.codigo; store.set(CLAVE_CUENTAS, c);
      return {};
    },
    async reenviarCodigo(email) {
      await espera(300);
      const c = cuentas(); const u = c[email.trim().toLowerCase()];
      if (!u) throw errorCognito("UserNotFoundException");
      u.codigo = String(Math.floor(100000 + Math.random() * 900000)); store.set(CLAVE_CUENTAS, c);
      return { codigoDemo: u.codigo };
    },
    async ingresar({ email, password }) {
      await espera(450);
      email = email.trim().toLowerCase();
      const u = cuentas()[email];
      if (!u || u.password !== password) throw errorCognito("NotAuthorizedException");
      if (!u.confirmado) throw errorCognito("UserNotConfirmedException");
      if (u.carrera && !carrera(email)) fijarCarrera(u.carrera, email);
      const tok = tokenDemo(u, email);
      return guardarSesion({ IdToken: tok, AccessToken: tok, RefreshToken: "demo-refresh", ExpiresIn: 8 * 3600 });
    },
    async refrescar(s) { return guardarSesion({ IdToken: s.idToken, AccessToken: s.accessToken, ExpiresIn: 8 * 3600 }, s.refreshToken); },
    async olvide(email) {
      await espera(300);
      const c = cuentas(); const u = c[email.trim().toLowerCase()];
      if (!u) throw errorCognito("UserNotFoundException");
      u.codigo = String(Math.floor(100000 + Math.random() * 900000)); store.set(CLAVE_CUENTAS, c);
      return { codigoDemo: u.codigo };
    },
    async restablecer({ email, codigo, password }) {
      await espera(400);
      if (!password || password.length < 8 || !/\d/.test(password)) throw errorCognito("InvalidPasswordException");
      const c = cuentas(); const u = c[email.trim().toLowerCase()];
      if (!u) throw errorCognito("UserNotFoundException");
      if (u.codigo !== String(codigo).trim()) throw errorCognito("CodeMismatchException");
      u.password = password; u.confirmado = true; delete u.codigo; store.set(CLAVE_CUENTAS, c);
      return {};
    }
  };

  const impl = DEMO ? demo : real;

  function sesion() { return store.get(CLAVE_SESION) || memoria; }

  /** Devuelve un ID token vigente (lo refresca si venció) o null si no hay sesión. */
  async function token() {
    let s = sesion();
    if (!s) return null;
    if (Date.now() > s.expira) {
      try { s = await impl.refrescar(s); } catch (e) { salir(); return null; }
    }
    return s.idToken;
  }

  // La carrera de cada persona (por correo, en este navegador): decide qué pensum ve primero.
  // Se elige al crear la cuenta y se cambia en la app.
  const claveCarrera = (email) => CLAVE_CARRERA + ":" + String(email || (sesion() || {}).email || "").toLowerCase();
  function carrera(email) { const c = store.get(claveCarrera(email)); return typeof c === "string" ? c : ""; }
  function fijarCarrera(id, email) { if (id) store.set(claveCarrera(email), id); else store.del(claveCarrera(email)); }

  function salir() {
    const s = sesion();
    memoria = null; store.del(CLAVE_SESION);
    if (!DEMO && s && s.accessToken) {
      cognito("GlobalSignOut", { AccessToken: s.accessToken }).catch(() => {});
    }
  }

  window.NASH = window.NASH || {};
  window.NASH.auth = Object.assign({}, impl, { DEMO, CUENTA_PRUEBA: DEMO ? CUENTA_PRUEBA : null, sesion, token, salir, dominioValido, carrera, fijarCarrera });
})();
