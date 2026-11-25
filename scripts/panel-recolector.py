#!/usr/bin/env python3
"""Recolector de datos del servidor para el panel personal de EConsultor.

Se ejecuta EN EL SERVIDOR (cada minuto, con cron) y escribe dos archivos de solo datos:

  estado/host.json        Foto actual: sistema, disco, memoria, contenedores, red, copias...
  estado/historial.jsonl  Una línea por minuto (últimos 7 días) para dibujar los gráficos

No abre puertos, no recibe órdenes y no modifica nada fuera de la carpeta `estado/`.
El panel (contenedor aparte) monta esa carpeta en solo lectura.
"""
from __future__ import annotations

import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("ESTADO_DIR", BASE / "estado"))
HOME = Path.home()
REPO_COPIAS = os.environ.get("REPO_COPIAS", str(HOME / "backups"))
CLAVE_RESTIC = os.environ.get("CLAVE_RESTIC", str(HOME / ".config/econsultor/restic-pass"))
PUERTO_APP = int(os.environ.get("PUERTO_APP", "8787"))
PUERTO_PANEL = int(os.environ.get("PUERTO_PANEL", "8788"))
LENTO_CADA = 15 * 60          # restic y apt se consultan como mucho cada 15 min
HISTORIAL_MAX = 10_080        # 7 días a 1 punto por minuto
ENV = {**os.environ, "LC_ALL": "C", "LANG": "C"}


def run(cmd: list[str], timeout: int = 15, cwd: Path | None = None, env: dict | None = None) -> str:
    r = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd or BASE, env=env or ENV, check=False
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or f"código {r.returncode}").strip()[:300])
    return r.stdout


def seguro(fn, *args):
    """Una sección que falla no tumba el resto: devuelve {"error": ...}."""
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001 - queremos capturar todo para no perder el resto del informe
        return {"error": f"{type(e).__name__}: {e}"[:300]}


def leer(path: str, defecto: str = "") -> str:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return defecto


# ───────── sistema ─────────
def sistema() -> dict:
    os_rel = {}
    for linea in leer("/etc/os-release").splitlines():
        if "=" in linea:
            k, v = linea.split("=", 1)
            os_rel[k] = v.strip('"')
    cpu_modelo = ""
    for linea in leer("/proc/cpuinfo").splitlines():
        if linea.startswith("model name"):
            cpu_modelo = linea.split(":", 1)[1].strip()
            break
    return {
        "nombre": socket.gethostname(),
        "so": os_rel.get("PRETTY_NAME", "desconocido"),
        "nucleo": platform.release(),
        "cpu_modelo": cpu_modelo,
        "cpus": os.cpu_count() or 1,
        "encendido_s": int(float(leer("/proc/uptime", "0 0").split()[0])),
        "reinicio_pendiente": Path("/var/run/reboot-required").exists(),
    }


def cpu() -> dict:
    def muestra() -> tuple[int, int]:
        partes = [int(x) for x in leer("/proc/stat").splitlines()[0].split()[1:]]
        return sum(partes), partes[3] + (partes[4] if len(partes) > 4 else 0)

    t1, i1 = muestra()
    time.sleep(1)
    t2, i2 = muestra()
    uso = 100 * (1 - (i2 - i1) / max(1, t2 - t1))
    carga = [float(x) for x in leer("/proc/loadavg", "0 0 0").split()[:3]]
    return {"uso_pct": round(uso, 1), "carga": carga}


def memoria() -> dict:
    m: dict[str, int] = {}
    for linea in leer("/proc/meminfo").splitlines():
        k, _, v = linea.partition(":")
        m[k] = int(v.split()[0]) * 1024 if v.strip() else 0
    total, disp = m.get("MemTotal", 0), m.get("MemAvailable", 0)
    return {
        "total": total,
        "disponible": disp,
        "usada_pct": round(100 * (total - disp) / total, 1) if total else 0,
        "swap_total": m.get("SwapTotal", 0),
        "swap_usada": m.get("SwapTotal", 0) - m.get("SwapFree", 0),
    }


def discos() -> list[dict]:
    salida = run(["df", "-B1", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs", "-x", "overlay", "-x", "efivarfs",
                  "--output=target,size,used,pcent"])
    res = []
    for linea in salida.splitlines()[1:]:
        p = linea.split()
        if len(p) != 4 or p[0].startswith(("/var/lib/docker", "/snap")):
            continue
        res.append({"montaje": p[0], "total": int(p[1]), "usado": int(p[2]), "pct": int(p[3].rstrip("%") or 0)})
    return res


def temperaturas() -> list[dict]:
    res: dict[str, float] = {}
    for zona in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
        try:
            res.setdefault(leer(str(zona / "type"), zona.name), int(leer(str(zona / "temp"))) / 1000)
        except ValueError:
            pass
    for hw in sorted(Path("/sys/class/hwmon").glob("hwmon*")):
        nombre = leer(str(hw / "name"), hw.name)
        for t in sorted(hw.glob("temp*_input")):
            try:
                res.setdefault(f"{nombre} {t.name.split('_')[0]}", int(leer(str(t))) / 1000)
            except ValueError:
                pass
    return [{"nombre": k, "c": round(v, 1)} for k, v in res.items() if 0 < v < 150]


def bateria() -> dict | None:
    for b in sorted(Path("/sys/class/power_supply").glob("BAT*")):
        try:
            return {"pct": int(leer(str(b / "capacity"))), "estado": leer(str(b / "status"), "desconocido")}
        except ValueError:
            continue
    return None


def red() -> dict:
    interfaces = []
    for linea in leer("/proc/net/dev").splitlines()[2:]:
        nombre, _, datos = linea.partition(":")
        nombre = nombre.strip()
        if nombre == "lo" or nombre.startswith(("docker", "veth", "br-")):
            continue
        c = datos.split()
        interfaces.append({"nombre": nombre, "rx": int(c[0]), "tx": int(c[8])})
    ips = []
    try:
        for linea in run(["ip", "-4", "-o", "addr", "show", "scope", "global"]).splitlines():
            p = linea.split()
            if not p[1].startswith(("docker", "br-", "veth")):
                ips.append({"interfaz": p[1], "ip": p[3].split("/")[0]})
    except Exception:  # noqa: BLE001
        pass
    return {"interfaces": interfaces, "ips": ips}


def puertos() -> list[dict]:
    res = []
    for linea in run(["ss", "-tlnpH"]).splitlines():
        p = linea.split()
        if len(p) < 4:
            continue
        local = p[3]
        direccion, _, puerto = local.rpartition(":")
        direccion = direccion.strip("[]")
        proc = re.search(r'\(\("([^"]+)"', linea)
        res.append({
            "direccion": direccion,
            "puerto": int(puerto),
            "proceso": proc.group(1) if proc else "",
            "abierto_a_la_red": direccion not in ("127.0.0.1", "::1") and not direccion.startswith("127."),
        })
    unicos = {(r["direccion"], r["puerto"]): r for r in res}
    return sorted(unicos.values(), key=lambda r: (not r["abierto_a_la_red"], r["puerto"]))


def accesos_ssh() -> list[str]:
    salida = run(["last", "-n", "12", "-F", "-w"])
    return [l[:140] for l in salida.splitlines() if l.strip() and not l.startswith(("wtmp", "btmp"))][:12]


# ───────── docker y la app ─────────
def unidades(texto: str) -> int:
    m = re.match(r"([\d.]+)\s*([KMGT]?i?B)", texto.strip())
    if not m:
        return 0
    mult = {"B": 1, "KB": 1e3, "KIB": 1024, "MB": 1e6, "MIB": 1024**2, "GB": 1e9, "GIB": 1024**3}
    return int(float(m.group(1)) * mult.get(m.group(2).upper(), 1))


def docker() -> dict:
    version = run(["docker", "version", "--format", "{{.Server.Version}}"]).strip()
    crudo = run(["docker", "ps", "-a", "--format", "{{json .}}"])
    stats = {}
    try:
        for linea in run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], timeout=30).splitlines():
            d = json.loads(linea)
            usado, _, limite = d["MemUsage"].partition("/")
            stats[d["Name"]] = {
                "cpu_pct": float(d["CPUPerc"].rstrip("%") or 0),
                "mem": unidades(usado),
                "mem_limite": unidades(limite),
            }
    except Exception:  # noqa: BLE001
        pass
    contenedores = []
    for linea in crudo.splitlines():
        d = json.loads(linea)
        nombre = d["Names"]
        if "econsultor" not in nombre.lower() and "caddy" not in nombre.lower():
            continue
        info = {"nombre": nombre, "imagen": d["Image"], "estado": d["State"], "detalle": d["Status"]}
        try:
            insp = json.loads(run(["docker", "inspect", nombre]))[0]
            info["reinicios"] = insp["RestartCount"]
            info["iniciado"] = insp["State"]["StartedAt"]
            info["salud"] = insp["State"].get("Health", {}).get("Status", "sin comprobación")
            info["servicio"] = insp["Config"]["Labels"].get("com.docker.compose.service", nombre)
        except Exception:  # noqa: BLE001
            pass
        info.update(stats.get(nombre, {}))
        r = subprocess.run(["docker", "logs", "--tail", "250", "--timestamps", nombre], capture_output=True,
                           text=True, timeout=20, check=False, env=ENV)
        lineas = (r.stdout + r.stderr).splitlines()[-250:]
        info["registro"] = [l[:400] for l in lineas]
        contenedores.append(info)
    return {"version": version, "contenedores": contenedores}


def app() -> dict:
    t0 = time.time()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PUERTO_APP}/healthz", timeout=4) as r:
            cuerpo = r.read(200).decode("utf8", "replace")
            return {"ok": r.status == 200, "ms": int((time.time() - t0) * 1000), "respuesta": cuerpo}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "ms": int((time.time() - t0) * 1000), "error": str(e)[:200]}


def base_datos_archivo() -> dict | None:
    salida = run(["docker", "compose", "exec", "-T", "app", "stat", "-c", "%s %Y", "/data/store.json"], timeout=15)
    tam, mod = salida.split()
    return {"bytes": int(tam), "modificado": int(mod)}


def git() -> dict:
    rama = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).strip()
    commit, asunto, fecha = run(["git", "log", "-1", "--format=%h%x1f%s%x1f%cI"]).strip().split("\x1f")
    try:
        detras = int(run(["git", "rev-list", "--count", f"HEAD..origin/{rama}"]).strip())
    except Exception:  # noqa: BLE001
        detras = None
    cambios = len([l for l in run(["git", "status", "--porcelain"]).splitlines() if not l.startswith("??")])
    return {"rama": rama, "commit": commit, "asunto": asunto, "fecha": fecha, "detras": detras,
            "cambios_locales": cambios}


def actualizaciones_log() -> list[str]:
    texto = leer(str(HOME / "econsultor-actualizar.log"))
    return [l[:300] for l in texto.splitlines()[-12:]]


# ───────── tailscale ─────────
def tailscale() -> dict:
    estado = json.loads(run(["tailscale", "status", "--json"]))
    yo = estado.get("Self", {})
    pares = []
    for p in (estado.get("Peer") or {}).values():
        pares.append({"nombre": p.get("HostName"), "conectado": bool(p.get("Online")), "so": p.get("OS"),
                      "visto": p.get("LastSeen"), "ip": (p.get("TailscaleIPs") or [""])[0]})
    serve = []
    try:
        cfg = json.loads(run(["tailscale", "serve", "status", "--json"]))
        publico = cfg.get("AllowFunnel") or {}
        for hostport, web in (cfg.get("Web") or {}).items():
            puerto = int(hostport.rsplit(":", 1)[1])
            for ruta, h in (web.get("Handlers") or {}).items():
                serve.append({"puerto": puerto, "ruta": ruta, "destino": h.get("Proxy") or h.get("Path") or "?",
                              "publico": bool(publico.get(hostport))})
    except Exception as e:  # noqa: BLE001
        serve = [{"error": str(e)[:200]}]
    return {
        "estado": estado.get("BackendState"),
        "nombre": yo.get("HostName"),
        "dominio": (yo.get("DNSName") or "").rstrip("."),
        "ips": yo.get("TailscaleIPs") or [],
        "conectado": bool(yo.get("Online")),
        "avisos": estado.get("Health") or [],
        "pares": pares,
        "serve": serve,
    }


# ───────── tareas lentas: copias y actualizaciones del sistema ─────────
def copias() -> dict:
    res: dict = {"repo": REPO_COPIAS, "restic": False, "instantaneas": []}
    try:
        run(["restic", "version"])
        res["restic"] = True
    except Exception:  # noqa: BLE001
        res["error"] = "restic no está instalado (ejecuta: bash scripts/servidor.sh copias)"
        return res
    if not Path(CLAVE_RESTIC).exists():
        res["error"] = "las copias todavía no están configuradas (bash scripts/servidor.sh copias)"
        return res
    env = {**ENV, "RESTIC_REPOSITORY": REPO_COPIAS, "RESTIC_PASSWORD_FILE": CLAVE_RESTIC}
    snaps = json.loads(run(["restic", "snapshots", "--json"], timeout=60, env=env))
    res["instantaneas"] = [
        {"id": s["short_id"], "fecha": s["time"], "equipo": s.get("hostname"), "rutas": s.get("paths", [])}
        for s in sorted(snaps, key=lambda s: s["time"], reverse=True)[:40]
    ]
    try:
        res["repo_bytes"] = int(run(["du", "-sb", REPO_COPIAS], timeout=30).split()[0])
    except Exception:  # noqa: BLE001
        pass
    return res


def apt() -> dict:
    pendientes = [l for l in run(["apt", "list", "--upgradable"], timeout=40).splitlines() if "upgradable" in l]
    return {"pendientes": len(pendientes), "seguridad": len([l for l in pendientes if "-security" in l])}


def cron() -> list[str]:
    try:
        return [l[:220] for l in run(["crontab", "-l"]).splitlines() if l.strip() and not l.startswith("#")]
    except Exception:  # noqa: BLE001
        return []


# ───────── principal ─────────
def escribir_atomico(ruta: Path, texto: str) -> None:
    tmp = ruta.with_suffix(ruta.suffix + ".tmp")
    tmp.write_text(texto)
    os.chmod(tmp, 0o644)
    os.replace(tmp, ruta)


def main() -> int:
    inicio = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    os.chmod(OUT, 0o755)
    previo: dict = {}
    try:
        previo = json.loads((OUT / "host.json").read_text())
    except (OSError, ValueError):
        pass

    lento = previo.get("lento") or {}
    if inicio - lento.get("t", 0) > LENTO_CADA:
        lento = {"t": int(inicio), "copias": seguro(copias), "apt": seguro(apt)}

    datos = {
        "version": 1,
        "t": int(inicio),
        "sistema": seguro(sistema),
        "cpu": seguro(cpu),
        "memoria": seguro(memoria),
        "discos": seguro(discos),
        "temperaturas": seguro(temperaturas),
        "bateria": seguro(bateria),
        "red": seguro(red),
        "puertos": seguro(puertos),
        "accesos_ssh": seguro(accesos_ssh),
        "docker": seguro(docker),
        "app": seguro(app),
        "base_archivo": seguro(base_datos_archivo),
        "git": seguro(git),
        "tailscale": seguro(tailscale),
        "cron": seguro(cron),
        "actualizaciones_log": seguro(actualizaciones_log),
        "puerto_app": PUERTO_APP,
        "puerto_panel": PUERTO_PANEL,
        "lento": lento,
    }
    datos["segundos"] = round(time.time() - inicio, 1)
    errores = [k for k, v in datos.items() if isinstance(v, dict) and "error" in v]
    datos["errores"] = errores
    escribir_atomico(OUT / "host.json", json.dumps(datos, ensure_ascii=False))

    # Historial: una línea por ejecución, máximo 7 días.
    def num(d, *ruta, defecto=None):
        for k in ruta:
            if not isinstance(d, (dict, list)):
                return defecto
            try:
                d = d[k]
            except (KeyError, IndexError, TypeError):
                return defecto
        return d

    raiz = next((d for d in (datos["discos"] if isinstance(datos["discos"], list) else []) if d["montaje"] == "/"), None)
    temps = [t["c"] for t in datos["temperaturas"]] if isinstance(datos["temperaturas"], list) else []
    ifaces = num(datos, "red", "interfaces", defecto=[]) or []
    fila = {
        "t": int(inicio),
        "carga": num(datos, "cpu", "carga", 0),
        "cpu": num(datos, "cpu", "uso_pct"),
        "mem": num(datos, "memoria", "usada_pct"),
        "disco": raiz["pct"] if raiz else None,
        "temp": max(temps) if temps else None,
        "app": 1 if num(datos, "app", "ok") else 0,
        "ms": num(datos, "app", "ms"),
        "db": num(datos, "base_archivo", "bytes"),
        "rx": sum(i["rx"] for i in ifaces),
        "tx": sum(i["tx"] for i in ifaces),
    }
    ruta_h = OUT / "historial.jsonl"
    lineas: list[str] = []
    try:
        lineas = ruta_h.read_text().splitlines()
    except OSError:
        pass
    lineas.append(json.dumps(fila))
    escribir_atomico(ruta_h, "\n".join(lineas[-HISTORIAL_MAX:]) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"{datetime.now(timezone.utc).isoformat()} recolector: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
