import { t } from '../ui/prefs';
import { TOUR_IDS } from '../ui/strings';
import type { Tour, TourId, TourStep } from './engine';
import { meetSteps } from './meet';
import { followSteps } from './follow';
import { threeSteps } from './three_experts';
import { attentionSteps } from './attention';
import { ternarySteps } from './ternary';
import { streamsSteps } from './two_streams';
import { predictionSteps } from './embed_to_prediction';

const STEPS: Partial<Record<TourId, TourStep[]>> = {
  meet: meetSteps,
  follow: followSteps,
  three: threeSteps,
  attention: attentionSteps,
  ternary: ternarySteps,
  streams: streamsSteps,
  prediction: predictionSteps,
};

/** The tours in spec §4.9 order. Titles follow the UI language (strings.ts `tour.<id>`). */
export const TOURS: Tour[] = TOUR_IDS.filter((id) => STEPS[id]).map((id) => ({
  id,
  get title(): string { return t(`tour.${id}`); },
  steps: STEPS[id]!,
}));

export const tourOf = (id: TourId): Tour | undefined => TOURS.find((x) => x.id === id);
