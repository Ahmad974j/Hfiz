import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { resplitSurah, setSectionMemorized, setSurahMemorized } from '../../data/actions';
import { SurahTitle } from '../components/common';
import { useQuran } from '../hooks';

export function Memorized() {
  const quran = useQuran();
  const sections = useLiveQuery(() => db.sections.toArray(), []);
  const [open, setOpen] = useState<number | null>(null);
  if (!sections) return <p className="muted">Chargement…</p>;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Ce que je connais</h1>
        <p className="muted small">Coche les sourates déjà mémorisées. Tu peux ensuite (dé)cocher des sections précises.</p>
      </header>
      <ul className="list card">
        {quran.surahs.map((s) => {
          const secs = sections.filter((x) => x.surah === s.number).sort((a, b) => a.fromAyah - b.fromAyah);
          const count = secs.filter((x) => x.memorized).length;
          const all = secs.length > 0 && count === secs.length;
          const some = count > 0 && !all;
          return (
            <li key={s.number}>
              <div className="row static">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => el && (el.indeterminate = some)}
                    onChange={(e) => setSurahMemorized(quran, s.number, e.target.checked)}
                  />
                  <SurahTitle surah={s.number} />
                </label>
                <span className="right">
                  <span className="muted small">{s.ayat.length} ayat</span>
                  {secs.length > 1 && (
                    <button className="link small" onClick={() => setOpen(open === s.number ? null : s.number)}>
                      {open === s.number ? 'fermer' : `${count}/${secs.length} sections`}
                    </button>
                  )}
                </span>
              </div>
              {open === s.number && (
                <div className="sub">
                  {secs.map((x) => (
                    <label key={x.id} className="check small">
                      <input type="checkbox" checked={x.memorized} onChange={(e) => setSectionMemorized(x.id, e.target.checked)} />
                      Ayat {x.fromAyah}–{x.toAyah}
                    </label>
                  ))}
                  <button
                    className="link small danger"
                    onClick={() => {
                      if (confirm("Redécouper avec les réglages actuels ? L'historique des sections de cette sourate sera effacé (les mots faibles sont conservés).")) resplitSurah(quran, s.number);
                    }}
                  >
                    Redécouper selon les réglages
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
