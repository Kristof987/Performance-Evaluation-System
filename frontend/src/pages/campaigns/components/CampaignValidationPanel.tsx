import { AlertCircle, ArrowUpRight } from 'lucide-react';
import { ApiAccessError } from '../../../auth/authenticated-api';
import { CampaignRequestError } from '../campaign.api';
import type { CampaignEvaluationMatrix, CampaignEvaluationRules, CampaignGroups, CampaignSelfEvaluations } from '../campaign.types';
import './CampaignValidationPanel.css';

export type CampaignIssueSection = 'groups' | 'rules' | 'self' | 'matrix' | 'dates';
export type CampaignIssue = { message: string; section?: CampaignIssueSection; groupId?: number };
export type CampaignFeedback = {
  kind: 'validation' | 'network' | 'authorization' | 'server';
  title: string;
  description: string;
  issues: CampaignIssue[];
};

type Context = {
  groups: CampaignGroups;
  rules: CampaignEvaluationRules;
  matrix: CampaignEvaluationMatrix;
  selfEvaluations: CampaignSelfEvaluations;
};

function formatIssue(source: string, context: Context): CampaignIssue {
  const raw = source.trim().replace(/[.\s]+$/, '');
  const groupNames = new Map(context.groups.availableGroups.map((group) => [group.id, group.name]));
  const roleNames = new Map(context.rules.groups.flatMap((group) => group.rolePairs.flatMap((pair) => [
    [pair.evaluatorRoleId, pair.evaluatorRoleName] as const,
    [pair.evaluateeRoleId, pair.evaluateeRoleName] as const,
  ])));
  const employeeNames = new Map(context.matrix.groups.flatMap((group) => group.employees.map((person) => [person.id, person.name] as const)));
  for (const group of context.matrix.groups) {
    for (const person of group.employees) roleNames.set(person.roleId, person.roleName);
  }
  for (const person of context.selfEvaluations.participants) employeeNames.set(person.employeeId, person.name);
  const formNames = new Map([...context.rules.forms, ...context.selfEvaluations.forms].map((form) => [form.id, form.name] as const));
  const numericGroupId = Number(/\bgroup\s+#?(\d+)\b/i.exec(raw)?.[1]);
  const namedGroupId = context.groups.availableGroups.find((group) => raw.startsWith(`${group.name}:`))?.id;
  const groupId = Number.isFinite(numericGroupId) && numericGroupId > 0 ? numericGroupId : namedGroupId;
  const missingRolePair = /^Group\s+#?(\d+)\s+lacks rule for roles\s+(\d+)\s*\/\s*(\d+)$/i.exec(raw);

  const known: Record<string, string> = {
    'Select at least one evaluation assignment': 'Assign at least one evaluation in the Evaluation Matrix',
    'Select at least one campaign group': 'Select at least one campaign group',
    'Selected groups need active employees': 'Add active participants to a selected group',
    'Campaign end must be later than its start': 'Set an end date and time after the start',
    'Campaign start must be strictly in the future': 'Choose a future start date and time',
    'Scheduled campaigns must start in the future': 'Choose a future start date and time',
    'Scheduled campaigns require an end timestamp': 'Set an end date and time before scheduling',
  };
  const message = (missingRolePair
    ? `${groupNames.get(Number(missingRolePair[1])) ?? `Group ${missingRolePair[1]}`}: No questionnaire assigned for ${roleNames.get(Number(missingRolePair[2])) ?? `Role ${missingRolePair[2]}`} → ${roleNames.get(Number(missingRolePair[3])) ?? `Role ${missingRolePair[3]}`}`
    : known[raw] ?? raw)
    .replace(/\bgroup\s+#?(\d+)\b/gi, (match, id: string) => groupNames.has(Number(id)) ? `group “${groupNames.get(Number(id))}”` : match)
    .replace(/\broles?\s+#?(\d+)\s*\/\s*#?(\d+)\b/gi, (match, evaluatorId: string, evaluateeId: string) =>
      roleNames.has(Number(evaluatorId)) && roleNames.has(Number(evaluateeId))
        ? `${roleNames.get(Number(evaluatorId))} → ${roleNames.get(Number(evaluateeId))}` : match)
    .replace(/\brole\s+#?(\d+)\s*(?:->|to|evaluates)\s*(?:role\s+)?#?(\d+)\b/gi, (match, evaluatorId: string, evaluateeId: string) =>
      roleNames.has(Number(evaluatorId)) && roleNames.has(Number(evaluateeId))
        ? `role “${roleNames.get(Number(evaluatorId))}” evaluating role “${roleNames.get(Number(evaluateeId))}”` : match)
    .replace(/\brole\s+#?(\d+)\b/gi, (match, id: string) => roleNames.has(Number(id)) ? `role “${roleNames.get(Number(id))}”` : match)
    .replace(/\bemployee\s+#?(\d+)\b/gi, (match, id: string) => employeeNames.has(Number(id)) ? `employee “${employeeNames.get(Number(id))}”` : match)
    .replace(/\bform\s+#?(\d+)\b/gi, (match, id: string) => formNames.has(Number(id)) ? `form “${formNames.get(Number(id))}”` : match);

  const section: CampaignIssueSection | undefined = /\b(start|end|date|time|timestamp|deadline)\b/i.test(raw) ? 'dates'
    : /self[- ]evaluation/i.test(raw) ? 'self'
      : /\b(form|questionnaire|role|rule)\b/i.test(raw) ? 'rules'
        : /\b(assignment|matrix|evaluator|evaluatee)\b/i.test(raw) ? 'matrix'
          : /\b(group|participant|member)\b/i.test(raw) ? 'groups' : undefined;
  return { message: `${message}.`, section, groupId };
}

export function campaignFeedbackFromError(error: unknown, action: 'schedule' | 'unschedule' | 'setup', context: Context): CampaignFeedback {
  if (error instanceof ApiAccessError) return {
    kind: 'authorization', title: error.status === 401 ? 'Sign in again' : 'You cannot change this campaign',
    description: error.status === 401 ? 'Your session could not be verified. Sign in again before retrying.' : 'Your account does not have permission to perform this action.', issues: [],
  };
  if (error instanceof Error && /access token/i.test(error.message)) return {
    kind: 'authorization', title: 'Sign in again',
    description: 'Your session could not be verified. Sign in again before retrying.', issues: [],
  };
  if (error instanceof CampaignRequestError && error.status >= 500) return {
    kind: 'server', title: 'Campaign could not be updated',
    description: 'The server could not complete this request. Your unsaved changes are still here; try again later.', issues: [],
  };
  if (!(error instanceof CampaignRequestError) && (error instanceof TypeError || error instanceof Error && /network|fetch/i.test(error.message))) return {
    kind: 'network', title: 'Connection interrupted',
    description: 'Could not reach Compass. Your unsaved changes are still here; check your connection and try again.', issues: [],
  };

  const detail = error instanceof CampaignRequestError ? error.message : '';
  if (/\b(traceback|sqlalchemy|integrityerror|stack trace)\b/i.test(detail)) return {
    kind: 'server', title: 'Campaign could not be updated',
    description: 'An unexpected server error occurred. Your unsaved changes are still here; try again later.', issues: [],
  };
  const match = /^(?:Invalid campaign configuration|Campaign configuration is invalid):\s*/i.exec(detail);
  const isValidation = !!match || error instanceof CampaignRequestError && action !== 'unschedule' && (
    error.status === 400 || error.status === 409 && /^(?:Select |Selected groups|Scheduled campaigns|Campaign (?:start|end)|(?:Start|End) timestamp|Group \d+|Employee \d+|Form \d+|Assignment \d+|At least |No form rule)/i.test(detail)
  );
  if (isValidation) {
    const issues = detail.slice(match?.[0].length ?? 0).split(';').map((part) => part.trim()).filter(Boolean).map((part) => formatIssue(part, context));
    return {
      kind: 'validation',
      title: action === 'schedule' ? 'Campaign isn’t ready to schedule' : 'Campaign setup needs attention',
      description: action === 'schedule' ? 'Complete the following before scheduling:' : 'Review these items before saving your setup:',
      issues: issues.length ? issues : [{ message: 'Review the campaign setup and try again.' }],
    };
  }
  return {
    kind: 'server', title: 'Campaign could not be updated',
    description: error instanceof CampaignRequestError && error.status === 404
      ? 'This campaign could not be found. It may have been deleted.'
      : error instanceof CampaignRequestError && error.status === 409
        ? 'The campaign may have changed since it was opened. Review its current status and try again.'
        : 'An unexpected error occurred. Your unsaved changes are still here; try again.',
    issues: [],
  };
}

export default function CampaignValidationPanel({ feedback, onNavigate }: {
  feedback: CampaignFeedback;
  onNavigate: (issue: CampaignIssue) => void;
}) {
  return (
    <section className={`campaign-validation-panel campaign-validation-${feedback.kind}`} role="alert" aria-label={feedback.title}>
      <AlertCircle className="campaign-validation-icon" size={21} strokeWidth={1.9} aria-hidden="true" />
      <div className="campaign-validation-content">
        <h2>{feedback.title}</h2>
        <p>{feedback.description}</p>
        {feedback.issues.length > 0 && <ul>{feedback.issues.map((issue, index) => (
          <li key={`${index}-${issue.message}`}>
            <span>{issue.message}</span>
            {issue.section && <button type="button" onClick={() => onNavigate(issue)}>
              Review issue <ArrowUpRight size={14} aria-hidden="true" />
            </button>}
          </li>
        ))}</ul>}
      </div>
    </section>
  );
}
