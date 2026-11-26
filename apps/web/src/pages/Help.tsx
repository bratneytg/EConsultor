import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { Card } from '../components/ui';
import { TEMAS, articulosEn, buscar, type Articulo } from '../content/ayuda';
import { useAppConfig } from '../lib/queries';
import { isAndroidApp } from '../lib/native';
import { t, useI18n } from '../lib/i18n';

function Cuerpo({ a }: { a: Articulo }) {
  const bloques: React.ReactNode[] = [];
  let items: string[] = [];
  const cierraLista = () => {
    if (items.length) bloques.push(<ul key={`u${bloques.length}`} className="help-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>);
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
  const { lang } = useI18n();
  const todos = useMemo(() => articulosEn(lang), [lang]);

  const lista = useMemo(() => buscar(q, todos).filter((a) => !tema || a.tema === tema), [q, tema, todos]);

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
      <header className="page-head"><h1>{t('Ayuda')}</h1></header>
      <div className="stack">
        <div className="help-search">
          <Icon name="search" size={18} />
          <input
            type="search" className="input" aria-label={t('Buscar en la ayuda')} placeholder={t('Busca: extracto, racha, recordatorio, 2FA…')}
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="help-topics" role="group" aria-label={t('Temas')}>
          <button className="chip-btn" aria-pressed={!tema} onClick={() => setTema(null)}>{t('Todo')}</button>
          {TEMAS.map((x) => <button key={x} className="chip-btn" aria-pressed={tema === x} onClick={() => setTema(tema === x ? null : x)}>{t(x)}</button>)}
        </div>

        {lista.length === 0 ? (
          <Card>
            <div className="empty">
              <h3>{t('No hemos encontrado «{q}»', { q })}</h3>
              <p>{t('Prueba con otra palabra, o cuéntanos qué te falta y lo añadimos.')}</p>
              <button className="btn" onClick={openReport}><Icon name="bug" size={18} />{t('Cuéntanoslo')}</button>
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
                      <small>{t(a.tema)}</small>
                    </span>
                    <Icon name="right" size={18} className={abiertoAhora ? 'turn' : ''} />
                  </button>
                  {abiertoAhora && (
                    <div className="help-a" id={`${a.id}-c`}>
                      <p className="help-resumen">{a.resumen}</p>
                      <Cuerpo a={a} />
                      {a.id === 'app-android' && cfg?.apkUrl && !isAndroidApp() && (
                        <p><a className="btn btn-primary" href={cfg.apkUrl}><Icon name="phone" size={18} />{t('Descargar para Android')}</a></p>
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
          {t('¿No encuentras lo que buscas?')} <button className="link-btn" onClick={openReport}>{t('Cuéntanoslo')}</button>
          {' · '}{t('{n} artículos', { n: todos.length })}
        </p>
      </div>
    </div>
  );
}
