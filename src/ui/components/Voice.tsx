import { useEffect, useState, useSyncExternalStore } from 'react';
import { asr, type ModelState } from '../../mistakes/voice/asr';

export function useModelState(): ModelState {
  return useSyncExternalStore((fn) => asr.subscribe(fn), () => asr.getState());
}

const mb = (b: number) => `${Math.round(b / 1e6)} Mo`;

export function ModelStatus({ state, compact }: { state: ModelState; compact?: boolean }) {
  if (state.status === 'idle') return compact ? null : <span className="muted small">Modèle non chargé</span>;
  if (state.status === 'ready') return <span className="small voice-ok">● Modèle prêt</span>;
  if (state.status === 'error') return <span className="small voice-err">Erreur du modèle : {state.message}</span>;
  const pct = state.total ? Math.round((100 * state.loaded) / state.total) : 0;
  return (
    <span className="small model-progress">
      {state.total ? `Téléchargement du modèle ${pct} % (${mb(state.loaded)} / ${mb(state.total)})` : 'Préparation du modèle…'}
      <progress max={100} value={state.total ? pct : undefined} />
    </span>
  );
}

/** Live microphone level meter. */
export function LevelMeter({ level }: { level: () => number }) {
  const [v, setV] = useState(0);
  const [t0] = useState(() => Date.now());
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setV(level());
      setSecs(Math.floor((Date.now() - t0) / 1000));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level, t0]);
  return (
    <span className="rec-indicator small">
      <span className="rec-dot" /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      <span className="meter"><span style={{ width: `${Math.round(v * 100)}%` }} /></span>
    </span>
  );
}
