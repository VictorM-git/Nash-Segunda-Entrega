(function () {
  const N = window.NASH;
  const A = N.auth;
  const $ = (s, r = document) => r.querySelector(s);
  const vistas = Array.from(document.querySelectorAll("[data-vista]"));
  const aviso = $("#aviso");
  const PENDIENTE = "nash.pendiente";
  let passwordReciente = null;

  const volver = (() => {
    const v = new URLSearchParams(location.search).get("volver") || "";
    return /^#\/[\w\-/]*$/.test(v) ? v : "#/";
  })();
  const irAlBanco = () => location.replace("app.html" + volver);

  if (A.sesion()) { irAlBanco(); return; }

  const leerPendiente = () => { try { return sessionStorage.getItem(PENDIENTE) || ""; } catch (e) { return ""; } };
  const guardarPendiente = (email) => { try { sessionStorage.setItem(PENDIENTE, email); } catch (e) {} };

  function mostrarAviso(texto, tipo) {
    if (!texto) { aviso.hidden = true; return; }
    aviso.className = "auth-aviso" + (tipo ? " " + tipo : "");
    aviso.textContent = texto;
    aviso.hidden = false;
  }
  const demo = $("#aviso-demo");
  function avisoDemo(html) {
    if (!A.DEMO) return;
    demo.innerHTML = html;
    demo.hidden = false;
  }
  function avisoDemoBase() {
    const c = A.CUENTA_PRUEBA;
    avisoDemo(`Modo local: nada sale de este navegador y no se envían correos. Puedes crear una cuenta o usar la de prueba, <b>${c.email}</b> con la contraseña <b>${c.password}</b>. <button type="button" id="usar-prueba">Usar la cuenta de prueba</button>`);
    const b = $("#usar-prueba");
    if (b) b.addEventListener("click", () => {
      $("#in-email").value = c.email;
      $("#in-pass").value = c.password;
      $("#f-ingresar").requestSubmit();
    });
  }

  function mostrar(nombre, { conservarAviso = false } = {}) {
    if (!vistas.some((v) => v.dataset.vista === nombre)) nombre = "ingresar";
    vistas.forEach((v) => (v.hidden = v.dataset.vista !== nombre));
    if (!conservarAviso) mostrarAviso("");
    if (nombre === "confirmar") {
      const email = $("#co-email").value || leerPendiente();
      $("#co-email").value = email;
      $("#confirmar-sub").textContent = email ? `Enviamos un código de seis dígitos a ${email}. Puede tardar un minuto; revisa también el correo no deseado.` : "Escribe tu correo y el código de seis dígitos que te enviamos.";
    }
    if (A.DEMO && (nombre === "ingresar" || nombre === "crear")) avisoDemoBase();
    else if (A.DEMO && !demo.dataset.fijo) demo.hidden = true;
    document.title = { ingresar: "Ingresar", crear: "Crear cuenta", confirmar: "Confirmar cuenta", olvide: "Recuperar contraseña", restablecer: "Nueva contraseña" }[nombre] + " · NASH";
    const campo = vistas.find((v) => !v.hidden).querySelector("input:not([type=hidden])");
    if (campo && document.activeElement !== document.body) campo.focus({ preventScroll: true });
  }
  addEventListener("hashchange", () => { delete demo.dataset.fijo; mostrar(location.hash.slice(1)); });
  function ir(nombre, opciones) {
    if (location.hash.slice(1) === nombre) mostrar(nombre, opciones);
    else { history.pushState(null, "", "#" + nombre); mostrar(nombre, opciones); }
  }

  function errorCampo(input, texto) {
    const field = input.closest(".field");
    let el = field.querySelector(".error");
    if (!texto) { if (el) el.remove(); input.removeAttribute("aria-invalid"); return; }
    if (!el) {
      el = document.createElement("p");
      el.className = "error";
      el.id = input.id + "-error";
      field.appendChild(el);
    }
    el.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-alerta"/></svg><span></span>`;
    el.querySelector("span").textContent = texto;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-errormessage", el.id);
  }
  const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  const reglas = (v) => ({ largo: v.length >= 8, letra: /[a-z]/.test(v), numero: /\d/.test(v) });
  function revisar(campos) {
    let primero = null;
    campos.forEach(([input, mensaje]) => {
      errorCampo(input, mensaje || "");
      if (mensaje && !primero) primero = input;
    });
    if (primero) primero.focus();
    return !primero;
  }
  document.querySelectorAll(".input").forEach((i) => ["input", "change"].forEach((t) => i.addEventListener(t, () => i.getAttribute("aria-invalid") && errorCampo(i, ""))));

  $("#cr-carrera").insertAdjacentHTML("beforeend", N.FACULTADES.map((f) => `<optgroup label="${f}">${N.CARRERAS.filter((c) => c.facultad === f).map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("")}</optgroup>`).join(""));

  document.querySelectorAll("[data-reglas]").forEach((p) => {
    const input = document.getElementById(p.dataset.reglas);
    input.addEventListener("input", () => {
      const r = reglas(input.value);
      p.querySelectorAll("[data-regla]").forEach((s) => {
        const ok = r[s.dataset.regla];
        s.classList.toggle("ok", ok);
        s.querySelector("use").setAttribute("href", ok ? "#i-check" : "#i-punto");
      });
    });
  });

  document.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.ver);
    const ver = input.type === "password";
    input.type = ver ? "text" : "password";
    b.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
    b.querySelector("use").setAttribute("href", ver ? "#i-ojo-no" : "#i-ojo");
  }));

  async function enviar(form, texto, tarea) {
    const btn = form.querySelector("[type=submit]");
    const antes = btn.textContent;
    btn.disabled = true; btn.textContent = texto;
    mostrarAviso("");
    try { await tarea(); }
    catch (e) { mostrarAviso(e.message || "No se pudo completar. Intenta de nuevo.", "neg"); return e; }
    finally { btn.disabled = false; btn.textContent = antes; }
    return null;
  }

  $("#f-ingresar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("#in-email"), pass = $("#in-pass");
    const ok = revisar([
      [email, !email.value.trim() ? "Escribe tu correo." : !emailOk(email.value.trim()) ? "Ese correo no parece válido." : ""],
      [pass, !pass.value ? "Escribe tu contraseña." : ""]
    ]);
    if (!ok) return;
    const err = await enviar(ev.target, "Ingresando…", async () => {
      await A.ingresar({ email: email.value.trim(), password: pass.value });
      irAlBanco();
    });
    if (err && err.code === "UserNotConfirmedException") {
      $("#co-email").value = email.value.trim(); guardarPendiente(email.value.trim());
      passwordReciente = pass.value;
      ir("confirmar", { conservarAviso: true });
      mostrarAviso("Tu cuenta aún no está confirmada. Escribe el código o pide uno nuevo.", "warn");
    }
  });

  $("#f-crear").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nombre = $("#cr-nombre"), email = $("#cr-email"), carrera = $("#cr-carrera"), pass = $("#cr-pass");
    const e = email.value.trim(), r = reglas(pass.value);
    const dom = ((window.NASH_CONFIG || {}).DOMINIOS_PERMITIDOS || ["urosario.edu.co"])[0];
    const ok = revisar([
      [nombre, nombre.value.trim().length < 3 ? "Escribe tu nombre completo." : ""],
      [email, !e ? "Escribe tu correo." : !emailOk(e) ? "Ese correo no parece válido." : !A.dominioValido(e) ? `Usa tu correo institucional (@${dom}).` : ""],
      [carrera, !carrera.value ? "Elige tu carrera." : ""],
      [pass, !(r.largo && r.letra && r.numero) ? "La contraseña no cumple las reglas de abajo." : ""]
    ]);
    if (!ok) return;
    await enviar(ev.target, "Creando cuenta…", async () => {
      const res = await A.registrar({ nombre: nombre.value.trim(), email: e, password: pass.value, carrera: carrera.value });
      A.fijarCarrera(carrera.value, e);
      passwordReciente = pass.value;
      $("#co-email").value = e; guardarPendiente(e);
      if (res.necesitaConfirmar === false) { await A.ingresar({ email: e, password: pass.value }); irAlBanco(); return; }
      ir("confirmar");
      if (res.codigoDemo) { demo.dataset.fijo = "1"; avisoDemo(`Modo local: no se envía ningún correo. Tu código es <b>${res.codigoDemo}</b>.`); }
    });
  });

  $("#f-confirmar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("#co-email"), codigo = $("#co-codigo");
    const ok = revisar([
      [email, !emailOk(email.value.trim()) ? "Escribe el correo con el que te registraste." : ""],
      [codigo, !/^\d{6}$/.test(codigo.value.trim()) ? "El código tiene seis dígitos." : ""]
    ]);
    if (!ok) return;
    await enviar(ev.target, "Confirmando…", async () => {
      await A.confirmar({ email: email.value.trim(), codigo: codigo.value.trim() });
      try { sessionStorage.removeItem(PENDIENTE); } catch (e) {}
      if (passwordReciente) { await A.ingresar({ email: email.value.trim(), password: passwordReciente }); irAlBanco(); return; }
      $("#in-email").value = email.value.trim();
      ir("ingresar");
      mostrarAviso("Cuenta confirmada. Ya puedes ingresar.", "pos");
    });
  });
  $("#reenviar").addEventListener("click", async () => {
    const email = $("#co-email");
    if (!revisar([[email, !emailOk(email.value.trim()) ? "Escribe tu correo para reenviar el código." : ""]])) return;
    mostrarAviso("");
    try {
      const r = await A.reenviarCodigo(email.value.trim());
      mostrarAviso("Te enviamos un código nuevo.", "pos");
      if (r && r.codigoDemo) { demo.dataset.fijo = "1"; avisoDemo(`Modo local: tu código nuevo es <b>${r.codigoDemo}</b>.`); }
    } catch (e) { mostrarAviso(e.message, "neg"); }
  });

  let emailRecuperar = "";
  $("#f-olvide").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("#ol-email");
    if (!revisar([[email, !emailOk(email.value.trim()) ? "Escribe tu correo." : ""]])) return;
    await enviar(ev.target, "Enviando…", async () => {
      const r = await A.olvide(email.value.trim());
      emailRecuperar = email.value.trim();
      $("#restablecer-sub").textContent = `Escribe el código que enviamos a ${emailRecuperar} y tu nueva contraseña.`;
      ir("restablecer");
      if (r && r.codigoDemo) { demo.dataset.fijo = "1"; avisoDemo(`Modo local: tu código es <b>${r.codigoDemo}</b>.`); }
    });
  });
  $("#f-restablecer").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!emailRecuperar) { ir("olvide"); return; }
    const codigo = $("#re-codigo"), pass = $("#re-pass"), r = reglas(pass.value);
    const ok = revisar([
      [codigo, !/^\d{6}$/.test(codigo.value.trim()) ? "El código tiene seis dígitos." : ""],
      [pass, !(r.largo && r.letra && r.numero) ? "La contraseña no cumple las reglas de abajo." : ""]
    ]);
    if (!ok) return;
    await enviar(ev.target, "Guardando…", async () => {
      await A.restablecer({ email: emailRecuperar, codigo: codigo.value.trim(), password: pass.value });
      $("#in-email").value = emailRecuperar; $("#in-pass").value = "";
      ir("ingresar");
      mostrarAviso("Listo: tu contraseña cambió. Ingresa con la nueva.", "pos");
    });
  });

  const inicial = location.hash.slice(1) || "ingresar";
  mostrar(inicial === "restablecer" && !emailRecuperar ? "olvide" : inicial);
})();
