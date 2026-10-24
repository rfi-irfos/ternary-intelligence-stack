/**
 * "Notes from the team", shown in the About. Edit the texts here; no UI code needs to change.
 * Placeholders in {braces} are filled from the data (see aboutTexts in src/ui/about.ts):
 * {depth} depth surgeries, {from} / {to} layers per stream, {size} checkpoint size in GB.
 *
 * Voice: the TIS release notes (v3.0.0, v3.1.0): plain, declarative, "we" for the whole RFI-IRFOS team.
 * Nothing personal. Every statement is backed by the release notes, the model card or the data.
 */
export interface Notes {
  title: { en: string; de: string };
  paragraphs: Array<{ en: string; de: string }>;
  /** Sign-off line under the notes. */
  signoff: string;
}

export const NOTES: Notes = {
  title: { en: 'Notes from the team', de: 'Notizen aus dem Team' },
  paragraphs: [
    {
      en: 'albert. is a ternary dual-stream mixture-of-experts model, trained from scratch at RFI-IRFOS in Graz. Its weights are −1, 0 or +1, and the ternary constraint has been active since the first epoch.',
      de: 'albert. ist ein ternäres Dual-Stream-Mixture-of-Experts-Modell, das bei RFI-IRFOS in Graz von Grund auf trainiert wurde. Seine Gewichte sind −1, 0 oder +1. Die ternäre Beschränkung gilt seit der ersten Epoche.',
    },
    {
      en: 'The model grew in depth. {depth} depth surgeries took it from {from} to {to} layers per stream, and each one is written down in the surgery registry with its epoch and its loss.',
      de: 'Das Modell wuchs in die Tiefe. {depth} Tiefen-Eingriffe führten es von {from} auf {to} Ebenen pro Strom, und jeder steht mit Epoche und Loss im Eingriffsregister.',
    },
    {
      en: 'The training pipeline lives in the same repository as the model, and the full weights are public on Hugging Face, open to everyone.',
      de: 'Die Trainings-Pipeline liegt im selben Repository wie das Modell, und die vollständigen Gewichte sind öffentlich auf Hugging Face für alle zugänglich.',
    },
    {
      en: 'This explorer opens the structure for study. It reads the real model file, and every number carries a label: structure, measured or illustrative. Where the documentation gives a number, we cite it. Where it gives none, we say so.',
      de: 'Dieser Explorer öffnet den Aufbau zum Studium. Er liest die echte Modelldatei, und jede Zahl trägt ein Etikett: Struktur, gemessen oder illustrativ. Wo die Dokumentation eine Zahl nennt, zitieren wir sie. Wo sie keine nennt, sagen wir das.',
    },
    {
      en: 'albert. is a research model and still changing. The numbers on this page come from the data and follow it.',
      de: 'albert. ist ein Forschungsmodell und verändert sich weiter. Die Zahlen auf dieser Seite kommen aus den Daten und folgen ihnen.',
    },
  ],
  signoff: 'RFI-IRFOS',
};
