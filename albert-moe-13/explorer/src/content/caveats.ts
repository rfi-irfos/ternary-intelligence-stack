export type CaveatId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9';

/** A caveat text in both UI languages (English is the reviewed original). */
export interface CaveatText {
  en: string;
  de: string;
}

export interface Caveat {
  title: CaveatText;
  body: CaveatText;
  evidence: CaveatText;
  /** Honesty label of the body's numbers when they come from a log rather than the code (shown as a tag). */
  label?: CaveatText;
  /** Where the table's numbers were read (the measured badge's title). */
  logPath?: string;
  /** Optional data table behind the body (shown under it, rendered into CAVEATS.md); cells are data, only the head is translated. */
  table?: { head: CaveatText[]; rows: string[][] };
}

/** Findings from the 2026-10-23 investigation (spec 3.4). The explorer shows what the code does and labels the discrepancy. */
export const CAVEATS: Record<CaveatId, Caveat> = {
  A1: {
    title: {
      en: 'Anastomosis is skipped in the training forward pass',
      de: 'Das Austausch-Tor wird im Trainings-Forward-Pass übersprungen',
    },
    body: {
      en: 'Transformer::forward runs stream A fully, then stream B, then averages. The code comment says this ' +
        '"approximates the interleaved fusion". Only forward_prefill and forward_decode apply the gates. ' +
        'generate() also calls forward, so it skips them too.',
      de: 'Transformer::forward rechnet erst Strom A vollständig, dann Strom B, und mittelt dann. Laut Codekommentar ist ' +
        'das nur eine Näherung der verschränkten Fusion. Nur forward_prefill und forward_decode wenden die Tore an. ' +
        'generate() ruft ebenfalls forward auf und überspringt sie deshalb auch.',
    },
    evidence: {
      en: 'transformer.rs:184-215, 282-295; train_bible.rs:1582 calls model.forward',
      de: 'transformer.rs:184-215, 282-295; train_bible.rs:1582 ruft model.forward auf',
    },
  },
  A2: {
    title: { en: 'Gate weights sit at initialisation scale', de: 'Die Gewichte der Tore liegen auf Initialisierungsniveau' },
    body: {
      en: 'RMS 0.010-0.012 against an init of N(0, 0.01); biases within +-0.009; gate 6 (layer 34) has bias exactly 0. ' +
        'This is consistent with A1. At inference sigma(~0) is about 0.5, so each stream adds about half of the other ' +
        'at 7 layers, a mixing the training path never saw.',
      de: 'RMS 0,010-0,012 bei einer Initialisierung mit N(0, 0,01); Biases innerhalb von +-0,009; Tor 6 (Ebene 34) hat einen Bias von genau 0. ' +
        'Das passt zu A1. Bei der Inferenz ist sigma(~0) etwa 0,5; jeder Strom addiert also in 7 Ebenen etwa die Hälfte des anderen, ' +
        'eine Mischung, die der Trainingsweg nie gesehen hat.',
    },
    evidence: { en: 'checkpoint read 2026-10-23', de: 'Checkpoint gelesen am 2026-10-23' },
  },
  A3: {
    title: {
      en: '"Safety gate" on experts 0-3 raises, not suppresses',
      de: 'Das „Sicherheitstor“ für die Experten 0-3 hebt an, statt zu unterdrücken',
    },
    body: {
      en: 'For experts 0-3 with a negative logit, the logit is multiplied to 0 before the top-3 softmax, which ' +
        'increases their weight. Docs describe it as suppression to zero.',
      de: 'Bei den Experten 0-3 wird ein negativer Logit vor der Top-3-Softmax mit 0 multipliziert, was ihr Gewicht ' +
        'erhöht. Die Dokumentation beschreibt es als Unterdrückung auf null.',
    },
    evidence: { en: 'moe.rs:310-326', de: 'moe.rs:310-326' },
  },
  A4: {
    title: { en: 'seed_bias dominates the expert input', de: 'seed_bias dominiert die Eingabe der Experten' },
    body: {
      en: 'Source comment: seed std is about 0.7 against a layer-norm output std of about 0.003; about 29.6 % of the ' +
        'inner neurons are seed-saturated.',
      de: 'Quellkommentar: Die Standardabweichung des Seeds liegt bei etwa 0,7, die der Ausgabe der Layer Norm bei etwa 0,003; ' +
        'etwa 29,6 % der inneren Neuronen sind vom Seed gesättigt.',
    },
    evidence: { en: 'mlp.rs:12, 40-42', de: 'mlp.rs:12, 40-42' },
  },
  A5: {
    title: {
      en: 'Traffic-light state and its output scales are runtime state',
      de: 'Ampelzustand und seine Ausgabeskalen sind Laufzeitzustand',
    },
    body: {
      en: 'They are not in the checkpoint. Any traffic-light colours shown must come from a trace or a log and be ' +
        'labelled with their source.',
      de: 'Sie stehen nicht im Checkpoint. Jede gezeigte Ampelfarbe muss aus einer Spur oder einem Log stammen und ' +
        'mit ihrer Quelle gekennzeichnet sein.',
    },
    evidence: { en: 'moe.rs:240-250, 346', de: 'moe.rs:240-250, 346' },
  },
  A6: {
    title: { en: 'Config says 38 layers, the checkpoint has 46', de: 'Die Konfiguration nennt 38 Ebenen, der Checkpoint hat 46' },
    body: {
      en: '42 layers is the officially documented state: the TIS session_log and convergence_log record the depth up to ' +
        'the 36→42 surgeries of 19 Sep 2026. Layers 43-46 (numbered 42-45 in Advanced mode, which counts from 0) grew afterwards, in the four depth surgeries 42→46 on 19 and ' +
        '20 Sep 2026, and so far only the training watch log records them, by tensor count (+78 tensors per layer). ' +
        'The explorer shows all 46 real layers: it reads the depth from the checkpoint, not the config.',
      de: '42 Ebenen sind der offiziell dokumentierte Stand: session_log und convergence_log von TIS halten die Tiefe bis zu ' +
        'den Eingriffen 36→42 vom 19. Sep. 2026 fest. Die Ebenen 43-46 (im Modus „Erweitert“ 42-45, weil er dort ab 0 zählt) kamen danach hinzu, in den vier ' +
        'Tiefen-Eingriffen 42→46 am 19. und 20. Sep. 2026; bisher hält nur das Trainings-Watch-Log sie fest, über die Zahl der Tensoren ' +
        '(+78 Tensoren je Ebene). Der Explorer zeigt alle 46 echten Ebenen: er liest die Tiefe aus dem Checkpoint, nicht aus der Konfiguration.',
    },
    evidence: {
      en: 'models/albert_v3.0.config.json; Colony ~/.albert/albert_watch_log.md (tns per 5-minute sample)',
      de: 'models/albert_v3.0.config.json; Colony ~/.albert/albert_watch_log.md (tns je 5-Minuten-Messung)',
    },
    label: {
      en: 'measured (log): ~/.albert/albert_watch_log.md',
      de: 'gemessen (Log): ~/.albert/albert_watch_log.md',
    },
    logPath: '~/.albert/albert_watch_log.md',
    table: {
      head: [
        { en: 'Change', de: 'Änderung' },
        { en: 'First seen (UTC)', de: 'Zuerst gesehen (UTC)' },
        { en: 'Epoch', de: 'Epoche' },
        { en: 'tns', de: 'tns' },
      ],
      rows: [
        ['42 → 43', '2026-09-19T14:00Z', 'ep8938', '3372'],
        ['43 → 44', '2026-09-19T15:05Z', 'ep8942', '3450'],
        ['44 → 45', '2026-09-19T18:55Z', 'ep8958', '3528'],
        ['45 → 46', '2026-09-20T01:10Z', 'ep8987', '3606'],
      ],
    },
  },
  A7: {
    title: { en: 'The explorer shows the 2026-09-23 checkpoint', de: 'Der Explorer zeigt den Checkpoint vom 2026-09-23' },
    body: {
      en: 'It may not be the newest one (the Modal volume was not checked). The site states its checkpoint date and hash.',
      de: 'Es ist womöglich nicht der neueste (das Modal-Volume wurde nicht geprüft). Die Seite nennt Datum und Hash ihres Checkpoints.',
    },
    evidence: { en: 'decision 2026-10-23', de: 'Entscheidung vom 2026-10-23' },
  },
  A8: {
    title: {
      en: 'The serving binary builds the model from the config depth (38)',
      de: 'Das Serving-Programm baut das Modell mit der Tiefe aus der Konfiguration (38)',
    },
    body: {
      en: 'It does not take the depth from the checkpoint (46). Whether blocks 38-45 are then silently ignored is not ' +
        'yet verified. If so, the deployed albert. runs a different depth than it was trained with.',
      de: 'Es übernimmt die Tiefe nicht aus dem Checkpoint (46). Ob die Blöcke 38-45 dann stillschweigend ignoriert werden, ist ' +
        'noch nicht geprüft. Falls ja, läuft das ausgelieferte albert. mit einer anderen Tiefe als der, mit der es trainiert wurde.',
    },
    evidence: { en: 'albert_serve.rs:194, builder check 2026-10-23', de: 'albert_serve.rs:194, Prüfung des Builders am 2026-10-23' },
  },
  A9: {
    title: {
      en: 'Traffic-light state persists across calls in one process',
      de: 'Der Ampelzustand bleibt in einem Prozess über Aufrufe hinweg erhalten',
    },
    body: {
      en: 'It has no reset, and its modifiers are off for the first 50 calls (warm-up). Routing therefore depends on ' +
        'call history.',
      de: 'Er wird nie zurückgesetzt, und seine Modifikatoren sind in den ersten 50 Aufrufen aus (Aufwärmphase). Das Routing hängt ' +
        'deshalb vom Verlauf der Aufrufe ab.',
    },
    evidence: { en: 'moe.rs:303-304, traffic_light.rs:36, 124, 208', de: 'moe.rs:303-304, traffic_light.rs:36, 124, 208' },
  },
};

export const CAVEAT_IDS = Object.keys(CAVEATS) as CaveatId[];

/** Markdown of the "Known caveats" page. `explorer/CAVEATS.md` is generated from this (npm run caveats). */
export function renderCaveats(): string {
  const out = [
    '# Known caveats',
    '',
    'Generated from `src/content/caveats.ts` by `npm run caveats`. Do not edit by hand.',
    '',
  ];
  for (const id of CAVEAT_IDS) {
    const c = CAVEATS[id];
    out.push(`## ${id}. ${c.title.en}`, '', c.body.en, '');
    if (c.table) {
      out.push(`| ${c.table.head.map((h) => h.en).join(' | ')} |`, `|${c.table.head.map(() => '---').join('|')}|`);
      for (const r of c.table.rows) out.push(`| ${r.join(' | ')} |`);
      out.push('');
    }
    if (c.label) out.push(`Label: ${c.label.en}`, '');
    out.push(`Evidence: ${c.evidence.en}`, '');
  }
  return out.join('\n');
}
