import aboutJson from './about.json';

/** The project record behind the About: read from the repo docs by tools/build_about.py, never typed. */
export interface AboutRecord {
  schema: number;
  /** Context length in tokens (MODEL_CARD.md). */
  context: number;
  training: { epoch: number; loss_avg: number; loss_best: number; log_date: string; source: string };
  surgeries: {
    depth: number;
    cord: number;
    from_layers: number;
    to_layers: number;
    last: { id: string; from_layers: number; to_layers: number; date: string };
    source: string;
  };
  links: { repo: string; huggingface: string };
}

export const ABOUT: AboutRecord = aboutJson as AboutRecord;
