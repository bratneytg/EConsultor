import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { Card } from '../components/ui';
import { ARTICULOS, TEMAS, buscar, type Articulo } from '../content/ayuda';
import { useAppConfig } from '../lib/queries';
import { isAndroidApp } from '../lib/native';

function Cuerpo({ a }: { a: Articulo }) {
  const bloques: React.ReactNode[] = [];
  let items: string[] = [];
  const cierraLista = () => {
    if (items.length) bloques.push(<ul key={`u${bloques.length}`} className="help-list">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>);
    items = [];
  };
  for (const linea of a.texto) {
    if (linea.startsWith('- ')) items.push(linea.slice(2));
    else { cierraLista(); bloques.push(<p key={`p${bloques.length}`}>{linea}</p>); }
  }
  cierraLista();
  return <>{bloques}</>;
}

export function Help() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [tema, setTema] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(params.get('a'));
  const { openReport } = useShell();
  const { data: cfg } = useAppConfig();
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const lista = useMemo(() => buscar(q).filter((a) => !tema || a.tema === tema), [q, tema]);

  // Al llegar con ?a=id se abre y se muestra ese artículo.
  useEffect(() => {
    const id = params.get('a');
    if (id) { setAbierto(id); setTimeout(() => refs.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); }
  }, [params]);

  const alternar = (id: string) => {
    const nuevo = abierto === id ? null : id;
    setAbierto(nuevo);
    const p = new URLSearchParams(params);
    if (nuevo) p.set('a', nuevo); else p.delete('a');
    setParams(p, { replace: true });
  };

  return (
    <div>
      <header className="page-head"><h1>Ayuda</h1></header>
      <div className="stack">
        <div className="help-search">
          <Icon name="search" size={18} />
          <input
            type="search" className="input" aria-label="Buscar en la ayuda" placeholder="Busca: extracto, racha, recordatorio, 2FA…"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="help-topics" role="group" aria-label="Temas">
          <button className="chip-btn" aria-pressed={!tema} onClick={() => setTema(null)}>Todo</button>
          {TEMAS.map((t) => <button key={t} className="chip-btn" aria-pressed={tema === t} onClick={() => setTema(tema === t ? null : t)}>{t}</button>)}
        </div>

        {lista.length === 0 ? (
          <Card>
            <div className="empty">
              <h3>No hemos encontrado «{q}»</h3>
              <p>Prueba con otra palabra, o cuéntanos qué te falta y lo añadimos.</p>
              <button className="btn" onClick={openReport}><Icon name="bug" size={18} />Contárnoslo</button>
            </div>
          </Card>
        ) : (
          <div className="help-list-wrap">
            {lista.map((a) => {
              const abiertoAhora = abierto === a.id || (q.trim().length > 1 && lista.length <= 2);
              return (
                <article key={a.id} id={a.id} ref={(el) => { refs.current[a.id] = el; }} className="help-item">
                  <button className="help-q" aria-expanded={abiertoAhora} aria-controls={`${a.id}-c`} onClick={() => alternar(a.id)}>
                    <span>
                      <b>{a.titulo}</b>
                      <small>{a.tema}</small>
                    </span>
                    <Icon name="right" size={18} className={abiertoAhora ? 'turn' : ''} />
                  </button>
                  {abiertoAhora && (
                    <div className="help-a" id={`${a.id}-c`}>
                      <p className="help-resumen">{a.resumen}</p>
                      <Cuerpo a={a} />
                      {a.id === 'app-android' && cfg?.apkUrl && !isAndroidApp() && (
                        <p><a className="btn btn-primary" href={cfg.apkUrl}><Icon name="phone" size={18} />Descargar para Android</a></p>
                      )}
                      {a.accion && <p><Link className="btn" to={a.accion.to}>{a.accion.etiqueta}</Link></p>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="hint" style={{ textAlign: 'center' }}>
          ¿No encuentras lo que buscas? <button className="link-btn" onClick={openReport}>Cuéntanoslo</button>
          {' · '}{ARTICULOS.length} artículos
        </p>
      </div>
    </div>
  );
}
