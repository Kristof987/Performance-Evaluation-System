export type HrInsightTip = {
  id: string;
  category: string;
  title: string;
  description: string;
  sourceLabel?: string;
  sourceUrl?: string;
};

export const hrInsightTips: HrInsightTip[] = [
  {
    id: 'observable-behaviors',
    category: 'Feedback quality',
    title: 'Make feedback easier to act on',
    description:
      'Ask reviewers to describe observable behaviors and their impact instead of relying on personality-based judgments.',
  },
  {
    id: 'rating-consistency',
    category: 'Rating consistency',
    title: 'Calibrate before reviewing results',
    description:
      'Compare rating patterns across groups before sharing results so outliers can be checked for inconsistent interpretation.',
  },
  {
    id: 'review-preparation',
    category: 'Review preparation',
    title: 'Reduce last-minute follow-ups',
    description:
      'Confirm participant lists and role relationships before launch to prevent missing assignments during the campaign window.',
  },
  {
    id: 'development-planning',
    category: 'Employee development',
    title: 'Connect feedback to next steps',
    description:
      'After results are reviewed, translate recurring themes into concrete development actions with clear owners and timelines.',
  },
];
