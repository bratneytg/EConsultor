import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkError, recoverAndReload } from '../lib/recover';
import { t } from '../lib/i18n';

interface Props { children: ReactNode; /** Cambia (p. ej. la ruta) para volver a intentarlo. */ resetKey?: string }
interface State { error: Error | null }

/** Evita que un fallo en una pantalla deje toda la app en blanco: enseña un aviso y deja recargar. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Pantalla caída', error, info.componentStack);
    if (isChunkError(error)) void recoverAndReload();
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card" role="alert" style={{ margin: '24px auto', maxWidth: 520, textAlign: 'center' }}>
        <h2 className="card-title">{t('Esta pantalla ha fallado')}</h2>
        <p className="sub">{t('Puede ser una actualización a medias. Recarga la app y vuelve a intentarlo.')}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '14px 0' }}>
          <button className="btn primary" onClick={() => { void recoverAndReload(true); }}>{t('Recargar')}</button>
          <a className="btn" href="/">{t('Ir al inicio')}</a>
        </div>
        <details style={{ textAlign: 'left' }}>
          <summary className="hint">{t('Detalles técnicos')}</summary>
          <pre className="hint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error.name}: {error.message}</pre>
        </details>
      </div>
    );
  }
}
