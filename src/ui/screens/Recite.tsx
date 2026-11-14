import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { saveRecitation, type RecitationResult } from '../../data/actions';
import { errorScore, gradeFromE, GRADE_LABEL } from '../../core/grading';
import { normalizeMistakes } from '../../core/recitation';
import { alignAyah, alignmentToMistakes, DEFAULT_ALIGN } from '../../core/align';
import { now } from '../../core/clock';
import { wordId, type Mistake, type MistakeType } from '../../core/types';
import { manualSource, type MistakeSource } from '../../mistakes/MistakeSource';
import { asr } from '../../mistakes/voice/asr';
import { decodeTo16k, micBlockedByEmbed, micSupported, startRecording, type Recording } from '../../mistakes/voice/recorder';
import { AyahMark, Card, SurahTitle } from '../components/common';
import { LevelMeter, ModelStatus, useModelState } from '../components/Voice';
import { formatDate, formatDays, go, useQuran, useSettings } from '../hooks';

const VOICE_KEY = 'hifz.voiceMode';
const readVoicePref = () => {
  try {
    return localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
};

interface Heard {
  text: string;
  url?: string;
  error?: string;
}

const TYPE_LABEL: Record<MistakeType, string> = {
  hesitation: 'Hésitation / aide',
  wrong: 'Mauvais mot ou haraka',
  skipped_word: 'Mot sauté',
  skipped_ayah: 'Ayah sautée / bloqué',
};

export function Recite({ params, source = manualSource }: { params: URLSearchParams; source?: MistakeSource }) {
  const quran = useQuran();
  const { cfg } = useSettings();
  const sectionParam = params.get('section');
  const section = useLiveQuery(async () => (sectionParam ? (await db.sections.get(sectionParam)) ?? null : null), [sectionParam]);

  const surah = section ? section.surah : Number(params.get('surah'));
  const fromAyah = section ? section.fromAyah : Number(params.get('from'));
  const toAyah = section ? section.toAyah : Number(params.get('to'));
  const ready = sectionParam ? section !== undefined : true;
  const valid = ready && !!surah && !!fromAyah && !!toAyah && (!sectionParam || section);

  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [peeked, setPeeked] = useState<Record<number, number>>({});
  const [teacherView, setTeacherView] = useState(false);
  const [mistakes, setMistakes] = useState<Map<string, MistakeType>>(new Map());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<string | null>(null);
  const [result, setResult] = useState<RecitationResult | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- voice recitation ----
  const [voiceOn, setVoiceOn] = useState(readVoicePref);
  const modelState = useModelState();
  const [recording, setRecording] = useState<{ ayah: number; rec: Recording } | null>(null);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [heard, setHeard] = useState<Record<number, Heard>>({});
  /** Words whose mark was proposed by the voice analysis (shown dashed until touched). */
  const [proposed, setProposed] = useState<Set<string>>(new Set());
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef(recording);
  recRef.current = recording;

  const toggleVoice = (on: boolean) => {
    setVoiceOn(on);
    try {
      localStorage.setItem(VOICE_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  // Start downloading / warming up the model as soon as voice mode is on.
  useEffect(() => {
    if (voiceOn) asr.load(cfg.voice.model).catch(() => {});
  }, [voiceOn, cfg.voice.model]);
  // Never leave the microphone open when leaving the screen.
  useEffect(() => () => recRef.current?.rec.cancel(), []);

  // Pre-fill from the mistake source (manual = nothing; voice later).
  useEffect(() => {
    if (!valid) return;
    const ctl = new AbortController();
    source.propose({ surah, fromAyah, toAyah }, ctl.signal).then((proposed) => {
      if (ctl.signal.aborted || proposed.length === 0) return;
      setMistakes((prev) => {
        const next = new Map(prev);
        for (const m of proposed) if (m.type !== 'skipped_ayah') next.set(m.wordId, m.type);
        return next;
      });
      setSkipped((prev) => new Set([...prev, ...proposed.filter((m) => m.type === 'skipped_ayah').map((m) => Number(m.wordId.split(':')[1]))]));
    });
    return () => ctl.abort();
  }, [valid, surah, fromAyah, toAyah, source]);

  const ayat = useMemo(() => (valid ? quran.surah(surah).ayat.slice(fromAyah - 1, toAyah) : []), [valid, quran, surah, fromAyah, toAyah]);

  if (!ready) return <p className="muted">Chargement…</p>;
  if (!valid) return <p>Section introuvable. <button className="link" onClick={() => go('/')}>Retour</button></p>;

  const current = ayat.find((a) => !revealed.has(a.n) && !pending.has(a.n));
  const allMistakes: Mistake[] = normalizeMistakes(
    [
      ...[...mistakes.entries()].map(([id, type]) => ({ wordId: id, type })),
      ...[...skipped].map((a) => ({ wordId: wordId(surah, a, 1), type: 'skipped_ayah' as const })),
    ],
    cfg,
  );
  const liveE = errorScore(allMistakes, toAyah - fromAyah + 1, cfg);

  const peek = () => {
    if (!current) return;
    const k = peeked[current.n] ?? 0;
    if (k >= current.words.length) return;
    const id = wordId(surah, current.n, k + 1);
    setPeeked({ ...peeked, [current.n]: k + 1 });
    // a peek counts as a hesitation (unless something heavier is already marked)
    setMistakes((prev) => (prev.has(id) ? prev : new Map(prev).set(id, 'hesitation')));
  };
  const reveal = () => current && setRevealed(new Set(revealed).add(current.n));
  const revealAll = () => setRevealed(new Set(ayat.map((a) => a.n)));
  const setMistake = (id: string, type: MistakeType | null) => {
    setProposed((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    const next = new Map(mistakes);
    if (type) next.set(id, type);
    else next.delete(id);
    setMistakes(next);
    setPicker(null);
  };
  const toggleSkipped = (n: number) => {
    const next = new Set(skipped);
    next.has(n) ? next.delete(n) : next.add(n);
    setSkipped(next);
  };

  // ---- voice ----
  const analyse = async (ayahN: number, audio: Blob, keepUrl: boolean) => {
    setPending((p) => new Set(p).add(ayahN));
    const url = keepUrl ? URL.createObjectURL(audio) : undefined;
    const words = quran.surah(surah).ayat[ayahN - 1].words.map((w) => w.t);
    try {
      const pcm = await decodeTo16k(audio);
      const text = await asr.transcribe(pcm);
      const alignment = alignAyah(words, text, { ...DEFAULT_ALIGN, accept: cfg.voice.accept });
      const found = alignmentToMistakes(surah, ayahN, alignment);
      const prefix = `${surah}:${ayahN}:`;
      setMistakes((prev) => {
        const next = new Map(prev);
        for (const m of found) {
          if (m.type === 'skipped_ayah') continue;
          const old = next.get(m.wordId);
          if (!old || cfg.weights[m.type] > cfg.weights[old]) next.set(m.wordId, m.type);
        }
        return next;
      });
      setProposed((prev) => {
        const next = new Set([...prev].filter((id) => !id.startsWith(prefix)));
        for (const m of found) if (m.type !== 'skipped_ayah') next.add(m.wordId);
        return next;
      });
      if (found.some((m) => m.type === 'skipped_ayah')) setSkipped((prev) => new Set(prev).add(ayahN));
      setHeard((h) => ({ ...h, [ayahN]: { text, url } }));
    } catch (e) {
      setHeard((h) => ({ ...h, [ayahN]: { text: '', url, error: (e as Error).message } }));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(ayahN);
        return n;
      });
      setRevealed((r) => new Set(r).add(ayahN));
    }
  };

  const startRec = async (ayahN: number) => {
    setVoiceError(null);
    try {
      const rec = await startRecording();
      setRecording({ ayah: ayahN, rec });
    } catch (e) {
      const err = e as DOMException;
      setVoiceError(
        micBlockedByEmbed() || window.self !== window.top
          ? "Cette page est affichée dans un aperçu qui n'a pas le droit d'utiliser le micro. Ouvre l'application elle-même (npm run dev ou la version en ligne), ou importe un fichier audio enregistré avec ton téléphone."
          : err?.name === 'NotAllowedError'
          ? "Micro refusé. Autorise le micro pour ce site dans le navigateur, ou importe un fichier audio."
          : `Micro indisponible : ${err?.message ?? err}`,
      );
    }
  };

  /** Stops the current ayah; with `continueNext`, immediately records the next one. */
  const stopRec = async (continueNext: boolean) => {
    const r = recording;
    if (!r) return;
    setRecording(null);
    const nextAyah = ayat.find((a) => a.n > r.ayah && !revealed.has(a.n) && !pending.has(a.n));
    const blob = await r.rec.stop();
    void analyse(r.ayah, blob, true);
    if (continueNext && nextAyah) void startRec(nextAyah.n);
  };

  const importAudio = (f: File) => current && void analyse(current.n, f, true);

  const finish = async () => {
    setSaving(true);
    try {
      const r = await saveRecitation(quran, { surah, fromAyah, toAyah, sectionId: section?.id, mistakes: allMistakes, now: now() });
      setResult(r);
      window.scrollTo(0, 0);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    const r = result.record;
    return (
      <div className="stack">
        <header className="page-head">
          <h1>Résultat</h1>
          <SurahTitle surah={surah} from={fromAyah} to={toAyah} />
        </header>
        <Card className={`result g-${r.grade}`}>
          <div className="big">{GRADE_LABEL[r.grade]}</div>
          <dl className="kv">
            <dt>Score d'erreur E</dt>
            <dd>{r.E.toFixed(2).replace('.', ',')}</dd>
            <dt>Erreurs</dt>
            <dd>{r.mistakes.length}</dd>
            {r.S_before != null && (
              <>
                <dt>Stabilité S</dt>
                <dd>{formatDays(r.S_before)} → <b>{formatDays(r.S_after!)}</b></dd>
              </>
            )}
            {result.nextDue != null && (
              <>
                <dt>Prochaine révision</dt>
                <dd>{formatDate(result.nextDue)}</dd>
              </>
            )}
            {result.newCards > 0 && (
              <>
                <dt>Nouveaux mots faibles</dt>
                <dd>{result.newCards}</dd>
              </>
            )}
          </dl>
          {!section && <p className="muted small">Exercice intensif : la stabilité de la section n'est pas modifiée.</p>}
        </Card>
        <button className="btn primary" onClick={() => go('/')}>Retour à Aujourd'hui</button>
      </div>
    );
  }

  const s = quran.surah(surah);
  const done = !current && pending.size === 0;
  const recAyah = recording?.ayah;

  return (
    <div className="stack recite">
      <header className="page-head">
        <h1>{section ? 'Récitation' : 'Exercice intensif'}</h1>
        <SurahTitle surah={surah} from={fromAyah} to={toAyah} />
        <label className="toggle small">
          <input type="checkbox" checked={teacherView} onChange={(e) => setTeacherView(e.target.checked)} /> Texte visible (enseignant qui suit)
        </label>
        <label className="toggle small">
          <input type="checkbox" checked={voiceOn} disabled={!!recording} onChange={(e) => toggleVoice(e.target.checked)} /> 🎤 Récitation vocale (modèle Tarteel, sur l'appareil)
        </label>
        {voiceOn && <ModelStatus state={modelState} compact />}
      </header>

      <div className="mushaf" dir="rtl" lang="ar">
        {fromAyah === 1 && s.basmala && <p className="basmala">{s.basmala}</p>}
        {ayat.map((a) => {
          const isRevealed = revealed.has(a.n);
          const visible = isRevealed || teacherView;
          const k = peeked[a.n] ?? 0;
          return (
            <div key={a.n} className={`ayah ${a.n === (recAyah ?? current?.n) ? 'current' : ''} ${skipped.has(a.n) ? 'skipped' : ''} ${recAyah === a.n ? 'recording' : ''}`}>
              <p className="words">
                {a.words.map((w, i) => {
                  const id = wordId(surah, a.n, i + 1);
                  const m = mistakes.get(id);
                  if (!visible && i >= k) return <span key={id} className="word hidden" aria-hidden>{' '}</span>;
                  return (
                    <button key={id} className={`word ${m ? `m-${m}` : ''} ${m && proposed.has(id) ? 'proposed' : ''} ${!isRevealed && i < k ? 'peeked' : ''}`} onClick={() => setPicker(id)}>
                      {w.t}
                      {w.m && <span className="qmark"> {w.m}</span>}
                    </button>
                  );
                })}
                <AyahMark n={a.n} />
              </p>
              {pending.has(a.n) && <p className="heard small muted" dir="ltr">Analyse de la récitation…</p>}
              {heard[a.n] && (
                <div className="heard small" dir="ltr">
                  {heard[a.n].error ? (
                    <span className="voice-err">Analyse impossible : {heard[a.n].error}</span>
                  ) : (
                    <>
                      <span className="muted">Entendu : </span>
                      <span className="ar" dir="rtl" lang="ar">{heard[a.n].text.trim() || '(rien)'}</span>
                    </>
                  )}
                  {heard[a.n].url && <audio controls src={heard[a.n].url} preload="none" />}
                </div>
              )}
              {isRevealed && (
                <button className={`chip ${skipped.has(a.n) ? 'on' : ''}`} dir="ltr" onClick={() => toggleSkipped(a.n)}>
                  {skipped.has(a.n) ? '✓ ' : ''}Ayah sautée / bloqué (3)
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="action-bar">
        <span className="muted small">E = {liveE.toFixed(2).replace('.', ',')} · {GRADE_LABEL[gradeFromE(liveE, cfg)]}</span>
        <div className="actions">
          {recording ? (
            <>
              <LevelMeter level={recording.rec.level} />
              {ayat.some((a) => a.n > recording.ayah && !revealed.has(a.n) && !pending.has(a.n)) && (
                <button className="btn primary" onClick={() => stopRec(true)}>Ayah suivante ▸</button>
              )}
              <button className="btn" onClick={() => stopRec(false)}>■ Arrêter</button>
              <button className="btn" onClick={peek}>Indice</button>
            </>
          ) : current ? (
            voiceOn ? (
              <>
                <button className="btn primary" onClick={() => startRec(current.n)} disabled={!micSupported() || micBlockedByEmbed()}>🎤 Réciter l'ayah {current.n}</button>
                <button className="btn" onClick={peek}>Indice (mot suivant)</button>
                <button className="btn ghost small" onClick={reveal}>Vérifier sans micro</button>
                <button className="btn ghost small" onClick={() => fileRef.current?.click()}>Importer un audio…</button>
                <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importAudio(f); }} />
              </>
            ) : (
              <>
                <button className="btn" onClick={peek}>Indice (mot suivant)</button>
                <button className="btn primary" onClick={reveal}>Vérifier l'ayah {current.n}</button>
                <button className="btn ghost small" onClick={revealAll}>Tout révéler</button>
              </>
            )
          ) : pending.size > 0 ? (
            <span className="small muted">Analyse en cours…</span>
          ) : (
            <button className="btn primary" disabled={saving} onClick={finish}>Terminer</button>
          )}
        </div>
        {voiceError && <p className="small voice-err">{voiceError}</p>}
        {!done && !voiceOn && <p className="muted small hint">Récite l'ayah de mémoire, puis vérifie et touche les mots où il y a eu une erreur.</p>}
        {!done && voiceOn && (
          <p className="muted small hint">
            Récite l'ayah à voix haute ; les erreurs détectées apparaissent en pointillés. Vérifie-les : touche un mot pour corriger.
            {micBlockedByEmbed()
              ? ' Le micro est bloqué dans cet aperçu : importe un fichier audio (mémo vocal), ou ouvre l\'application elle-même.'
              : !micSupported() && ' Ce navigateur ne permet pas d\'enregistrer : importe un fichier audio.'}
          </p>
        )}
      </div>

      {picker && (
        <div className="sheet-backdrop" onClick={() => setPicker(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <p className="ar sheet-word" lang="ar">{quran.word(picker)?.t}</p>
            {(['hesitation', 'wrong', 'skipped_word'] as MistakeType[]).map((t) => (
              <button key={t} className={`btn block ${mistakes.get(picker) === t ? 'primary' : ''}`} onClick={() => setMistake(picker, t)}>
                {TYPE_LABEL[t]} <span className="muted">({cfg.weights[t]})</span>
              </button>
            ))}
            <button className="btn block ghost" onClick={() => setMistake(picker, null)}>Aucune erreur</button>
          </div>
        </div>
      )}
    </div>
  );
}
