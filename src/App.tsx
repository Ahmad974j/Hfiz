import { useEffect, useState } from 'react';
import { loadQuran, Quran } from './data/quran';
import { getSettings } from './data/actions';
import { setSimulatedOffset } from './core/clock';
import { QuranContext, go, useRoute } from './ui/hooks';
import { Today } from './ui/screens/Today';
import { Recite } from './ui/screens/Recite';
import { WeakWords } from './ui/screens/WeakWords';
import { Overview } from './ui/screens/Overview';
import { Memorized } from './ui/screens/Memorized';
import { Settings } from './ui/screens/Settings';

const NAV = [
  ['/', "Aujourd'hui", '◐'],
  ['/overview', 'Vue', '▤'],
  ['/memorized', 'Sourates', '✓'],
  ['/settings', 'Réglages', '⚙'],
] as const;

export function App() {
  const [quran, setQuran] = useState<Quran | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { path, params } = useRoute();

  useEffect(() => {
    Promise.all([loadQuran(), getSettings()])
      .then(([data, s]) => {
        setSimulatedOffset(s.simOffsetDays);
        setQuran(new Quran(data));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <main className="app"><p>{error}</p></main>;
  if (!quran) return <main className="app"><p className="muted">Chargement du texte…</p></main>;

  let screen;
  switch (path) {
    case '/recite': screen = <Recite key={params.toString()} params={params} />; break;
    case '/words': screen = <WeakWords />; break;
    case '/overview': screen = <Overview params={params} />; break;
    case '/memorized': screen = <Memorized />; break;
    case '/settings': screen = <Settings />; break;
    default: screen = <Today />;
  }

  return (
    <QuranContext.Provider value={quran}>
      <main className="app">{screen}</main>
      <nav className="tabbar">
        {NAV.map(([to, label, icon]) => (
          <button key={to} className={path === to ? 'on' : ''} onClick={() => go(to)}>
            <span className="ico" aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </QuranContext.Provider>
  );
}
