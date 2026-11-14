import { useState } from 'react';
import { dueAt } from '../../core/retention';
import { GRADE_LABEL } from '../../core/grading';
import { Card, Empty, StatusBadge, SurahTitle } from '../components/common';
import { formatDate, formatDays, go, useDashboard, useQuran } from '../hooks';

export function Overview({ params }: { params: URLSearchParams }) {
  const quran = useQuran();
  const { loaded, summary, sections, recitations, cards } = useDashboard();
  const [selected, setSelected] = useState<string | null>(params.get('section'));

  if (!loaded || !summary) return <p className="muted">Chargement…</p>;
  if (summary.surahs.length === 0)
    return (
      <div className="stack">
        <header className="page-head"><h1>Vue d'ensemble</h1></header>
        <Empty>Aucune sourate mémorisée pour l'instant.</Empty>
        <button className="btn primary" onClick={() => go('/memorized')}>Choisir mes sourates</button>
      </div>
    );

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Vue d'ensemble</h1>
        <p className="legend small">
          <span className="dot st-mastered" /> maîtrisé <span className="dot st-fragile" /> fragile <span className="dot st-weak" /> non maîtrisé <span className="dot st-new" /> pas encore récité
        </p>
      </header>
      {summary.surahs.map((s) => {
        const sel = s.sections.find((x) => x.sectionId === selected);
        return (
          <Card key={s.surah}>
            <div className="row static">
              <SurahTitle surah={s.surah} />
              <StatusBadge status={s.status} />
            </div>
            <div className="bar" role="list">
              {s.sections.map((m) => (
                <button
                  key={m.sectionId}
                  role="listitem"
                  title={`${m.fromAyah}–${m.toAyah}`}
                  className={`seg-bar st-${m.status} ${selected === m.sectionId ? 'sel' : ''}`}
                  style={{ flexGrow: m.toAyah - m.fromAyah + 1 }}
                  onClick={() => setSelected(selected === m.sectionId ? null : m.sectionId)}
                >
                  <span>{m.fromAyah}</span>
                </button>
              ))}
            </div>
            {s.warning && <p className={`warn st-${s.status} small`}>{s.warning}</p>}
            {sel && (() => {
              const sec = sections!.find((x) => x.id === sel.sectionId)!;
              const hist = recitations!.filter((r) => r.sectionId === sel.sectionId).reverse();
              const weak = cards!.filter((c) => !c.retired && c.surah === s.surah && c.ayah >= sel.fromAyah && c.ayah <= sel.toAyah);
              return (
                <div className="detail">
                  <h3>Ayat {sel.fromAyah}–{sel.toAyah}</h3>
                  <dl className="kv">
                    <dt>Maîtrise M</dt><dd>{sel.M == null ? '—' : `${Math.round(sel.M * 100)} %`}</dd>
                    <dt>Rétention R</dt><dd>{sec.lastReviewedAt == null ? '—' : `${Math.round(sel.R * 100)} %`}</dd>
                    <dt>Stabilité S</dt><dd>{formatDays(sec.S)}</dd>
                    <dt>Prochaine révision</dt><dd>{sec.lastReviewedAt == null ? 'maintenant' : formatDate(dueAt(sec.lastReviewedAt, sec.S))}</dd>
                  </dl>
                  <button className="btn primary small" onClick={() => go(`/recite?section=${encodeURIComponent(sec.id)}`)}>Réciter maintenant</button>
                  <h4>Mots faibles ({weak.length})</h4>
                  {weak.length === 0 ? <p className="muted small">Aucun.</p> : (
                    <ul className="weak-list">
                      {weak.map((c) => (
                        <li key={c.wordId}>
                          <span className="ar inline" lang="ar">{quran.word(c.wordId)?.t}</span>
                          <span className="muted small"> ayah {c.ayah} · D {c.D.toString().replace('.', ',')}</span>
                          {c.intensive.active && <span className="badge st-weak">intensif {c.intensive.cleanDays}/3</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h4>Historique ({hist.length})</h4>
                  {hist.length === 0 ? <p className="muted small">Jamais récitée.</p> : (
                    <table className="hist">
                      <thead><tr><th>Date</th><th>E</th><th>Note</th><th>S</th></tr></thead>
                      <tbody>
                        {hist.map((r) => (
                          <tr key={r.id}>
                            <td>{formatDate(r.date)}</td>
                            <td>{r.E.toFixed(2).replace('.', ',')}</td>
                            <td className={`g-${r.grade}`}>{GRADE_LABEL[r.grade]}</td>
                            <td>{r.S_after != null ? formatDays(r.S_after) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })()}
          </Card>
        );
      })}
    </div>
  );
}
