import os

DOMINIOS = [d.strip().lower() for d in os.environ.get("DOMINIOS", "urosario.edu.co").split(",") if d.strip()]

def handler(event, _context):
    atributos = (event.get("request") or {}).get("userAttributes") or {}
    email = str(atributos.get("email") or "").strip().lower()
    dominio = email.rsplit("@", 1)[1] if email.count("@") == 1 else ""
    if dominio not in DOMINIOS:
        raise Exception(f"Usa tu correo institucional (@{DOMINIOS[0]})")
    if len(" ".join(str(atributos.get("name") or "").split())) < 3:
        raise Exception("Escribe tu nombre completo")
    return event
