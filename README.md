# Hifz — révision espacée du Coran

Application web (React + TypeScript + Vite, sans backend) pour réviser le Coran par répétition espacée.
La « note » de chaque révision vient des **erreurs faites pendant la récitation**, pas d'un bouton d'auto-évaluation.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests Vitest (logique + IndexedDB)
npm run build      # build statique dans dist/
```

## Texte coranique

- Source : **Tanzil Project**, texte Uthmani (`data/source/quran-uthmani.txt`, copie verbatim avec sa notice).
  Licence CC BY 3.0, modification interdite. Le texte n'est jamais tapé à la main.
- `npm run build:quran` génère `public/quran/quran.json` (Al-Mulk + Juz 'Amma) en **découpant seulement**
  sourate > ayah > mot. Chaque ayah est recomposée et comparée à la ligne source (échec du build sinon).
- ID de mot stable : `sourate:ayah:indexMot` (index à partir de 1, basmala exclue).
  La basmala de l'ayah 1 est affichée en en-tête et n'est pas notée. Les signes de pause sont rattachés au mot précédent.
- Police : Amiri Quran (`@fontsource/amiri-quran`, OFL).

## Architecture

```
src/core/        logique pure + tests (aucune dépendance au navigateur)
  config.ts      toutes les constantes (modifiables dans Réglages)
  grading.ts     E, note, nouvelle stabilité
  retention.ts   R(t), échéance
  intensive.ts   entrée/sortie du mode intensif
  weakWords.ts   difficulté D des mots faibles
  mastery.ts     M, statut de section, statut de sourate (= section la plus faible)
  recitation.ts  traitement complet d'une récitation
  today.ts       liste du jour + budget de temps
  sections.ts    découpage (n ayat ou une page du mushaf)
  clock.ts       horloge avec décalage « simuler des jours »
src/data/        Dexie (IndexedDB), chargement du texte, actions, export/import JSON
  arabic.ts      normalisation de l'arabe (Uthmani vs écriture courante), similarité de mots
  align.ts       alignement « entendu » / texte d'une ayah -> erreurs proposées
src/mistakes/    interface MistakeSource (saisie manuelle)
  voice/         récitation vocale : micro, worker de transcription (transformers.js)
src/ui/          écrans : Aujourd'hui, Récitation, Mots faibles, Vue d'ensemble, Sourates, Réglages
```

## Choix de conception (écarts / précisions par rapport à la spec)

- **Rétention** : `R(t) = 0.9^(t/S)` au lieu de `exp(-t/S)`. S = nombre de jours après lesquels R tombe à 0,9,
  et la révision est due à `t = S`. Avec `exp(-t/S)`, une section serait à R ≈ 0,37 (rouge) à chaque échéance.
  `targetRetention` est réglable.
- **Statut de sourate** : section la plus faible parmi les sections déjà récitées. Une section jamais récitée
  ne masque pas une faiblesse connue.
- **Mode intensif** : entrée si ≥ 2 des 3 dernières tentatives (ayah ou mot) ont une erreur. Sortie après 3 jours
  corrects *distincts* sans erreur entre eux (une erreur remet à 0). Un exercice intensif sur des ayat ne modifie
  pas le S de la section.
- **Mots faibles** : erreur → D+1 et S selon « À revoir ». Correct en carte → D−0,5 et S selon « Bien ».
  Correct pendant une récitation de section → D−0,5 seulement. Une ayah sautée est suivie au niveau de l'ayah, sans carte de mot.
- **Indice** pendant la récitation = révèle le mot suivant et compte comme hésitation.
- Un seul profil par appareil.

## Récitation vocale

- Case « 🎤 Récitation vocale » sur l'écran de récitation. On récite ayah par ayah (« Ayah suivante » enchaîne
  sans couper), la transcription tourne en arrière-plan pendant qu'on continue.
- Modèle : [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran) (Apache 2.0),
  export ONNX 8 bits `nael239/tasme3-whisper-base-ar-quran-web` (~105 Mo, modifiable dans Réglages), exécuté
  **dans le navigateur** (WASM, dans un Web Worker). Rien n'est envoyé à un serveur ; le modèle est téléchargé
  une fois depuis Hugging Face et le runtime ONNX depuis jsDelivr, puis gardés en cache.
- Comparaison (`src/core/align.ts`) : texte normalisé (sans harakat, alef/ya/hamza/ta marbuta unifiés), puis
  comparaison sur le « squelette » sans voyelles longues pour absorber les différences d'orthographe Uthmani.
  Alignement mot à mot par distance d'édition (un mot Uthmani peut correspondre à deux mots entendus).
  - mot différent -> « Mauvais mot » ; mot absent -> « Mot sauté » ; mot répété -> « Hésitation » ;
    moins de 25 % de l'ayah reconnue -> « Ayah sautée / bloqué » ; basmala / mots en trop ignorés.
  - Les harakat ne sont pas vérifiées (le modèle ne les transcrit pas de façon fiable).
- Les erreurs proposées s'affichent en pointillés : l'élève (ou l'enseignant) confirme ou corrige en touchant le mot.
  L'enregistrement de chaque ayah peut être réécouté. On peut aussi importer un fichier audio.
