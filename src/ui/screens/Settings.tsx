import { useRef, useState } from 'react';
import { DEFAULT_CONFIG, type Config } from '../../core/config';
import { DAY_MS } from '../../core/clock';
import { exportData, importData, resetAll, saveSettings } from '../../data/actions';
import { Card } from '../components/common';
import { formatDate, useNow, useQuran, useSettings } from '../hooks';

type Path = string;
const FIELDS: { group: string; items: [Path, string, number?][] }[] = [
  { group: 'Poids des erreurs', items: [['weights.hesitation', 'Hésitation / aide'], ['weights.wrong', 'Mauvais mot / haraka'], ['weights.skipped_word', 'Mot sauté'], ['weights.skipped_ayah', 'Ayah sautée / bloqué']] },
  { group: 'Notes (seuils sur E)', items: [['gradeThresholds.good', 'Bien si E ≤', 0.05], ['gradeThresholds.hard', 'Difficile si E ≤', 0.05]] },
  { group: 'Multiplicateurs de S', items: [['multipliers.easy', 'Facile ×', 0.1], ['multipliers.good', 'Bien ×', 0.1], ['multipliers.hard', 'Difficile ×', 0.1], ['multipliers.again', 'À revoir ×', 0.05], ['minStability', 'S minimum (j)'], ['initialStability', 'S initial (j)']] },
  { group: 'Rétention et maîtrise', items: [['targetRetention', 'R visé à la date de révision', 0.01], ['mastery.mastered', 'Maîtrisé si M ≥', 0.01], ['mastery.fragile', 'Fragile si M ≥', 0.01], ['masteryWindow', 'Récitations dans Ē']] },
  { group: 'Mots faibles', items: [['weakWord.onMistake', 'D + (erreur)', 0.5], ['weakWord.onCorrect', 'D − (correct)', 0.5], ['weakWord.contextBefore', 'Mots de contexte avant'], ['weakWord.hideAfter', 'Mots cachés après']] },
  { group: 'Mode intensif', items: [['intensive.enterMistakes', 'Erreurs pour entrer'], ['intensive.enterWindow', 'sur les N dernières'], ['intensive.exitCleanDays', 'Jours corrects pour sortir']] },
  { group: 'Budget de temps', items: [['minutesPerAyah', 'Minutes par ayah', 0.1], ['minutesPerWord', 'Minutes par mot', 0.1]] },
];

const get = (o: any, p: Path) => p.split('.').reduce((x, k) => x?.[k], o);
const set = (o: any, p: Path, v: unknown) => {
  const ks = p.split('.');
  const out = structuredClone(o ?? {});
  let cur = out;
  for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
  cur[ks[ks.length - 1]] = v;
  return out;
};

export function Settings() {
  const quran = useQuran();
  const { settings, cfg } = useSettings();
  const nowMs = useNow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const update = (p: Path, v: unknown) => saveSettings({ config: set(settings.config, p, v) });

  const doExport = async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hifz-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File) => {
    try {
      await importData(JSON.parse(await f.text()));
      setMsg('Sauvegarde importée.');
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
    }
  };

  return (
    <div className="stack">
      <header className="page-head"><h1>Réglages</h1></header>

      <Card>
        <h2>Sections</h2>
        <div className="form-row">
          <span>Découpage</span>
          <div className="seg">
            <button className={cfg.sectionMode === 'ayat' ? 'on' : ''} onClick={() => update('sectionMode', 'ayat')}>Nombre d'ayat</button>
            <button className={cfg.sectionMode === 'page' ? 'on' : ''} onClick={() => update('sectionMode', 'page')}>Une page</button>
          </div>
        </div>
        {cfg.sectionMode === 'ayat' && (
          <label className="form-row">
            <span>Ayat par section</span>
            <input type="number" min={1} max={40} value={cfg.sectionSize} onChange={(e) => update('sectionSize', Math.max(1, Number(e.target.value)))} />
          </label>
        )}
        <p className="muted small">S'applique aux sourates ajoutées ensuite. Pour une sourate existante : « Redécouper » dans « Ce que je connais ».</p>
      </Card>

      <Card>
        <h2>Constantes</h2>
        {FIELDS.map((g) => (
          <fieldset key={g.group}>
            <legend>{g.group}</legend>
            {g.items.map(([p, label, step]) => {
              const changed = get(cfg, p) !== get(DEFAULT_CONFIG, p);
              return (
                <label key={p} className="form-row">
                  <span>{label}{changed && <span className="muted small"> (défaut {String(get(DEFAULT_CONFIG, p))})</span>}</span>
                  <input type="number" step={step ?? 1} value={get(cfg, p)} onChange={(e) => e.target.value !== '' && update(p, Number(e.target.value))} />
                </label>
              );
            })}
          </fieldset>
        ))}
        <button className="btn small" onClick={() => saveSettings({ config: { sectionMode: cfg.sectionMode, sectionSize: cfg.sectionSize } as Partial<Config> })}>Rétablir les valeurs par défaut</button>
      </Card>

      <Card>
        <h2>Données</h2>
        <p className="muted small">Tout est stocké sur cet appareil (IndexedDB). Exporte régulièrement une sauvegarde.</p>
        <div className="actions wrap">
          <button className="btn" onClick={doExport}>Exporter (JSON)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Importer…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          <button className="btn bad" onClick={() => confirm('Effacer toutes les données de cet appareil ?') && resetAll().then(() => setMsg('Données effacées.'))}>Tout effacer</button>
        </div>
        {msg && <p className="small">{msg}</p>}
      </Card>

      <Card>
        <h2>Débogage : simuler des jours</h2>
        <p className="small">
          Date utilisée : <b>{formatDate(nowMs)}</b> {settings.simOffsetDays !== 0 && <span className="badge sim">+{settings.simOffsetDays} j</span>}
        </p>
        <div className="actions wrap">
          {[1, 3, 7, 30].map((n) => (
            <button key={n} className="btn small" onClick={() => saveSettings({ simOffsetDays: settings.simOffsetDays + n })}>+{n} j</button>
          ))}
          <button className="btn small ghost" onClick={() => saveSettings({ simOffsetDays: 0 })}>Revenir à aujourd'hui</button>
        </div>
        <p className="muted small">Les récitations faites en mode simulé sont enregistrées à la date simulée ({new Date(Date.now() + settings.simOffsetDays * DAY_MS).toLocaleDateString('fr-FR')}).</p>
      </Card>

      <Card>
        <h2>Source du texte</h2>
        <p className="small">
          Texte coranique : <a href="https://tanzil.net" target="_blank" rel="noreferrer">Tanzil Project</a> (Uthmani), reproduit sans modification,
          licence Creative Commons Attribution 3.0. Police : Amiri Quran (SIL Open Font License).
        </p>
        <details>
          <summary className="small">Notice de copyright Tanzil</summary>
          <pre className="notice">{quran.data.source.notice}</pre>
        </details>
      </Card>
    </div>
  );
}
