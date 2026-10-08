export type Campaign = {
  id: number;
  name: string;
  is_active: boolean;
};

export type DashboardMetrics = {
  assignment_count: number;
  submitted_count: number;
  completion_rate: number;
  awaiting_submission_count: number;
  not_started_count: number;
  in_progress_count: number;
  overdue_count: number;
  overdue_forms_count: number;
  upcoming_reviews_count: number;
  next_review_date: string | null;
};

export type DashboardForm = {
  form_id: number;
  name: string;
  audience: string;
  submitted_count: number;
  assignment_count: number;
  due_date: string | null;
  overdue_count: number;
};

export type DashboardParticipant = {
  user_id: number;
  name: string;
  email: string;
  profile_image_url: string | null;
  role_name: string;
  groups: string[];
  evaluations_left: number;
};

export type DashboardUpcomingDeadline = {
  campaign_id: number;
  name: string;
  deadline_type: 'Starts' | 'Ends';
  date: string;
};

export type DashboardResponse = {
  campaigns: Campaign[];
  selected_campaign_id: number | null;
  metrics: DashboardMetrics | null;
  forms: DashboardForm[];
  participants: DashboardParticipant[];
  upcoming_deadlines: DashboardUpcomingDeadline[];
};
