import { buildToday, groupIntensiveAyat } from '../../core/today';
import { dayKey } from '../../core/clock';
import { saveSettings } from '../../data/actions';
import { Card, Empty, StatusBadge, SurahTitle } from '../components/common';
import { formatDate, go, useDashboard, useQuran } from '../hooks';

const BUDGETS: (number | null)[] = [null, 10, 20, 30, 45];

export function Today() {
  const quran = useQuran();
  const { loaded, sections, cards, ayahStates, nowMs, settings, cfg, summary } = useDashboard();
  if (!loaded || !summary) return <p className="muted">Chargement…</p>;

  const plan = buildToday(sections!, ayahStates!, cards!, nowMs, settings.budgetMinutes, cfg);
  // Show every intensive group (progress), including the ones already practised today.
  const intensiveGroups = groupIntensiveAyat(ayahStates!, dayKey(nowMs));
  const due = plan.items.filter((i) => i.kind === 'section');
  const words = plan.items.filter((i) => i.kind === 'word');
  const intensiveWords = cards!.filter((c) => !c.retired && c.intensive.active);
  const warnings = summary.surahs.filter((s) => s.warning);
  const memorizedCount = sections!.filter((s) => s.memorized).length;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Aujourd'hui</h1>
        <p className="muted">
          {formatDate(nowMs)}
          {settings.simOffsetDays !== 0 && <span className="badge sim">simulé +{settings.simOffsetDays} j</span>}
        </p>
      </header>

      {memorizedCount === 0 && (
        <Card>
          <p>Commence par indiquer les sourates que tu connais déjà.</p>
          <button className="btn primary" onClick={() => go('/memorized')}>Choisir mes sourates</button>
        </Card>
      )}

      <div className="budget">
        <span className="muted">Temps disponible</span>
        <div className="seg">
          {BUDGETS.map((b) => (
            <button key={String(b)} className={settings.budgetMinutes === b ? 'on' : ''} onClick={() => saveSettings({ budgetMinutes: b })}>
              {b == null ? '∞' : `${b} min`}
            </button>
          ))}
        </div>
      </div>
      {plan.skipped > 0 && <p className="muted small">{plan.skipped} élément(s) masqué(s) par la limite de temps. Total prévu ≈ {Math.round(plan.totalMinutes)} min.</p>}

      {warnings.length > 0 && (
        <Card className="warn-card">
          <h2>Alertes</h2>
          <ul className="list">
            {warnings.map((w) => (
              <li key={w.surah} className={`warn st-${w.status}`}>
                <button className="link" onClick={() => go(`/overview?surah=${w.surah}&section=${w.weakest?.sectionId}`)}>{w.warning}</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(intensiveGroups.length > 0 || intensiveWords.length > 0) && (
        <Card>
          <h2>Mode intensif</h2>
          <ul className="list">
            {intensiveGroups.map((g) => {
              const label = (
                <>
                  <SurahTitle surah={g.surah} from={g.fromAyah} to={g.toAyah} />
                  <span className="badge st-weak">
                    difficile · {g.cleanDays}/{cfg.intensive.exitCleanDays} jours corrects{g.doneToday ? ' · ✓ fait aujourd’hui' : ''}
                  </span>
                </>
              );
              return (
                <li key={`${g.surah}:${g.fromAyah}`}>
                  {g.doneToday ? (
                    <div className="row static">{label}</div>
                  ) : (
                    <button className="row" onClick={() => go(`/recite?surah=${g.surah}&from=${g.fromAyah}&to=${g.toAyah}`)}>{label}</button>
                  )}
                </li>
              );
            })}
            {intensiveWords.map((c) => (
              <li key={c.wordId} className="row static">
                <span>
                  <span className="ar inline" lang="ar">{quran.word(c.wordId)?.t}</span>{' '}
                  <span className="muted small">{quran.name(c.surah)} {c.ayah}</span>
                </span>
                <span className="badge st-weak">mot difficile · {c.intensive.cleanDays}/{cfg.intensive.exitCleanDays}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2>Sections à réciter <span className="count">{due.length}</span></h2>
        {due.length === 0 ? (
          <Empty>Aucune section due. ✨</Empty>
        ) : (
          <ul className="list">
            {due.map((i) => {
              if (i.kind !== 'section') return null;
              const m = summary.masteryById.get(i.section.id);
              return (
                <li key={i.section.id}>
                  <button className="row" onClick={() => go(`/recite?section=${encodeURIComponent(i.section.id)}`)}>
                    <SurahTitle surah={i.section.surah} from={i.section.fromAyah} to={i.section.toAyah} />
                    <span className="right">
                      {i.section.lastReviewedAt == null ? <span className="badge st-new">nouvelle</span> : <span className="muted small">R {Math.round(i.R * 100)} %</span>}
                      {m && m.status !== 'new' && <StatusBadge status={m.status} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2>Mots faibles <span className="count">{words.length}</span></h2>
        {words.length === 0 ? (
          <Empty>Aucun mot à revoir.</Empty>
        ) : (
          <>
            <p className="ar-list" lang="ar" dir="rtl">
              {words.slice(0, 12).map((w) => (w.kind === 'word' ? <span key={w.card.wordId} className={w.intensive ? 'hot' : ''}>{quran.word(w.card.wordId)?.t}</span> : null))}
              {words.length > 12 && <span className="muted">…</span>}
            </p>
            <button className="btn primary" onClick={() => go('/words')}>Réviser {words.length} mot{words.length > 1 ? 's' : ''} en contexte</button>
          </>
        )}
      </Card>
    </div>
  );
}
