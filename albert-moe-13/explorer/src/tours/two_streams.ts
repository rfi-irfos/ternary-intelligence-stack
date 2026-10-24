import type { TourStep } from './engine';
import { BANK, tx } from './text';

/** 6. Two streams, one model: shared experts, independent routers, anastomosis, caveats A1 and A2. Gate 13 (0-based) is "Ebene 14". */
export const streamsSteps: TourStep[] = [
  {
    camera: 'L12', highlight: ['shaft.A', 'shaft.B'],
    text: tx(
      ['albert. runs the word on two tracks at once: stream A and stream B. They run side by side through all {layers} layers.',
        'albert. lässt das Wort auf zwei Bahnen zugleich laufen: Strom A und Strom B. Sie laufen nebeneinander durch alle {layers} Ebenen.'],
      ['Each stream carries its own residual vector through {layers} layers. At the end the two are merged as a mean.',
        'Jeder Strom trägt einen eigenen Residualvektor durch {layers} Ebenen. Am Ende werden beide als Mittelwert vereint.'],
    ),
  },
  {
    camera: 'L12', highlight: BANK,
    text: tx(
      ['Both streams use the same {experts} experts. One pool, two users.',
        'Beide Ströme nutzen dieselben {experts} Experten. Ein Pool, zwei Nutzer.'],
      ['The expert weights exist once per layer and serve both streams. Attention, norms and routers exist per stream.',
        'Die Expertengewichte gibt es einmal je Ebene, sie bedienen beide Ströme. Attention, Normen und Router gibt es je Strom.'],
    ),
  },
  {
    camera: 'L12.A.router', highlight: ['L12.A.router', 'L12.B.router'],
    text: tx(
      ['Each stream has its own router. So A and B can pick different experts for the same word.',
        'Jeder Strom hat einen eigenen Router. So können A und B für dasselbe Wort verschiedene Experten wählen.'],
      ['Two independent F32 gates [{experts} × {hidden}], one per stream, over the same shared pool.',
        'Zwei unabhängige F32-Gates [{experts} × {hidden}], eines je Strom, über denselben gemeinsamen Pool.'],
    ),
  },
  {
    camera: 'L13.gate', highlight: ['L13.gate'],
    action: { predict: 'gate', layer: 13 },
    text: tx(
      ['In layer {layer} a valve lets the streams swap. Guess first: which stream takes more from the other for the word on screen?',
        'In Ebene {layer} lässt ein Ventil die Ströme tauschen. Rate zuerst: Welcher Strom nimmt für das Wort auf dem Bildschirm mehr vom anderen?'],
      ['Gate at layer {layer} (index {index}): A += g_a * B, B += g_b * A. The answer compares the recorded g_a and g_b for this token.',
        'Tor in Ebene {layer} (Index {index}): A += g_a * B, B += g_b * A. Die Antwort vergleicht die aufgezeichneten Werte g_a und g_b für dieses Token.'],
    ),
  },
  {
    camera: 'L13.gate', highlight: ['L13.gate'],
    text: tx(
      ['Finding A1: while training, the valves are skipped. Only when the model runs for real do the streams swap.',
        'Befund A1: Beim Training werden die Ventile übersprungen. Erst beim echten Ausführen tauschen die Ströme.'],
      ['A1: Transformer::forward runs stream A fully, then stream B, then averages (transformer.rs:184-215, 282-295). Only forward_prefill and forward_decode apply the gates.',
        'A1: Transformer::forward rechnet erst Strom A ganz, dann Strom B und mittelt dann (transformer.rs:184-215, 282-295). Nur forward_prefill und forward_decode wenden die Tore an.'],
    ),
  },
  {
    camera: 'L13.gate', highlight: ['L13.gate'], action: 'free',
    text: tx(
      ['Finding A2: the valve weights sit near their starting values. So each valve passes on about half of the other stream, in {gateCount} layers.',
        'Befund A2: Die Gewichte der Ventile liegen nahe an ihren Startwerten. So gibt jedes Ventil etwa die Hälfte des anderen Stroms weiter, in {gateCount} Ebenen.'],
      ['A2: gate weights RMS 0.010 to 0.012, close to the init N(0, 0.01). At inference sigma(~0) is about 0.5. The training path never saw this mixing (see A1).',
        'A2: Gate-Gewichte mit RMS 0,010 bis 0,012, nahe an der Initialisierung N(0, 0,01). Bei der Inferenz ist sigma(~0) etwa 0,5. Nur der Inferenzpfad erzeugt diese Mischung (siehe A1).'],
    ),
  },
];
