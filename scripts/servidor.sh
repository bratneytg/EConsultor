#!/usr/bin/env bash
# Utilidades para el servidor casero de EConsultor (Ubuntu + Docker + Tailscale).
# Se ejecuta DENTRO del servidor, en la carpeta del proyecto:
#
#   bash scripts/servidor.sh informe          Informe claro del servidor y de la base de datos
#   bash scripts/servidor.sh actividad [días] Qué ha pasado en la base de datos (usuarios nuevos, entradas, avisos)
#   bash scripts/servidor.sh copias           Configura las copias de seguridad cifradas (restic) y hace la primera
#   bash scripts/servidor.sh copiar           Hace una copia ahora (la tarea nocturna usa este comando)
#   bash scripts/servidor.sh restaurar [ID]   Lista las copias o restaura una (pide confirmación)
#   bash scripts/servidor.sh estado           Resumen técnico corto, para pegarlo en el chat
#   bash scripts/servidor.sh actualizar       Descarga cambios de GitHub y reconstruye si los hay
#   bash scripts/servidor.sh actualizaciones  Programa `actualizar` cada 10 minutos (cron)
#   bash scripts/servidor.sh publico          Abre la app a internet con Tailscale Funnel
#   bash scripts/servidor.sh privado          Vuelve a dejarla solo dentro de tu red de Tailscale
#   bash scripts/servidor.sh panel            Instala/actualiza el panel personal (web con gráficos, solo para ti)
#   bash scripts/servidor.sh panel-clave      Genera una contraseña nueva para el panel
#   bash scripts/servidor.sh panel-parar      Apaga el panel y lo quita de Tailscale
#   bash scripts/servidor.sh direccion        Tras cambiar el nombre del equipo o de la red en Tailscale: actualiza todo
#   bash scripts/servidor.sh activar          Activa Premium para todos, la IA y los avisos push (genera las claves VAPID)
#   bash scripts/servidor.sh perfiles on|off  Muestra u oculta la pestaña «Perfiles» del panel (apagado por defecto)
#   bash scripts/servidor.sh psico on|off     Añade a «Perfiles» la evaluación psico-económica (apagado por defecto)
#   bash scripts/servidor.sh apk URL          Pone el enlace de descarga de la app de Android en la web
#   bash scripts/servidor.sh bareglass …      Aloja BareGlass (API) en este servidor: instalar | estado | parar | publico | privado | actualizar
#   bash scripts/servidor.sh tapa [arreglar]  Comprueba (o arregla) que cerrar la tapa del portátil NO suspenda el servidor
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
PUERTO=8787
REPO="${HOME}/backups"                                  # repositorio de copias (cifrado con restic)
CLAVE_RESTIC="${HOME}/.config/econsultor/restic-pass"   # contraseña del repositorio (solo tu usuario la lee)

# ───────── ayudas de presentación ─────────
titulo() { printf '\n%s\n%s\n' "$1" "$(printf '─%.0s' $(seq 1 ${#1}))"; }
ok() { echo "[OK] $*"; }
aviso() { echo "[AVISO] $*"; }
alerta() { echo "[ALERTA] $*"; }

# `docker compose` con el panel incluido si ya se instaló (existe .env.panel).
compose() {
  if [ -f "${DIR}/.env.panel" ]; then docker compose --profile panel "$@"; else docker compose "$@"; fi
}

app_encendida() { docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -q '^app running'; }

# ───────── informe del servidor + base de datos ─────────
informe() {
  echo "INFORME DE EConsultor · $(TZ=Europe/Berlin date '+%Y-%m-%d %H:%M') (hora de Berlín)"

  titulo "SERVIDOR"
  echo "Sistema: $(lsb_release -ds 2>/dev/null || echo 'desconocido')"
  echo "Encendido desde hace: $(uptime -p | sed -e 's/^up //' -e 's/\b1 week\b/1 semana/' -e 's/\b1 day\b/1 día/' -e 's/\b1 hour\b/1 hora/' -e 's/\b1 minute\b/1 min/' -e 's/weeks\?/semanas/' -e 's/days\?/días/' -e 's/hours\?/horas/' -e 's/minutes\?/min/')"

  local mem disco
  mem="$(free -m | awk '/^Mem:/ {printf "%d", ($2-$7)*100/$2}')"
  if [ "$mem" -ge 85 ]; then aviso "Memoria en uso: ${mem}%. Va justa: si se llena, el sistema empezará a cerrar programas."
  else ok "Memoria en uso: ${mem}% (lo normal es estar por debajo del 85%)."; fi

  disco="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  if [ "$disco" -ge 90 ]; then alerta "Disco lleno al ${disco}%. Hay que liberar espacio ya."
  elif [ "$disco" -ge 80 ]; then aviso "Disco lleno al ${disco}%. Conviene revisar qué ocupa."
  else ok "Disco ocupado al ${disco}%."; fi

  local pend
  pend="$( (apt list --upgradable 2>/dev/null || true) | grep -c upgradable || true)"
  if [ "${pend:-0}" -gt 0 ]; then aviso "Hay ${pend} actualizaciones del sistema pendientes (las de seguridad se instalan solas; el resto, con 'sudo apt update && sudo apt full-upgrade')."
  else ok "El sistema está al día."; fi
  if [ -f /var/run/reboot-required ]; then aviso "El sistema pide reiniciar para terminar de actualizarse ('sudo reboot')."; fi

  titulo "LA APP"
  if app_encendida; then
    local salud
    salud="$(docker compose ps --format '{{.Health}}' app 2>/dev/null | head -1)"
    if [ "$salud" = "healthy" ]; then ok "El contenedor de la app está encendido y sano."
    else aviso "El contenedor de la app está encendido pero su comprobación de salud dice «${salud:-desconocido}». Si acaba de arrancar, espera un minuto y repite."; fi
  else
    alerta "El contenedor de la app NO está encendido. Prueba: docker compose up -d"
  fi
  if curl -fs -m 5 -o /dev/null "http://127.0.0.1:${PUERTO}/healthz"; then ok "La app responde correctamente."
  else alerta "La app no responde en el puerto ${PUERTO}."; fi
  echo "Versión instalada: $(git log -1 --format='%h «%s», %cr')"

  git fetch -q origin 2>/dev/null || true
  local rama
  rama="$(git rev-parse --abbrev-ref HEAD)"
  if git rev-parse "origin/${rama}" >/dev/null 2>&1 && [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${rama}")" ]; then
    aviso "Hay una versión más nueva en GitHub. Se instalará con 'bash scripts/servidor.sh actualizar' (o sola, si tienes las actualizaciones automáticas)."
  else
    ok "Tienes la última versión del código."
  fi
  if crontab -l 2>/dev/null | grep -q 'servidor.sh actualizar'; then ok "Actualizaciones automáticas: activadas."
  else aviso "Actualizaciones automáticas: desactivadas (se activan con 'bash scripts/servidor.sh actualizaciones')."; fi

  titulo "ACCESO DESDE FUERA"
  if tailscale status >/dev/null 2>&1; then ok "Tailscale está conectado."; else alerta "Tailscale no está conectado."; fi
  local serve
  serve="$(tailscale serve status 2>&1 || true)"
  if echo "$serve" | grep -qi 'funnel on'; then
    aviso "La app está PÚBLICA en internet (Funnel). Cualquiera con la dirección puede abrirla."
  elif echo "$serve" | grep -qi 'tailnet only'; then
    ok "La app es PRIVADA: solo la ven tus dispositivos con Tailscale."
  else
    echo "No he podido saber si es pública o privada. Esto es lo que dice Tailscale:"
    echo "$serve" | head -5
  fi
  echo "$serve" | grep -oE 'https://[^ ]+' | head -1 | sed 's/^/Dirección: /' || true

  titulo "COPIAS DE SEGURIDAD"
  if [ -f "$REPO/config" ]; then
    local ultima n horas
    n="$(find "$REPO/snapshots" -type f 2>/dev/null | wc -l)"
    ultima="$(find "$REPO/snapshots" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
    if [ -n "$ultima" ]; then
      horas=$(( ( $(date +%s) - ultima ) / 3600 ))
      if [ "$horas" -le 36 ]; then ok "La última copia es de hace ${horas} h (hay ${n} guardadas)."
      else aviso "La última copia tiene ${horas} horas. Mira el registro: tail ~/econsultor-copias.log"; fi
    else
      aviso "El repositorio de copias existe pero aún no tiene ninguna copia (bash scripts/servidor.sh copiar)."
    fi
    if crontab -l 2>/dev/null | grep -q 'servidor.sh copiar'; then ok "Copia automática cada noche: activada."
    else aviso "La copia automática no está programada (se programa con 'bash scripts/servidor.sh copias')."; fi
    echo "Recuerda: una copia solo en este mismo disco no te salva si el disco se estropea. Guarda otra fuera del servidor,"
    echo "y guarda DATA_ENCRYPTION_KEY y la contraseña de las copias en un sitio aparte (sin ellas, las copias no sirven)."
  else
    aviso "Las copias de seguridad no están configuradas. Se activan con: bash scripts/servidor.sh copias"
  fi

  if app_encendida; then
    docker compose exec -T app node dist/informe.js base
  else
    titulo "BASE DE DATOS"
    alerta "No puedo leer la base de datos porque el contenedor de la app no está encendido."
  fi

  titulo "PARA ENTENDERLO MEJOR"
  echo "[OK] = todo bien · [AVISO] = conviene mirarlo, no es urgente · [ALERTA] = hay que actuar."
  echo "Para ver quién se ha registrado o intentado entrar: bash scripts/servidor.sh actividad"
}

actividad() {
  if app_encendida; then
    docker compose exec -T app node dist/informe.js actividad "${1:-7}"
  else
    alerta "No puedo leer la base de datos porque el contenedor de la app no está encendido (docker compose up -d)."
    exit 1
  fi
}

# ───────── resumen técnico corto ─────────
estado() {
  echo "== Sistema =="
  lsb_release -ds 2>/dev/null || true
  uptime -p
  free -h | sed -n '1,2p'
  df -h / | tail -1
  echo
  echo "== Contenedores =="
  docker compose ps
  echo
  echo "== Salud de la app =="
  if curl -fsS -m 5 "http://127.0.0.1:${PUERTO}/healthz"; then echo; else echo "NO responde"; fi
  echo
  echo "== Tailscale =="
  tailscale status 2>&1 | head -6 || true
  tailscale serve status 2>&1 | head -8 || true
  echo
  echo "== Versión del código =="
  git log -1 --format='%h %s (%cr)'
  echo
  echo "== Últimas líneas del registro de la app =="
  docker compose logs --tail 15 app 2>&1 | sed -E 's/((secret|key|token|password|authorization)[A-Za-z_]*\"? *[=:] *\"?)[^ ,\"]+/\1***/Ig' || true
}

# ───────── copias de seguridad (restic) ─────────
restic_env() { export RESTIC_REPOSITORY="$REPO" RESTIC_PASSWORD_FILE="$CLAVE_RESTIC"; }

copias() {
  if ! app_encendida; then alerta "La app debe estar encendida para copiarla (docker compose up -d)."; exit 1; fi
  command -v restic >/dev/null 2>&1 || { echo "Instalando restic..."; sudo apt-get install -y restic; }

  local nueva=0
  if [ ! -f "$CLAVE_RESTIC" ]; then
    if [ -e "$REPO/config" ]; then
      alerta "Ya existe un repositorio de copias en ${REPO} pero falta su contraseña (${CLAVE_RESTIC}). No genero otra: sin la original no se puede leer."
      exit 1
    fi
    mkdir -p "$(dirname "$CLAVE_RESTIC")"
    ( umask 077; openssl rand -hex 24 > "$CLAVE_RESTIC" )
    nueva=1
  fi
  chmod 600 "$CLAVE_RESTIC"
  restic_env
  if ! restic cat config >/dev/null 2>&1; then restic init; fi

  if [ "$nueva" = 1 ]; then
    titulo "CONTRASEÑA DE LAS COPIAS: GUÁRDALA AHORA"
    cat "$CLAVE_RESTIC"
    echo
    echo "Sin esta contraseña no se puede recuperar ninguna copia, y este archivo se pierde con el servidor si se estropea."
    echo "Guárdala en tu gestor de contraseñas. Si la pierdes de la pantalla, está en: ${CLAVE_RESTIC}"
    if [ -t 0 ]; then read -r -p "Pulsa Enter cuando la hayas guardado... " _; fi
  fi

  copiar || aviso "La primera copia no se ha podido hacer todavía (por ejemplo, si aún no hay datos). La tarea nocturna lo reintentará."

  local tarea="30 3 * * * ${DIR}/scripts/servidor.sh copiar >> ${HOME}/econsultor-copias.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'servidor.sh copiar' || true; echo "$tarea" ) | crontab -

  titulo "LISTO"
  ok "Copia automática programada cada noche a las 03:30. Se conservan 7 diarias, 4 semanales y 6 mensuales."
  echo "Registro: ${HOME}/econsultor-copias.log · Copias: ${REPO}"
  echo
  echo "Falta lo más importante: una copia FUERA de este ordenador. Desde PowerShell en tu PC, de vez en cuando:"
  echo "  scp -r $(id -un)@$(hostname -I | awk '{print $1}'):backups C:\\Copias\\econsultor"
  echo "Y guarda DATA_ENCRYPTION_KEY (está en el archivo .env) en un sitio aparte: sin ella, ninguna copia de los datos se puede leer."
}

copiar() {
  restic_env
  [ -f "$CLAVE_RESTIC" ] || { alerta "Las copias no están configuradas. Ejecuta: bash scripts/servidor.sh copias"; exit 1; }
  app_encendida || { alerta "La app no está encendida: no se puede copiar."; exit 1; }
  docker compose exec -T app test -s /data/store.json || { alerta "Todavía no hay datos que copiar (/data/store.json no existe o está vacío)."; exit 1; }
  echo "$(date -Is) Copiando la base de datos..."
  docker compose exec -T app cat /data/store.json | restic backup --stdin --stdin-filename store.json --tag econsultor --quiet
  if bg_instalado && bg_compose ps --status running --services 2>/dev/null | grep -q '^api$'; then
    echo "$(date -Is) Copiando la base de datos de BareGlass..."
    # Copia coherente con SQLite (no basta con copiar el archivo mientras se escribe).
    bg_compose exec -T api python -c "import sqlite3,sys;o=sqlite3.connect('/data/bareglass.db');d=sqlite3.connect('/tmp/bg-copia.db');o.backup(d);d.close();sys.stdout.buffer.write(open('/tmp/bg-copia.db','rb').read())" \
      | restic backup --stdin --stdin-filename bareglass.db --tag bareglass --quiet || aviso "No se pudo copiar la base de datos de BareGlass."
  fi
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --quiet --group-by tags
  echo "$(date -Is) Copia hecha."
}

restaurar() {
  restic_env
  [ -f "$CLAVE_RESTIC" ] || { alerta "Las copias no están configuradas. Ejecuta: bash scripts/servidor.sh copias"; exit 1; }
  local id="${1:-}"
  if [ -z "$id" ]; then
    echo "Copias disponibles:"
    restic snapshots --compact
    echo
    echo "Para restaurar una: bash scripts/servidor.sh restaurar <ID>   (o 'latest' para la más reciente)"
    return 0
  fi

  # Variable global: la limpieza (trap) se ejecuta al salir del script, cuando las locales ya no existen.
  tmp="$(mktemp -d)"
  chmod 755 "$tmp"
  trap 'rm -rf "${tmp:-}"' EXIT
  restic dump "$id" /store.json > "$tmp/store.json" || { alerta "No he podido leer esa copia. ¿Es correcto el ID?"; exit 1; }
  [ -s "$tmp/store.json" ] || { alerta "La copia está vacía: no restauro nada."; exit 1; }
  chmod 644 "$tmp/store.json"

  echo "Esto SUSTITUIRÁ los datos actuales por los de la copia «${id}» ($(wc -c < "$tmp/store.json") bytes)."
  echo "Antes se guardará un respaldo de los datos actuales dentro del volumen (store.json.antes-de-restaurar)."
  local r
  read -r -p "Escribe SI para continuar: " r
  [ "$r" = "SI" ] || { echo "Cancelado: no he cambiado nada."; exit 0; }

  docker compose stop app
  docker compose run --rm --no-deps -v "$tmp:/restore:ro" --entrypoint sh app -c \
    'if [ -f /data/store.json ]; then cp /data/store.json /data/store.json.antes-de-restaurar; fi; cp /restore/store.json /data/store.json'
  docker compose up -d app
  echo "Restaurado. Comprueba que todo está bien con: bash scripts/servidor.sh informe"
}

actualizar() {
  # Evita que dos ejecuciones se pisen (por ejemplo, una a mano y otra de cron).
  exec 9>/tmp/econsultor-actualizar.lock
  flock -n 9 || exit 0
  git fetch -q origin
  local rama
  rama="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${rama}")" ]; then
    echo "$(date -Is) Hay cambios en origin/${rama}: actualizando"
    git pull -q --ff-only origin "${rama}"
    compose up -d --build
    docker image prune -f >/dev/null
    echo "$(date -Is) Listo: $(git log -1 --format='%h %s')"
  fi
}

actualizaciones() {
  local tarea="*/10 * * * * ${DIR}/scripts/servidor.sh actualizar >> ${HOME}/econsultor-actualizar.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'servidor.sh actualizar' || true; echo "$tarea" ) | crontab -
  echo "Programado: cada 10 minutos se comprobará GitHub. Registro en ${HOME}/econsultor-actualizar.log"
}

# Comprueba que el panel NO está en Funnel. Devuelve 0 = a salvo, 1 = expuesto, 2 = no se pudo comprobar.
panel_expuesto() {
  tailscale serve status --json 2>/dev/null | python3 -c '
import json, sys
try:
    c = json.load(sys.stdin)
except Exception:
    sys.exit(2)
publico = c.get("AllowFunnel") or {}
for hp, web in (c.get("Web") or {}).items():
    for h in (web.get("Handlers") or {}).values():
        if ":8788" in str(h.get("Proxy", "")) and publico.get(hp):
            sys.exit(1)
sys.exit(0)'
}

avisar_si_panel_expuesto() {
  [ -f "${DIR}/.env.panel" ] || return 0
  local r=0
  panel_expuesto || r=$?
  if [ "$r" -eq 1 ]; then
    alerta "El PANEL está abierto a internet. Ciérralo ya con: sudo tailscale serve --https=8443 off && bash scripts/servidor.sh panel"
  elif [ "$r" -eq 0 ]; then
    ok "El panel sigue siendo privado (solo tu red de Tailscale)."
  fi
}

publico() {
  echo "Abriendo la app a internet con Tailscale Funnel..."
  echo "Si es la primera vez, te mostrará un enlace para activar Funnel: ábrelo en el navegador y vuelve a ejecutar este comando."
  sudo tailscale funnel --bg "${PUERTO}"
  avisar_si_panel_expuesto
}

privado() {
  # Solo se cierra el puerto 443 (la app). El panel, en el 8443, no se toca.
  sudo tailscale funnel --https=443 off || true
  sudo tailscale serve --bg --https=443 "http://127.0.0.1:${PUERTO}"
  local estado_serve
  estado_serve="$(tailscale serve status 2>/dev/null || true)"
  if [[ "$estado_serve" == *'Funnel on'* ]]; then
    aviso "Algo sigue abierto a internet. Revisa: tailscale serve status"
  else
    echo "La app vuelve a ser accesible solo desde tu red de Tailscale."
  fi
  avisar_si_panel_expuesto
}

# ───────── cambio de nombre en Tailscale ─────────
# Tras renombrar el equipo o la red, las asignaciones de «serve»/«funnel» siguen atadas al nombre viejo y el
# nuevo no responde. Este comando las rehace, actualiza PUBLIC_ORIGIN y reinicia la app.
direccion() {
  command -v tailscale >/dev/null || { alerta "Tailscale no está instalado."; exit 1; }
  [ -f "${DIR}/.env" ] || { alerta "No encuentro el archivo .env en ${DIR}."; exit 1; }
  local dominio
  dominio="$(panel_url)"
  [ -n "$dominio" ] || { alerta "No pude leer la dirección de Tailscale. ¿Está conectado? Prueba: tailscale status"; exit 1; }
  echo "Dirección actual de este equipo: https://${dominio}"

  # ¿La app estaba abierta a internet? Se conserva ese estado.
  local publico=0 estado_serve
  estado_serve="$(tailscale serve status 2>/dev/null || true)"
  case "$estado_serve" in *'Funnel on'*) publico=1 ;; esac
  if [ "$publico" -eq 1 ]; then echo "La app estaba PÚBLICA (Funnel): se mantiene pública."
  else echo "La app estaba PRIVADA (solo tu red de Tailscale): se mantiene privada. Para abrirla: bash scripts/servidor.sh publico"; fi

  local antes
  antes="$(grep '^PUBLIC_ORIGIN=' "${DIR}/.env" | head -1 | cut -d= -f2- || true)"
  if [ "$antes" != "https://${dominio}" ]; then
    cp -p "${DIR}/.env" "${DIR}/.env.antes-de-direccion"
    chmod 600 "${DIR}/.env.antes-de-direccion"
    if grep -q '^PUBLIC_ORIGIN=' "${DIR}/.env"; then
      sed -i "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://${dominio}|" "${DIR}/.env"
    else
      printf '\nPUBLIC_ORIGIN=https://%s\n' "$dominio" >> "${DIR}/.env"
    fi
    echo "PUBLIC_ORIGIN actualizado (${antes:-vacío} → https://${dominio}). Copia del .env anterior: .env.antes-de-direccion"
  else
    ok "PUBLIC_ORIGIN ya tenía la dirección correcta."
  fi

  # Se rehacen las asignaciones con el nombre nuevo (por unos segundos la app no responde).
  sudo tailscale serve reset
  if [ "$publico" -eq 1 ]; then sudo tailscale funnel --bg "${PUERTO}"; else sudo tailscale serve --bg "${PUERTO}"; fi
  if [ -f "${DIR}/.env.panel" ]; then sudo tailscale serve --bg --https=8443 "http://127.0.0.1:8788"; fi
  if bg_instalado; then bg_exponer "$(env_leer "${BG_HOME}/.estado" EXPOSICION)"; fi

  compose up -d app

  echo "Comprobando https://${dominio} (la primera vez Tailscale prepara el certificado y puede tardar hasta 2 minutos)..."
  local i listo=0
  for i in $(seq 1 24); do
    if curl -fsS --max-time 8 "https://${dominio}/healthz" >/dev/null 2>&1; then listo=1; break; fi
    sleep 5
  done

  titulo "RESULTADO"
  if [ "$listo" -eq 1 ]; then ok "La app responde en https://${dominio}"
  else
    alerta "La app aún no responde en https://${dominio}. Espera un par de minutos y repite este comando."
    echo "Si sigue igual, pega aquí la salida de: tailscale serve status"
  fi
  if [ -f "${DIR}/.env.panel" ]; then echo "El panel está en: https://${dominio}:8443"; fi
  echo "Avisa a tus amigos de la dirección nueva: la antigua deja de funcionar."
  avisar_si_panel_expuesto
}

# ───────── panel personal ─────────
CRON_PANEL="* * * * * python3 ${DIR}/scripts/panel-recolector.py >/dev/null 2>>${DIR}/estado/recolector.log"

panel_url() {
  tailscale status --json 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))
except Exception:
    pass' || true
}

# Pone (o cambia) CLAVE=valor en un archivo de variables, sin tocar el resto.
env_poner() {
  local archivo="$1" clave="$2" valor="$3"
  touch "$archivo"
  if grep -q "^${clave}=" "$archivo"; then
    sed -i "s|^${clave}=.*|${clave}=${valor}|" "$archivo"
  else
    printf '%s=%s\n' "$clave" "$valor" >> "$archivo"
  fi
}
env_leer() { grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- || true; }

panel_clave_nueva() {
  local nueva ver="${1:-false}" perfiles psico
  perfiles="$(env_leer "${DIR}/.env.panel" PANEL_VER_PERFILES)"
  psico="$(env_leer "${DIR}/.env.panel" PANEL_VER_PSICO)"
  nueva="$(openssl rand -hex 16)"
  ( umask 077; printf 'PANEL_PASSWORD=%s\nPANEL_VER_IMPORTES=%s\nPANEL_VER_PERFILES=%s\nPANEL_VER_PSICO=%s\n' "$nueva" "$ver" "${perfiles:-false}" "${psico:-false}" > "${DIR}/.env.panel" )
  chmod 600 "${DIR}/.env.panel"
  echo "$nueva"
}

panel() {
  command -v python3 >/dev/null || { alerta "Falta python3 (sudo apt install python3)."; exit 1; }
  command -v openssl >/dev/null || { alerta "Falta openssl (sudo apt install openssl)."; exit 1; }
  mkdir -p "${DIR}/estado"; chmod 755 "${DIR}/estado"

  local clave=""
  if ! grep -q '^PANEL_PASSWORD=' "${DIR}/.env.panel" 2>/dev/null; then
    clave="$(panel_clave_nueva)"
  fi

  # El recolector usa Tailscale sin sudo si tu usuario es el «operador».
  sudo tailscale set --operator="$(id -un)" >/dev/null 2>&1 || aviso "No pude dar permiso a tu usuario sobre Tailscale; el panel no podrá mostrar esa parte."

  ( crontab -l 2>/dev/null | grep -v 'panel-recolector.py' || true; echo "$CRON_PANEL" ) | crontab -
  python3 "${DIR}/scripts/panel-recolector.py" || aviso "El recolector falló; mira ${DIR}/estado/recolector.log"

  echo "Construyendo y arrancando el panel (la primera vez tarda un par de minutos)..."
  compose up -d --build panel

  local i
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8788/healthz >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:8788/healthz >/dev/null 2>&1 || { alerta "El panel no arrancó. Mira: docker compose --profile panel logs panel"; exit 1; }

  # Solo dentro de tu red privada (Serve), en el puerto 8443. La app sigue en el 443.
  sudo tailscale serve --bg --https=8443 "http://127.0.0.1:8788"

  titulo "PANEL LISTO"
  local dominio
  dominio="$(panel_url)"
  [ -n "$dominio" ] && echo "Ábrelo desde cualquier dispositivo con Tailscale:  https://${dominio}:8443"
  if [ -n "$clave" ]; then
    echo
    echo "Contraseña del panel (guárdala en tu gestor de contraseñas; no se vuelve a mostrar sola):"
    echo "    ${clave}"
    echo "Si la pierdes: bash scripts/servidor.sh panel-clave"
  else
    echo "La contraseña es la que ya tenías. Para cambiarla: bash scripts/servidor.sh panel-clave"
  fi
  echo
  avisar_si_panel_expuesto
}

panel_clave() {
  [ -f "${DIR}/.env.panel" ] || { alerta "El panel aún no está instalado: bash scripts/servidor.sh panel"; exit 1; }
  local ver
  ver="$(grep '^PANEL_VER_IMPORTES=' "${DIR}/.env.panel" | cut -d= -f2 || true)"
  local nueva
  nueva="$(panel_clave_nueva "${ver:-false}")"
  compose up -d --force-recreate panel
  echo "Contraseña nueva del panel (las sesiones abiertas se cierran):"
  echo "    ${nueva}"
}

panel_parar() {
  ( crontab -l 2>/dev/null | grep -v 'panel-recolector.py' || true ) | crontab -
  compose rm -sf panel >/dev/null 2>&1 || true
  sudo tailscale serve --https=8443 off >/dev/null 2>&1 || true
  echo "Panel apagado y fuera de Tailscale. Tu contraseña y los datos recogidos siguen en ${DIR} (.env.panel y estado/)."
  echo "Para volver a encenderlo: bash scripts/servidor.sh panel"
}

# ───────── BareGlass (API) en este servidor ─────────
# Código en ~/proyectos/BareGlass (clon del repositorio), datos y claves en ~/proyectos/bareglass-datos.
# Puerto 10000 de Tailscale (uno de los tres que Funnel permite: 443 = EConsultor, 8443 = panel, 10000 = BareGlass).
BG_SRC="${BAREGLASS_SRC:-${HOME}/proyectos/BareGlass}"
BG_HOME="${BG_HOME:-${HOME}/proyectos/bareglass-datos}"
BG_REPO="${BAREGLASS_REPO:-https://github.com/bratneytg/BareGlass.git}"
BG_PUERTO_API=8100
export BAREGLASS_SRC="$BG_SRC" BG_HOME

bg_instalado() { [ -f "${BG_HOME}/.env" ]; }
bg_compose() { docker compose -f "${DIR}/proyectos/bareglass/docker-compose.yml" "$@"; }
bg_clave() { python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"; }

# privado = solo tus dispositivos (Serve) · publico = internet (Funnel).
bg_exponer() {
  local modo="${1:-privado}"
  if [ "$modo" = "publico" ]; then sudo tailscale funnel --bg --https=10000 "http://127.0.0.1:${BG_PUERTO_API}"
  else sudo tailscale funnel --https=10000 off >/dev/null 2>&1 || true; sudo tailscale serve --bg --https=10000 "http://127.0.0.1:${BG_PUERTO_API}"; fi
}

bg_esperar() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${BG_PUERTO_API}/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

bareglass() {
  local sub="${1:-estado}"
  case "$sub" in
    instalar)
      command -v docker >/dev/null || { alerta "Falta Docker."; exit 1; }
      command -v git >/dev/null || { alerta "Falta git."; exit 1; }
      command -v python3 >/dev/null || { alerta "Falta python3."; exit 1; }
      titulo "INSTALAR BAREGLASS"
      mkdir -p "$(dirname "$BG_SRC")"
      if [ -d "${BG_SRC}/.git" ]; then git -C "$BG_SRC" pull --ff-only; else git clone --depth 1 "$BG_REPO" "$BG_SRC"; fi
      [ -f "${BG_SRC}/backend/Dockerfile" ] || { alerta "No encuentro backend/Dockerfile en ${BG_SRC}. ¿Es el repositorio correcto?"; exit 1; }
      mkdir -p "${BG_HOME}/data"
      # El contenedor corre como usuario 1000 (sin privilegios): necesita poder escribir en la carpeta de datos.
      [ "$(id -u)" = "1000" ] || sudo chown 1000:1000 "${BG_HOME}/data"
      if [ ! -f "${BG_HOME}/.env" ]; then
        ( umask 077
          {
            echo "# Claves de BareGlass. NO las pierdas ni las compartas: sin BG_MASTER_KEY los datos de los usuarios no se pueden descifrar."
            echo "BG_MASTER_KEY=$(bg_clave)"
            echo "BG_JWT_SECRET=$(bg_clave)"
            echo "BG_WEBHOOK_SECRET=$(bg_clave)"
            echo "BG_CHECKOUT_URL="
          } > "${BG_HOME}/.env" )
        chmod 600 "${BG_HOME}/.env"
        ok "Claves creadas en ${BG_HOME}/.env"
        echo "    GUARDA YA una copia de BG_MASTER_KEY fuera del servidor (gestor de contraseñas). Si se pierde, los datos cifrados no se recuperan."
      else
        ok "Las claves ya existían: no las toco."
      fi
      [ -f "${BG_HOME}/.estado" ] || printf 'EXPOSICION=privado\n' > "${BG_HOME}/.estado"
      echo "Construyendo y arrancando (la primera vez tarda unos minutos)..."
      bg_compose up -d --build
      bg_esperar || { alerta "La API no responde. Mira: docker compose -f proyectos/bareglass/docker-compose.yml logs api"; exit 1; }
      bg_exponer "$(env_leer "${BG_HOME}/.estado" EXPOSICION)"
      bareglass estado ;;

    estado)
      bg_instalado || { echo "BareGlass no está instalado. Ejecuta: bash scripts/servidor.sh bareglass instalar"; return 0; }
      titulo "BAREGLASS"
      if curl -fsS "http://127.0.0.1:${BG_PUERTO_API}/healthz" >/dev/null 2>&1; then ok "La API responde."; else alerta "La API no responde."; fi
      local dominio modo; dominio="$(panel_url)"; modo="$(env_leer "${BG_HOME}/.estado" EXPOSICION)"
      if [ "${modo:-privado}" = "publico" ]; then aviso "ABIERTA A INTERNET: https://${dominio}:10000"; else ok "Privada (solo tus dispositivos con Tailscale): https://${dominio}:10000"; fi
      echo "Para que la app de Android use este servidor: GitHub → BareGlass → Settings → Variables → Actions → API_BASE = https://${dominio}:10000"
      if [ -n "$(env_leer "${BG_HOME}/.env" BG_CHECKOUT_URL)" ]; then ok "Pagos: URL de cobro configurada."; else aviso "Pagos: sin BG_CHECKOUT_URL (Premium no se puede cobrar todavía)."; fi
      if bg_compose ps --services --status running 2>/dev/null | grep -q litestream; then ok "Copia continua (Litestream) activa."; else aviso "Sin Litestream: la copia diaria de restic cubre la base de datos (bash scripts/servidor.sh copiar)."; fi ;;

    parar)
      bg_compose down
      sudo tailscale funnel --https=10000 off >/dev/null 2>&1 || true
      sudo tailscale serve --https=10000 off >/dev/null 2>&1 || true
      ok "BareGlass parado y fuera de Tailscale. Los datos siguen en ${BG_HOME}/data." ;;

    privado)
      bg_instalado || { alerta "BareGlass no está instalado."; exit 1; }
      env_poner "${BG_HOME}/.estado" EXPOSICION privado
      bg_exponer privado
      ok "BareGlass solo es accesible desde tus dispositivos con Tailscale." ;;

    publico)
      bg_instalado || { alerta "BareGlass no está instalado."; exit 1; }
      echo "ATENCIÓN: vas a abrir a INTERNET un servicio con contenido para adultos desde tu casa."
      echo "Antes de hacerlo revisa docs/07-legal-y-distribucion.md de BareGlass (verificación de edad en Alemania, RGPD, términos, pagos)."
      read -r -p "Escribe ABRIR para continuar: " r
      [ "$r" = "ABRIR" ] || { echo "Cancelado. No he cambiado nada."; exit 0; }
      env_poner "${BG_HOME}/.estado" EXPOSICION publico
      bg_exponer publico
      aviso "BareGlass abierta a internet en el puerto 10000. Para cerrarla: bash scripts/servidor.sh bareglass privado" ;;

    actualizar)
      bg_instalado || { alerta "BareGlass no está instalado."; exit 1; }
      git -C "$BG_SRC" pull --ff-only
      bg_compose up -d --build
      bg_esperar && ok "Actualizada y funcionando." || alerta "La API no responde tras actualizar." ;;

    *) echo "Uso: bash scripts/servidor.sh bareglass instalar|estado|parar|privado|publico|actualizar" ;;
  esac
}

# Qué hace el portátil al cerrar la tapa. Sin configurar, Ubuntu lo SUSPENDE y el servidor deja de responder.
tapa() {
  local dir="${LOGIND_DIR:-/etc/systemd/logind.conf.d}" fichero
  fichero="${dir}/econsultor-tapa.conf"
  local conf="${LOGIND_CONF:-/etc/systemd/logind.conf}"
  local claves="HandleLidSwitch HandleLidSwitchExternalPower HandleLidSwitchDocked"
  titulo "TAPA DEL PORTÁTIL"
  local k valor efectivo malo=0
  for k in $claves; do
    # El último valor gana: logind.conf y luego los .conf.d en orden alfabético.
    efectivo="$(cat "$conf" "$dir"/*.conf /usr/lib/systemd/logind.conf.d/*.conf 2>/dev/null | grep -E "^${k}=" | tail -1 | cut -d= -f2 || true)"
    valor="${efectivo:-(por defecto)}"
    case "$efectivo" in
      ignore|lock) echo "  ${k}: ${valor}  [OK]" ;;
      *) echo "  ${k}: ${valor}  [SUSPENDE]"; malo=1 ;;
    esac
  done
  if [ "$malo" -eq 0 ]; then
    ok "Cerrar la tapa no suspende el servidor."
    return 0
  fi
  aviso "Si cierras la tapa, el portátil se suspenderá y la app dejará de responder."
  if [ "${1:-}" != "arreglar" ]; then
    echo "Para arreglarlo:  bash scripts/servidor.sh tapa arreglar"
    return 0
  fi
  sudo mkdir -p "$dir"
  printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' | sudo tee "$fichero" >/dev/null
  # HUP recarga la configuración sin reiniciar logind (reiniciarlo puede cerrarte la sesión SSH).
  sudo systemctl kill -s HUP systemd-logind 2>/dev/null || aviso "No pude recargar logind: reinicia el portátil una vez (sudo reboot)."
  ok "Hecho: con la tapa cerrada el servidor sigue funcionando (${fichero})."
  echo "Comprobación recomendada: cierra la tapa, espera 1 minuto y abre https://TU-DIRECCIÓN desde el móvil con datos."
  echo "Consejo: con la tapa cerrada el portátil se calienta más; déjalo ventilado y sobre una superficie dura."
}

# base64url sin relleno, como pide Web Push.
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

vapid_generar() {
  local tmp; tmp="$(mktemp -d)"; chmod 700 "$tmp"
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/k.pem" 2>/dev/null
  VAPID_PRIVADA="$(openssl ec -in "$tmp/k.pem" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
  VAPID_PUBLICA="$(openssl ec -in "$tmp/k.pem" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"
  rm -rf "$tmp"
  [ "${#VAPID_PRIVADA}" -eq 43 ] && [ "${#VAPID_PUBLICA}" -eq 87 ] || { alerta "No pude generar las claves de avisos (openssl)."; exit 1; }
}

activar() {
  command -v openssl >/dev/null || { alerta "Falta openssl (sudo apt install openssl)."; exit 1; }
  [ -f "${DIR}/.env" ] || { alerta "No encuentro el archivo .env en ${DIR}."; exit 1; }
  titulo "ACTIVAR TODAS LAS FUNCIONES"
  cp -p "${DIR}/.env" "${DIR}/.env.antes-de-activar"; chmod 600 "${DIR}/.env.antes-de-activar"

  env_poner "${DIR}/.env" PREMIUM_FOR_ALL true
  ok "Premium para todas las cuentas (consejos completos e IA) mientras no haya cobro."
  env_poner "${DIR}/.env" ALLOW_DEMO_DATA false
  ok "Cuenta de pruebas «admin» desactivada (la dejo así a propósito: es insegura)."

  if [ -z "$(env_leer "${DIR}/.env" VAPID_PUBLIC_KEY)" ] || [ -z "$(env_leer "${DIR}/.env" VAPID_PRIVATE_KEY)" ]; then
    vapid_generar
    env_poner "${DIR}/.env" VAPID_PUBLIC_KEY "$VAPID_PUBLICA"
    env_poner "${DIR}/.env" VAPID_PRIVATE_KEY "$VAPID_PRIVADA"
    ok "Claves de avisos push creadas y guardadas en .env."
  else
    ok "Las claves de avisos push ya existían: no las toco (cambiarlas desconectaría los dispositivos ya suscritos)."
  fi
  local origen; origen="$(env_leer "${DIR}/.env" PUBLIC_ORIGIN)"
  if [ -z "$(env_leer "${DIR}/.env" VAPID_SUBJECT)" ] && [ -n "$origen" ]; then env_poner "${DIR}/.env" VAPID_SUBJECT "$origen"; fi

  if [ -z "$(env_leer "${DIR}/.env" APK_URL)" ]; then
    local remoto repo
    remoto="$(git -C "$DIR" remote get-url origin 2>/dev/null || true)"
    repo="$(echo "$remoto" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
    if echo "$repo" | grep -qE '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
      env_poner "${DIR}/.env" APK_URL "https://github.com/${repo}/releases/download/android-latest/econsultor.apk"
      ok "Enlace de descarga de la app de Android puesto (${repo})."
    fi
  fi

  echo "Reiniciando la app..."
  compose up -d app
  local i
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1 || { alerta "La app no arrancó. Mira: docker compose logs app"; exit 1; }

  titulo "ESTADO"
  local cfg; cfg="$(curl -fsS http://127.0.0.1:8787/api/config 2>/dev/null || true)"
  if echo "$cfg" | grep -q '"ai":true'; then ok "IA activa."; else aviso "La IA NO está activa: falta ANTHROPIC_API_KEY en ${DIR}/.env (añádela tú; no la pegues en el chat)."; fi
  if curl -fsS http://127.0.0.1:8787/api/notifications/config 2>/dev/null | grep -q '"publicKey":"'; then ok "Avisos push activos."; else aviso "Los avisos push no quedaron activos."; fi
  if echo "$cfg" | grep -q '"googleClientId":"'; then ok "Entrar con Google activo."; else aviso "Entrar con Google no está configurado (necesita GOOGLE_CLIENT_ID; ver README)."; fi
  if echo "$cfg" | grep -q '"apkUrl":"'; then ok "Enlace de la app de Android puesto."; else aviso "Sin enlace de la app de Android todavía: bash scripts/servidor.sh apk <URL del APK>"; fi
}

perfiles() {
  [ -f "${DIR}/.env.panel" ] || { alerta "El panel aún no está instalado: bash scripts/servidor.sh panel"; exit 1; }
  case "${1:-estado}" in
    on)
      echo "Vas a activar los PERFILES FINANCIEROS en el panel: verás, por cada persona, su nivel de ahorro,"
      echo "tendencia, categorías principales y previsión (con importes)."
      echo "Es información personal: avisa a quien use la app (política de privacidad / aviso) y úsalo solo para administrar el servicio."
      read -r -p "Escribe SI para activarlo: " r
      [ "$r" = "SI" ] || { echo "Cancelado. No he cambiado nada."; exit 0; }
      env_poner "${DIR}/.env.panel" PANEL_VER_PERFILES true
      compose up -d --force-recreate panel
      ok "Pestaña «Perfiles» activada en el panel." ;;
    off)
      env_poner "${DIR}/.env.panel" PANEL_VER_PERFILES false
      compose up -d --force-recreate panel
      ok "Pestaña «Perfiles» desactivada." ;;
    *)
      if [ "$(env_leer "${DIR}/.env.panel" PANEL_VER_PERFILES)" = "true" ]; then echo "Perfiles: ACTIVADOS"; else echo "Perfiles: desactivados (bash scripts/servidor.sh perfiles on)"; fi ;;
  esac
}

psico() {
  [ -f "${DIR}/.env.panel" ] || { alerta "El panel aún no está instalado: bash scripts/servidor.sh panel"; exit 1; }
  case "${1:-estado}" in
    on)
      echo "Vas a activar la EVALUACIÓN PSICO-ECONÓMICA en el panel (dentro de «Perfiles»): una lectura de conducta de"
      echo "cada persona a partir de lo que ingresa y gasta. Es una hipótesis, no un diagnóstico, y es información muy personal."
      echo "Solo se ve en el panel (nunca en la app ni por la API) y no se envía a ningún tercero."
      echo "Avisa a las personas afectadas (RGPD: transparencia) y úsala solo con quien te haya dado su confianza."
      read -r -p "Escribe SI para activarla: " r
      [ "$r" = "SI" ] || { echo "Cancelado. No he cambiado nada."; exit 0; }
      env_poner "${DIR}/.env.panel" PANEL_VER_PERFILES true
      env_poner "${DIR}/.env.panel" PANEL_VER_PSICO true
      compose up -d --force-recreate panel
      ok "Evaluación psico-económica activada (pestaña «Perfiles»)." ;;
    off)
      env_poner "${DIR}/.env.panel" PANEL_VER_PSICO false
      compose up -d --force-recreate panel
      ok "Evaluación psico-económica desactivada." ;;
    *)
      if [ "$(env_leer "${DIR}/.env.panel" PANEL_VER_PSICO)" = "true" ]; then echo "Psico: ACTIVADA"; else echo "Psico: desactivada (bash scripts/servidor.sh psico on)"; fi ;;
  esac
}

apk() {
  local url="${1:-}"
  [ -n "$url" ] || { echo "Uso: bash scripts/servidor.sh apk https://…/econsultor.apk"; exit 1; }
  case "$url" in https://*) ;; *) alerta "El enlace debe empezar por https://"; exit 1 ;; esac
  env_poner "${DIR}/.env" APK_URL "$url"
  compose up -d app
  ok "Enlace puesto. Aparecerá en Ajustes y en Ayuda."
}

case "${1:-ayuda}" in
  informe) informe ;;
  actividad) actividad "${2:-7}" ;;
  copias) copias ;;
  copiar) copiar ;;
  restaurar) restaurar "${2:-}" ;;
  estado) estado ;;
  actualizar) actualizar ;;
  actualizaciones) actualizaciones ;;
  publico) publico ;;
  privado) privado ;;
  direccion) direccion ;;
  panel) panel ;;
  panel-clave) panel_clave ;;
  panel-parar) panel_parar ;;
  activar) activar ;;
  perfiles) perfiles "${2:-estado}" ;;
  psico) psico "${2:-estado}" ;;
  apk) apk "${2:-}" ;;
  tapa) tapa "${2:-}" ;;
  bareglass) bareglass "${2:-estado}" ;;
  *) sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
