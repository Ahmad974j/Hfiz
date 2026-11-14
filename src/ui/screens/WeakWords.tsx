import { useEffect, useState } from 'react';
import { buildToday } from '../../core/today';
import { now } from '../../core/clock';
import { parseWordId } from '../../core/types';
import { reviewWord } from '../../data/actions';
import { AyahMark, Card, Empty } from '../components/common';
import { go, useDashboard, useQuran } from '../hooks';
import type { Config } from '../../core/config';
import type { Quran } from '../../data/quran';

interface Ctx {
  before: { id: string; text: string; ayahEnd?: number }[];
  hidden: { id: string; text: string; ayahEnd?: number }[];
}

/** Words before the target (crossing ayah boundaries inside the surah), then the target + following words. */
function context(quran: Quran, id: string, cfg: Config): Ctx {
  const { surah } = parseWordId(id);
  const ids = quran.wordIds(surah);
  const i = ids.indexOf(id);
  const mk = (wid: string) => {
    const { ayah, word } = parseWordId(wid);
    const a = quran.ayah(surah, ayah);
    const w = a.words[word - 1];
    return { id: wid, text: w.m ? `${w.t} ${w.m}` : w.t, ayahEnd: word === a.words.length ? ayah : undefined };
  };
  return {
    before: ids.slice(Math.max(0, i - cfg.weakWord.contextBefore), i).map(mk),
    hidden: ids.slice(i, i + 1 + cfg.weakWord.hideAfter).map(mk),
  };
}

export function WeakWords() {
  const quran = useQuran();
  const { loaded, sections, cards, ayahStates, nowMs, settings, cfg } = useDashboard();
  const [queue, setQueue] = useState<string[] | null>(null);
  const [pos, setPos] = useState(0);
  const [shown, setShown] = useState(false);
  const [score, setScore] = useState({ ok: 0, ko: 0 });

  // Snapshot the queue once, so it doesn't shift while reviewing.
  useEffect(() => {
    if (!loaded || queue) return;
    const plan = buildToday(sections!, ayahStates!, cards!, nowMs, settings.budgetMinutes, cfg);
    setQueue(plan.items.flatMap((i) => (i.kind === 'word' ? [i.card.wordId] : [])));
  }, [loaded, queue, sections, ayahStates, cards, nowMs, settings.budgetMinutes, cfg]);

  if (!queue) return <p className="muted">Chargement…</p>;
  if (queue.length === 0) return <Empty>Aucun mot faible à revoir aujourd'hui.</Empty>;

  if (pos >= queue.length) {
    return (
      <div className="stack">
        <header className="page-head"><h1>Mots faibles</h1></header>
        <Card>
          <p className="big">Terminé</p>
          <p>{score.ok} correct{score.ok > 1 ? 's' : ''}, {score.ko} à retravailler.</p>
        </Card>
        <button className="btn primary" onClick={() => go('/')}>Retour à Aujourd'hui</button>
      </div>
    );
  }

  const id = queue[pos];
  const { surah, ayah } = parseWordId(id);
  const ctx = context(quran, id, cfg);
  const card = cards!.find((c) => c.wordId === id);

  const answer = async (ok: boolean) => {
    await reviewWord(id, ok, now());
    setScore((s) => (ok ? { ...s, ok: s.ok + 1 } : { ...s, ko: s.ko + 1 }));
    setShown(false);
    setPos(pos + 1);
  };

  const renderWord = (w: Ctx['before'][number], cls: string) => (
    <span key={w.id}>
      <span className={`word ${cls}`}>{w.text}</span>
      {w.ayahEnd != null && <AyahMark n={w.ayahEnd} />}{' '}
    </span>
  );

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Mots faibles</h1>
        <p className="muted">
          {pos + 1} / {queue.length} · {quran.name(surah)} {ayah}
          {card?.intensive.active && <span className="badge st-weak">intensif {card.intensive.cleanDays}/{cfg.intensive.exitCleanDays}</span>}
        </p>
      </header>
      <div className="mushaf" dir="rtl" lang="ar">
        <p className="words">
          {ctx.before.length === 0 && <span className="muted small" dir="ltr">(début de la sourate) </span>}
          {ctx.before.map((w) => renderWord(w, 'ctx'))}
          {shown
            ? ctx.hidden.map((w, i) => renderWord(w, i === 0 ? 'target' : 'after'))
            : ctx.hidden.map((w) => <span key={w.id} className="word hidden">{' '}</span>)}
        </p>
      </div>
      <p className="muted small">Récite la suite de mémoire, puis révèle.</p>
      {!shown ? (
        <button className="btn primary block" onClick={() => setShown(true)}>Révéler</button>
      ) : (
        <div className="two">
          <button className="btn bad" onClick={() => answer(false)}>Incorrect</button>
          <button className="btn good" onClick={() => answer(true)}>Correct</button>
        </div>
      )}
      {card && <p className="muted small">Difficulté D = {card.D.toString().replace('.', ',')} · stabilité {card.S.toFixed(1).replace('.', ',')} j</p>}
    </div>
  );
}
