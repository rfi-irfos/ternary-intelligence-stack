/**
 * "Notes from the makers", shown in the About. Edit the texts here; no UI code needs to change.
 * Placeholders in {braces} are filled from the data (see aboutTexts in src/ui/about.ts):
 * {depth} depth surgeries, {from} / {to} layers, {layers}.
 *
 * Every paragraph below is a DRAFT in "we" form that states only facts the repo docs support.
 * The personal part is for the makers to add: add or replace paragraphs freely.
 */
export interface Notes {
  title: { en: string; de: string };
  paragraphs: Array<{ en: string; de: string }>;
  /** Sign-off line under the notes. */
  signoff: string;
}

export const NOTES: Notes = {
  // DRAFT: Simeon/Laura to overwrite
  title: { en: 'Notes from the makers', de: 'Notizen aus dem Team' },
  paragraphs: [
    {
      // DRAFT: Simeon/Laura to overwrite
      en: 'We built albert. at RFI-IRFOS in Graz: a language model whose weights are −1, 0 or +1.',
      de: 'Wir haben albert. bei RFI-IRFOS in Graz gebaut: ein Sprachmodell, dessen Gewichte −1, 0 oder +1 sind.',
    },
    {
      // DRAFT: Simeon/Laura to overwrite
      en: 'We grew it layer by layer. {depth} depth surgeries took it from {from} to {to} layers, and each one is written down in our surgery registry.',
      de: 'Wir haben es Ebene für Ebene wachsen lassen. {depth} Tiefen-Eingriffe führten es von {from} auf {to} Ebenen, und jeder steht in unserem Eingriffsregister.',
    },
    {
      // DRAFT: Simeon/Laura to overwrite
      en: 'We opened its structure for study. This explorer reads the real model file, and every number carries a label: structure, measured or illustrative.',
      de: 'Wir haben seinen Aufbau zum Studium geöffnet. Dieser Explorer liest die echte Modelldatei, und jede Zahl trägt ein Etikett: Struktur, gemessen oder illustrativ.',
    },
  ],
  // DRAFT: Simeon/Laura to overwrite
  signoff: 'RFI-IRFOS',
};
