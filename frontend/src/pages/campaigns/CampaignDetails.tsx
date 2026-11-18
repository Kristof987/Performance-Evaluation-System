import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, BarChart3, ChevronDown, Grid2X2, Info, ListChecks, LockKeyhole, UserRound, UsersRound } from 'lucide-react';
import CampaignPage from './components/CampaignPage';
import CampaignStats from './components/CampaignStats';
import CampaignModal from './components/CampaignModal';
import CampaignForm from './components/CampaignForm';
import CampaignStatusBadge from './components/CampaignStatusBadge';
import CampaignValidationPanel, { type CampaignIssue, type CampaignIssueSection } from './components/CampaignValidationPanel';
import { useCampaignDetails } from './hooks/useCampaignDetails';
import { matrixGroupWithSelfLocks, matrixSelectedCount } from './matrix.utils';
import EvaluationMatrix from './components/EvaluationMatrix';
import { useAppAuth } from '../../auth/AppAuth';
import { usePageTitle } from '../../app/usePageTitle';
import { fetchDashboard } from '../hr-home/services/dashboardService';
import CampaignTimeline from './components/CampaignTimeline';
import CampaignSetupSummary, { type SetupSummaryItem } from './components/CampaignSetupSummary';
import CampaignEmails from '../completion-status/CampaignEmails';
import CampaignGroupPreview from './components/CampaignGroupPreview';
import { fetchPeople, type Employee } from '../people/people.api';
import { useConfirm } from '../../components/feedback/feedback-context';
import InlineMessage from '../../components/feedback/InlineMessage';
import Pending from '../../components/feedback/Pending';
import LoadingState from '../../components/feedback/LoadingState';
import { useDates, zoneLabel } from '../../app/dates';

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type SetupSection = 'groups' | 'questionnaires' | 'pairs' | 'self';

const UNSAVED_TAB_CONFIRM = {
  title: 'Go to Overview with unsaved changes?',
  message: 'Your setup changes stay on this page, but they’ll be lost if you leave or reload before they’re saved.',
  confirmLabel: 'Go to Overview',
};

/** "Saved, but couldn't refresh" and "state changed" messages are warnings; anything else that went wrong is an error. */
function messageTone(message: string) {
  return /, but |state changed|status changed/i.test(message) ? 'warning' : 'error';
}

export function CampaignDetails() {
  const dates = useDates();
  const { id } = useParams();
  const { state, getAccessToken } = useAppAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const canReadReports = state.status === 'authenticated' && state.user.permissions.includes('reports.read');
  const [activeMatrixGroupId, setActiveMatrixGroupId] = useState<number | null>(null);
  const [matrixMinimum, setMatrixMinimum] = useState('1');
  const [groupSearch, setGroupSearch] = useState('');
  const [peoplePreview, setPeoplePreview] = useState<{ campaignId: string; employees: Employee[] } | null>(null);
  const [peopleError, setPeopleError] = useState('');
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [expandedRuleGroups, setExpandedRuleGroups] = useState<Set<number>>(() => new Set());
  const [selfExpanded, setSelfExpanded] = useState(true);
  const initializedRuleGroups = useRef<string | null>(null);
  const [confirmGroupRemoval, setConfirmGroupRemoval] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'setup' ? 'setup' : 'overview';
  const requestedSection = searchParams.get('section');
  const setupSection: SetupSection = requestedSection === 'questionnaires' ? 'questionnaires' : requestedSection === 'pairs' ? 'pairs' : requestedSection === 'self' || requestedSection === 'self-evaluations' ? 'self' : 'groups';
  const lastSetupSection = useRef<SetupSection>(setupSection);
  const previousTab = useRef(tab);
  const [setupTarget, setSetupTarget] = useState<CampaignIssueSection | null>(() => requestedSection === 'pairs' ? 'matrix' : requestedSection === 'participants' || requestedSection === 'groups' ? 'groups' : requestedSection === 'self-evaluations' ? 'self' : null);
  const [progressBreakdown, setProgressBreakdown] = useState<{ campaignId: string; total: number; submitted: number; inProgress: number } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRoot = useRef<HTMLDivElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const {
    canManageCampaigns,
    campaign,
    form,
    isEditOpen,
    isCampaignLoading,
    isSavingCampaign,
    campaignError,
    saveMessage,
    actionMessage,
    configurationFeedback,
    isChangingSchedule,
    confirmationAction,
    operationalMetrics,
    confirmationError,
    isLoadingMetrics,
    isChangingLifecycle,
    deletionEligibility,
    eligibilityError,
    isLoadingEligibility,
    destructiveAction,
    destructiveError,
    isChangingArchive,
    openDestructiveConfirmation,
    closeDestructiveConfirmation,
    handleDestructiveAction,
    openLifecycleConfirmation,
    closeLifecycleConfirmation,
    handleLifecycleAction,
    isSavingSetup,
    isSetupPreviewLoading,
    setupPreviewError,
    handleUpdateSetup,
    handleScheduleAction,
    campaignGroups,
    evaluationRules,
    evaluationMatrix,
    selfEvaluations,
    persistedEvaluationRules,
    persistedEvaluationMatrix,
    persistedSelfEvaluations,
    selectedSelfForms,
    selfMessage,
    isSavingSelf,
    hasSelfChanges,
    updateSelfForm,
    discardSelfForms,
    handleUpdateSelfForms,
    selectedGroupIds,
    selectedRuleFormIds,
    selectedMatrixAssignments,
    groupsMessage,
    rulesMessage,
    matrixMessage,
    matrixSaveError,
    isSavingGroups,
    isSavingRules,
    isSavingMatrix,
    hasEditChanges,
    hasGroupChanges,
    hasRuleChanges,
    hasMatrixChanges,
    formProgress,
    matrixReadiness,
    matrixPlanningReadiness,
    isIssuingPlanned,
    issuanceMessage,
    handleIssuePlanned,
    openEdit,
    closeEdit,
    updateForm,
    toggleGroup,
    discardGroups,
    updateRuleForm,
    toggleMatrixAssignment,
    applyMatrixSelectAll,
    applyMatrixSelfEvaluations,
    applyMatrixMinimumReviewers,
    applyMatrixDeleteAll,
    discardMatrix,
    discardRules,
    handleUpdateGroups,
    handleUpdateRules,
    handleUpdateMatrix,
    handleUpdateCampaign,
  } = useCampaignDetails(id);
  usePageTitle(campaign?.name, 'Campaigns');
  const canEdit = canManageCampaigns && !campaign?.isArchived &&
    (campaign?.status === 'draft' || campaign?.status === 'scheduled' || campaign?.status === 'active');
  const canPlanPairs = canManageCampaigns && !campaign?.isArchived && campaign?.status !== 'closed';
  const canAssignForms = canManageCampaigns && !campaign?.isArchived && campaign?.status !== 'closed';
  const activeMatrixGroup = evaluationMatrix.groups.find(
    (group) => group.groupId === activeMatrixGroupId,
  ) ?? evaluationMatrix.groups[0];
  const validFormIds = new Set(evaluationRules.forms.map((form) => form.id));
  const issuedSelfIds = new Set(evaluationMatrix.groups.flatMap((group) => group.assignments.filter((assignment) => assignment.issued && assignment.evaluatorId === assignment.evaluateeId).map((assignment) => assignment.evaluatorId)));
  const groupsWithIssuedAssignments = new Set(evaluationMatrix.groups.filter((group) => group.assignments.some((assignment) => assignment.issued)).map((group) => group.groupId));
  const removedGroupIds = campaignGroups.assignedGroupIds.filter((groupId) => !selectedGroupIds.includes(groupId));
  const removedGroupNames = removedGroupIds.map((groupId) =>
    campaignGroups.availableGroups.find((group) => group.id === groupId)?.name ?? `Group ${groupId}`);
  const removalRules = campaign?.status === 'scheduled' ? persistedEvaluationRules : evaluationRules;
  const removalMatrix = campaign?.status === 'scheduled' ? persistedEvaluationMatrix : evaluationMatrix;
  const removalSelf = campaign?.status === 'scheduled' ? persistedSelfEvaluations : selfEvaluations;
  const removedRules = removalRules.groups.filter((group) => removedGroupIds.includes(group.groupId))
    .reduce((count, group) => count + group.rolePairs.filter((pair) => pair.formId != null).length, 0);
  const removedAssignments = removalMatrix.groups.filter((group) => removedGroupIds.includes(group.groupId))
    .flatMap((group) => group.assignments);
  const remainingParticipantIds = new Set(evaluationMatrix.groups.filter((group) => selectedGroupIds.includes(group.groupId))
    .flatMap((group) => group.employees.map((person) => person.id)));
  const removedSelfForms = removalSelf.participants.filter((person) =>
    person.formId != null && !remainingParticipantIds.has(person.employeeId)).length;
  const setupDirty = hasGroupChanges || hasRuleChanges || hasMatrixChanges || hasSelfChanges;
  const groupSaveBlocked = hasRuleChanges || hasMatrixChanges || hasSelfChanges;
  const setupSaveBusy = isSavingGroups || isSavingMatrix || isSavingRules || isSavingSelf || isSavingSetup || isIssuingPlanned;
  const pendingChanges = setupDirty || setupSaveBusy || (isEditOpen && hasEditChanges);
  const matrixAutoSaveBlocked = hasSelfChanges || hasGroupChanges;
  const validSelfForms = new Set(selfEvaluations.forms.map((item) => item.id));
  const assignedSelfCount = selfEvaluations.participants.filter((person) => validSelfForms.has(selectedSelfForms[person.employeeId] ?? -1)).length;
  const selectedPairs = matrixSelectedCount(selectedMatrixAssignments);
  const savedPairCount = new Set(evaluationMatrix.groups.flatMap((group) => group.assignments.map((assignment) => `${assignment.evaluatorId}:${assignment.evaluateeId}`))).size;
  const unissuedAssignments = evaluationMatrix.groups.flatMap((group) => group.assignments)
    .filter((assignment) => !assignment.issued && !assignment.isCompleted && !assignment.hasAnswers);
  const unissuedPairCount = new Set(unissuedAssignments.map((assignment) => `${assignment.evaluatorId}:${assignment.evaluateeId}`)).size;
  const missingPeerPairCount = new Set(unissuedAssignments.filter((assignment) => assignment.evaluatorId !== assignment.evaluateeId && assignment.formId == null).map((assignment) => `${assignment.evaluatorId}:${assignment.evaluateeId}`)).size;
  const missingSelfPairCount = new Set(unissuedAssignments.filter((assignment) => assignment.evaluatorId === assignment.evaluateeId && assignment.formId == null).map((assignment) => assignment.evaluatorId)).size;
  const missingPlannedForms = formProgress.missing > 0 || missingPeerPairCount > 0 || missingSelfPairCount > 0;
  const displayedRelationships = evaluationRules.groups.reduce((total, group) => total + group.rolePairs.length, 0);
  const ruleGroupKey = evaluationRules.groups.map((group) => group.groupId).join(',');

  useEffect(() => {
    if (tab !== 'setup' || setupSection !== 'questionnaires' || !campaign || !evaluationRules.groups.length) return;
    const key = `${campaign.id}:${ruleGroupKey}`;
    if (initializedRuleGroups.current === key) return;
    const previous = initializedRuleGroups.current;
    initializedRuleGroups.current = key;
    const first = formProgress.groups.find((group) => group.missing > 0)?.groupId ?? evaluationRules.groups[0].groupId;
    setExpandedRuleGroups((current) => {
      const kept = [...current].filter((groupId) => evaluationRules.groups.some((group) => group.groupId === groupId));
      return previous?.startsWith(`${campaign.id}:`) && kept.length ? new Set(kept) : new Set([first]);
    });
  }, [tab, setupSection, campaign?.id, ruleGroupKey, formProgress.groups]);
  const previewEmployees = peoplePreview && campaign && peoplePreview.campaignId === campaign.id ? peoplePreview.employees : null;
  const selectedPreviewGroups = campaignGroups.availableGroups.filter((group) => selectedGroupIds.includes(group.id));
  const activeGroupCounts = new Map<number, number>();
  for (const employee of previewEmployees ?? []) {
    if (employee.status !== 'Active') continue;
    for (const groupId of employee.groupIds) activeGroupCounts.set(groupId, (activeGroupCounts.get(groupId) ?? 0) + 1);
  }

  useEffect(() => {
    if (tab !== 'setup' || setupSection !== 'groups' || !campaign || !getAccessToken || peoplePreview?.campaignId === campaign.id) return;
    const controller = new AbortController();
    setPeopleLoading(true);
    setPeopleError('');
    fetchPeople(getAccessToken, controller.signal)
      .then((people) => { if (!controller.signal.aborted) setPeoplePreview({ campaignId: campaign.id, employees: people.employees }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setPeopleError(error instanceof Error ? error.message : 'Employee preview could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setPeopleLoading(false); });
    return () => controller.abort();
  }, [tab, setupSection, campaign?.id, getAccessToken, peoplePreview?.campaignId]);

  useEffect(() => {
    if (!actionsOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!actionsRoot.current?.contains(event.target as Node)) setActionsOpen(false);
    }
    function onFocusIn(event: FocusEvent) {
      if (!actionsRoot.current?.contains(event.target as Node)) setActionsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setActionsOpen(false); actionsTrigger.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = Array.from(actionsRoot.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
      options[next].focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('keydown', onKeyDown); };
  }, [actionsOpen]);
  const previewPending = campaign?.status === 'scheduled' && (isSetupPreviewLoading || !!setupPreviewError);
  const groupNames = selectedGroupIds.map((groupId) => campaignGroups.availableGroups.find((group) => group.id === groupId)?.name ?? `Group ${groupId}`);
  const setupSummaryItems: SetupSummaryItem[] = [
    {
      section: 'groups', title: 'Groups', value: `${selectedGroupIds.length} ${selectedGroupIds.length === 1 ? 'group' : 'groups'} selected`,
      description: groupNames.length ? groupNames.join(', ') : 'No groups selected',
      status: hasGroupChanges ? 'Unsaved' : previewPending ? 'Checking' : selectedGroupIds.length && matrixReadiness !== 'empty' ? 'Complete' : 'Incomplete',
      tone: !hasGroupChanges && !previewPending && selectedGroupIds.length > 0 && matrixReadiness !== 'empty' ? 'complete' : 'neutral',
    },
    {
      section: 'pairs', title: 'Evaluation pairs', value: `${selectedPairs} ${selectedPairs === 1 ? 'pair' : 'pairs'} selected`,
      description: 'These employees evaluate each other.',
      status: hasMatrixChanges ? 'Unsaved' : previewPending ? 'Checking' : matrixPlanningReadiness === 'ready' && selectedPairs > 0 ? 'Complete' : selectedPairs ? 'Needs review' : 'Not set',
      tone: !hasMatrixChanges && !previewPending && matrixPlanningReadiness === 'ready' && selectedPairs > 0 ? 'complete' : 'neutral',
    },
    {
      section: 'questionnaires', title: 'Questionnaire assignments',
      value: previewPending ? 'Checking assignments' : formProgress.required ? `${formProgress.configured} of ${formProgress.required} configured` : 'No required relationships',
      description: previewPending ? 'Checking required role relationships.' : formProgress.missing ? `${countLabel(formProgress.missing, 'role relationship')} still ${formProgress.missing === 1 ? 'needs' : 'need'} a questionnaire.` : formProgress.required ? 'Required relationships have questionnaires.' : 'Unused role relationships are optional.',
      status: previewPending ? 'Checking' : formProgress.missing ? 'Incomplete' : hasRuleChanges ? 'Unsaved' : formProgress.required > 0 ? 'Complete' : 'Optional',
      tone: !previewPending && formProgress.missing > 0 ? 'incomplete' : !previewPending && !hasRuleChanges && formProgress.required > 0 ? 'complete' : 'neutral',
    },
    {
      section: 'self', title: 'Self-evaluations',
      value: previewPending ? 'Checking participants' : `${assignedSelfCount} of ${selfEvaluations.participants.length} assigned`,
      description: 'Optional per participant.', status: 'Optional', tone: 'optional',
    },
  ];

  useEffect(() => {
    if (tab !== 'overview' || !campaign || !getAccessToken) return;
    const controller = new AbortController();
    setProgressBreakdown(null);
    fetchDashboard(getAccessToken, Number(campaign.id), controller.signal)
      .then((dashboard) => {
        if (controller.signal.aborted) return;
        const metrics = dashboard.metrics;
        if (dashboard.selected_campaign_id === Number(campaign.id) && metrics &&
            metrics.assignment_count === campaign.sent && metrics.submitted_count === campaign.done) {
          setProgressBreakdown({ campaignId: campaign.id, total: metrics.assignment_count, submitted: metrics.submitted_count, inProgress: metrics.in_progress_count });
        }
      })
      .catch(() => { if (!controller.signal.aborted) setProgressBreakdown(null); });
    return () => controller.abort();
  }, [tab, campaign?.id, campaign?.sent, campaign?.done, getAccessToken]);

  function changeTab(next: 'overview' | 'setup', section: SetupSection = lastSetupSection.current) {
    if (setupSaveBusy) return false;
    if (setupDirty && !groupsMessage && !matrixSaveError && !rulesMessage && !selfMessage) return false;
    if (next === tab && (next !== 'setup' || section === setupSection && requestedSection === section)) return true;
    if (tab === 'setup' && next === 'overview' && pendingChanges) {
      void confirm(UNSAVED_TAB_CONFIRM).then((ok) => { if (ok) showOverview(); });
      return false;
    }
    if (next === 'setup') lastSetupSection.current = section;
    previousTab.current = next;
    setSearchParams((current) => {
      const updated = new URLSearchParams(current);
      if (next === 'setup') { updated.set('tab', 'setup'); updated.set('section', section); }
      else { updated.delete('tab'); updated.delete('section'); }
      return updated;
    });
    return true;
  }

  function openSetupSection(section: CampaignIssueSection) {
    if (section === 'dates') { openEdit(); return; }
    if (section === 'rules') {
      const missing = formProgress.groups.find((group) => group.firstMissing);
      if (missing) setExpandedRuleGroups((current) => new Set(current).add(missing.groupId));
    }
    const destination: SetupSection = section === 'rules' ? 'questionnaires' : section === 'matrix' ? 'pairs' : section;
    if (changeTab('setup', destination)) setSetupTarget(section);
  }

  function showOverview() {
    previousTab.current = 'overview';
    setSearchParams((current) => {
      const updated = new URLSearchParams(current);
      updated.delete('tab'); updated.delete('section');
      return updated;
    });
  }

  function confirmLeaveCampaign(event: MouseEvent<HTMLAnchorElement>) {
    if (!pendingChanges) return;
    event.preventDefault();
    const destination = event.currentTarget.getAttribute('href') ?? '/campaigns';
    void confirm({ title: 'Leave with unsaved changes?', message: 'Your campaign changes haven’t been saved and will be discarded.', confirmLabel: 'Discard and leave', tone: 'danger' })
      .then((ok) => { if (ok) navigate(destination); });
  }

  useEffect(() => {
    if (previousTab.current === tab) return;
    if (previousTab.current === 'setup' && pendingChanges) {
      // Back/forward left Setup: stay there until the user decides.
      setSearchParams((current) => {
        const updated = new URLSearchParams(current);
        updated.set('tab', 'setup');
        updated.set('section', lastSetupSection.current);
        return updated;
      }, { replace: true });
      void confirm(UNSAVED_TAB_CONFIRM).then((ok) => { if (ok) showOverview(); });
      return;
    }
    previousTab.current = tab;
    if (tab === 'setup') lastSetupSection.current = setupSection;
  }, [tab, setupSection, pendingChanges, setSearchParams]);

  useEffect(() => {
    if (tab === 'setup') lastSetupSection.current = setupSection;
  }, [tab, setupSection]);

  useEffect(() => {
    if (tab === 'setup' && (requestedSection === 'pairs' || requestedSection === 'groups' || requestedSection === 'participants' || requestedSection === 'self-evaluations')) {
      setSetupTarget(requestedSection === 'pairs' ? 'matrix' : requestedSection === 'self-evaluations' ? 'self' : 'groups');
    }
  }, [tab, requestedSection]);

  useEffect(() => {
    if (tab !== 'setup' || !setupTarget || !campaign) return;
    const sectionIds: Partial<Record<CampaignIssueSection, string>> = {
      groups: 'campaign-groups', rules: 'campaign-form-assignment-rules',
      self: 'campaign-self-evaluations', matrix: 'campaign-evaluation-matrix',
    };
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(sectionIds[setupTarget] ?? '');
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      section?.focus({ preventScroll: true });
      setSetupTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, setupTarget, campaign?.id]);

  useEffect(() => {
    if (!pendingChanges) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [pendingChanges]);

  useEffect(() => {
    if (!canEdit || !hasGroupChanges || isSavingGroups || isSavingSetup || isSetupPreviewLoading ||
        groupSaveBlocked || groupsMessage || confirmGroupRemoval) return;
    const timer = window.setTimeout(() => {
      if (removedGroupIds.length && (campaign?.status === 'draft' || campaign?.status === 'scheduled')) {
        setConfirmGroupRemoval(true);
      } else {
        void handleUpdateGroups();
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [canEdit, hasGroupChanges, isSavingGroups, isSavingSetup, isSetupPreviewLoading, groupSaveBlocked,
    groupsMessage, confirmGroupRemoval, removedGroupIds.length, campaign?.status, handleUpdateGroups]);

  useEffect(() => {
    if (!canPlanPairs || !hasMatrixChanges || matrixPlanningReadiness !== 'ready' || matrixAutoSaveBlocked ||
        isSavingMatrix || isSavingGroups || isSavingSetup || isSavingRules || isSavingSelf || isIssuingPlanned ||
        isSetupPreviewLoading || setupPreviewError || matrixSaveError) return;
    const timer = window.setTimeout(() => { void handleUpdateMatrix(); }, 500);
    return () => window.clearTimeout(timer);
  }, [canPlanPairs, hasMatrixChanges, matrixPlanningReadiness, matrixAutoSaveBlocked,
    isSavingMatrix, isSavingGroups, isSavingSetup, isSavingRules, isSavingSelf, isIssuingPlanned,
    isSetupPreviewLoading, setupPreviewError, matrixSaveError, handleUpdateMatrix]);

  useEffect(() => {
    if (!canAssignForms || !hasRuleChanges || setupSaveBusy || hasGroupChanges || hasMatrixChanges ||
        isSetupPreviewLoading || setupPreviewError || rulesMessage) return;
    const timer = window.setTimeout(() => { void handleUpdateRules(); }, 500);
    return () => window.clearTimeout(timer);
  }, [canAssignForms, hasRuleChanges, setupSaveBusy, hasGroupChanges, hasMatrixChanges,
    isSetupPreviewLoading, setupPreviewError, rulesMessage, handleUpdateRules]);

  useEffect(() => {
    if (!canEdit || !hasSelfChanges || setupSaveBusy || hasGroupChanges || hasMatrixChanges ||
        isSetupPreviewLoading || setupPreviewError || selfMessage) return;
    const timer = window.setTimeout(() => { void handleUpdateSelfForms(); }, 500);
    return () => window.clearTimeout(timer);
  }, [canEdit, hasSelfChanges, setupSaveBusy, hasGroupChanges, hasMatrixChanges,
    isSetupPreviewLoading, setupPreviewError, selfMessage, handleUpdateSelfForms]);

  function retryGroupSave() {
    if (removedGroupIds.length && (campaign?.status === 'draft' || campaign?.status === 'scheduled')) {
      setConfirmGroupRemoval(true);
    } else {
      handleUpdateGroups();
    }
  }

  function navigateToIssue(issue: CampaignIssue) {
    if (issue.section === 'dates') {
      if (!isEditOpen) openEdit();
      return;
    }
    if (issue.section === 'rules' && issue.groupId) {
      const groupId = issue.groupId;
      setExpandedRuleGroups((current) => new Set(current).add(groupId));
    }
    if (issue.section) openSetupSection(issue.section);
  }

  function reviewMissingAssignments() {
    openSetupSection('rules');
  }

  if (isCampaignLoading) {
    return (
      <CampaignPage>
        <div className="campaign-view">
          <LoadingState variant="page" label="Loading campaign" />
        </div>
      </CampaignPage>
    );
  }

  if (campaign === null) {
    return (
      <CampaignPage>
        <div className="campaign-view">
          <p>{campaignError || 'Campaign not found.'}</p>
        </div>
      </CampaignPage>
    );
  }

  const matrixNotice = <>
    {!!evaluationMatrix.issuanceErrors?.length && <InlineMessage tone="warning" className="campaign-inline-message"><strong>Some planned evaluations couldn’t be issued:</strong><ul>{evaluationMatrix.issuanceErrors.map((error, index) => <li key={index}>{error}</li>)}</ul></InlineMessage>}
    {matrixPlanningReadiness !== 'ready' && <div className="campaign-matrix-prerequisite" role="status">
      <strong>{matrixPlanningReadiness === 'empty' ? 'No employees available for evaluation planning' : campaign.status === 'scheduled' ? 'Select campaign groups first' : 'Save campaign groups first'}</strong>
      <p>{matrixPlanningReadiness === 'empty' ? 'Selected groups need active employees before evaluation pairs can be planned.' : campaign.status === 'scheduled' ? 'Select a campaign group to plan evaluation pairs.' : 'Select and save a campaign group to plan evaluation pairs.'}</p>
    </div>}
    {matrixPlanningReadiness === 'ready' && missingPlannedForms && <div className="campaign-matrix-requirements" role="status"><div><strong>Questionnaires needed before issuance</strong><p>{missingPeerPairCount > 0 ? `${countLabel(missingPeerPairCount, 'selected peer pair')} ${missingPeerPairCount === 1 ? 'needs' : 'need'} a role-based questionnaire.` : formProgress.missing > 0 ? `${countLabel(formProgress.missing, 'required role relationship')} ${formProgress.missing === 1 ? 'needs' : 'need'} a valid questionnaire.` : null}{(missingPeerPairCount > 0 || formProgress.missing > 0) && missingSelfPairCount > 0 && ' '}{missingSelfPairCount > 0 && `${countLabel(missingSelfPairCount, 'selected self-evaluation pair')} ${missingSelfPairCount === 1 ? 'needs' : 'need'} an individual questionnaire.`}</p></div><div className="campaign-matrix-requirements-actions">{(missingPeerPairCount > 0 || formProgress.missing > 0) && <button className="btn btn-secondary" type="button" onClick={reviewMissingAssignments}>{canAssignForms ? 'Configure questionnaires' : 'View questionnaire assignments'}</button>}{missingSelfPairCount > 0 && <button className="btn btn-secondary" type="button" onClick={() => openSetupSection('self')}>Configure self-evaluations</button>}</div></div>}
  </>;

  return (
    <CampaignPage>
      <div className="campaign-view campaign-detail-view">
        <header className="campaign-heading campaign-detail-heading">
          <div>
            <Link className="campaign-detail-breadcrumb" to="/campaigns" onClick={confirmLeaveCampaign}><ArrowLeft size={15} aria-hidden="true" /> All campaigns</Link>
            <h1>{campaign.name}</h1>
            <div className="campaign-detail-meta">
              <CampaignStatusBadge status={campaign.status} />
              {campaign.isArchived && <span className="campaign-archived-label"> Archived</span>}
              <span>{dates.dateTime(campaign.startAt)} - {campaign.endAt ? dates.dateTime(campaign.endAt) : 'No deadline'}</span>
              {(campaign.activationError || campaign.lifecycleError) && <span className="campaign-detail-warning" role="status">Transition needs attention</span>}
              <details className="campaign-lifecycle-details">
              <summary><Info size={14} aria-hidden="true" /> Details</summary>
              <div className="campaign-lifecycle-popover">
                <h2>Lifecycle details</h2>
                <dl className="campaign-lifecycle-facts">
                  <div><dt>Status on record</dt><dd><CampaignStatusBadge status={campaign.status} /></dd></div>
                  {campaign.status === 'paused' && <div><dt>Previous status</dt><dd>{campaign.pausedFromStatus ? <CampaignStatusBadge status={campaign.pausedFromStatus} /> : 'Not recorded'}</dd></div>}
                  <div><dt>Start date</dt><dd>{dates.dateTime(campaign.startAt)} ({zoneLabel(dates.settings)})</dd></div>
                  <div><dt>End date</dt><dd>{campaign.endAt ? `${dates.dateTime(campaign.endAt)} (${zoneLabel(dates.settings)})` : 'No deadline'}</dd></div>
                  <div><dt>Activation history</dt><dd className={campaign.activationError ? 'campaign-activation-failed' : undefined}>
                    {campaign.status === 'scheduled' ? campaign.activationError ? 'Failed, awaiting retry' : 'Waiting for start date' : campaign.status === 'draft' ? 'Not scheduled' : 'Previously activated'}
                  </dd></div>
                  {campaign.activationRetryAt && campaign.status === 'scheduled' && <div><dt>Next activation retry</dt><dd>{dates.dateTime(campaign.activationRetryAt)} ({zoneLabel(dates.settings)})</dd></div>}
                  {campaign.activationError && campaign.activationAttempts > 0 && campaign.status === 'scheduled' && <div><dt>Activation attempts</dt><dd>{campaign.activationAttempts}</dd></div>}
                  {campaign.lifecycleRetryAt && campaign.lifecycleError && campaign.status === 'active' && <div><dt>Next review transition retry</dt><dd>{dates.dateTime(campaign.lifecycleRetryAt)} ({zoneLabel(dates.settings)})</dd></div>}
                  {campaign.lastTransitionAt && <div><dt>Last status change</dt><dd>{dates.dateTime(campaign.lastTransitionAt)} ({zoneLabel(dates.settings)})</dd></div>}
                </dl>
                {campaign.activationError && campaign.status === 'scheduled' && <InlineMessage tone="error" className="campaign-inline-message"><strong>Activation couldn’t complete</strong><p>{campaign.activationError}</p><p>Review the error and correct the campaign setup or schedule. Activation retries automatically.</p></InlineMessage>}
                {campaign.lifecycleError && campaign.status === 'active' && <InlineMessage tone="error" className="campaign-inline-message"><strong>Review transition couldn’t complete</strong><p>{campaign.lifecycleError}</p><p>Review the error and correct the issue. The transition retries automatically.</p></InlineMessage>}
              </div>
            </details>
            </div>
          </div>
          <div className="campaign-heading-actions">
            {(canEdit || canManageCampaigns && (campaign.status === 'scheduled' || campaign.status === 'active' || campaign.status === 'review' || campaign.status === 'paused' || campaign.status === 'closed' || campaign.status === 'draft')) && <div className="campaign-more-actions" ref={actionsRoot}>
              <button className="btn btn-secondary campaign-more-trigger" ref={actionsTrigger} type="button" aria-haspopup="menu" aria-expanded={actionsOpen} aria-controls={actionsOpen ? 'campaign-more-menu' : undefined} onClick={() => setActionsOpen((open) => !open)} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key) && !actionsOpen) { event.preventDefault(); setActionsOpen(true); requestAnimationFrame(() => { const options = actionsRoot.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'); options?.[event.key === 'ArrowUp' ? options.length - 1 : 0]?.focus(); }); } }}>More actions <ChevronDown size={15} aria-hidden="true" /></button>
              {actionsOpen && <div className="campaign-more-menu" id="campaign-more-menu" role="menu" aria-label="Campaign actions">
                {canEdit && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); actionsTrigger.current?.focus(); openEdit(); }}>Edit campaign</button>}
                {canManageCampaigns && !campaign.isArchived && campaign.status === 'scheduled' && <button type="button" role="menuitem" disabled={isChangingSchedule || isSavingCampaign} onClick={() => { setActionsOpen(false); actionsTrigger.current?.focus(); handleScheduleAction('unschedule'); }}>Return to draft</button>}
                {canManageCampaigns && !campaign.isArchived && (campaign.status === 'active' || campaign.status === 'review') && <button type="button" role="menuitem" disabled={isChangingLifecycle} onClick={() => { setActionsOpen(false); actionsTrigger.current?.focus(); handleLifecycleAction('pause'); }}>Pause campaign</button>}
                {canManageCampaigns && (campaign.status === 'paused' || campaign.status === 'closed') && <button type="button" role="menuitem" disabled={isChangingArchive || isChangingLifecycle} onClick={() => { setActionsOpen(false); actionsTrigger.current?.focus(); openDestructiveConfirmation(campaign.isArchived ? 'unarchive' : 'archive'); }}>{campaign.isArchived ? 'Unarchive campaign' : 'Archive campaign'}</button>}
                {canManageCampaigns && (campaign.status === 'draft' || campaign.status === 'scheduled') && <button type="button" role="menuitem" disabled={isLoadingEligibility || isChangingArchive || !deletionEligibility?.can_delete} title={deletionEligibility?.reason ?? undefined} onClick={() => { setActionsOpen(false); actionsTrigger.current?.focus(); openDestructiveConfirmation('delete'); }}>Delete campaign</button>}
              </div>}
            </div>}
            {canManageCampaigns && campaign.status === 'draft' && !campaign.isArchived && <button className="btn btn-primary" type="button" disabled={isChangingSchedule || isSavingCampaign} onClick={() => handleScheduleAction('schedule')}>{isChangingSchedule ? <Pending label="Updating" /> : 'Schedule campaign'}</button>}
            {canManageCampaigns && !campaign.isArchived && campaign.status === 'active' && (
              <button className="btn btn-primary" type="button" disabled={isChangingLifecycle || isLoadingMetrics} onClick={() => openLifecycleConfirmation('review')}>Move to review</button>
            )}
            {canManageCampaigns && !campaign.isArchived && campaign.status === 'review' && (
              <button className="btn btn-primary" type="button" disabled={isChangingLifecycle || isLoadingMetrics} onClick={() => openLifecycleConfirmation('close')}>Close campaign</button>
            )}
            {canManageCampaigns && !campaign.isArchived && campaign.status === 'paused' && (
              <button className="btn btn-primary" type="button" disabled={isChangingLifecycle} onClick={() => handleLifecycleAction('resume')}>
                {isChangingLifecycle ? <Pending label="Updating" /> : 'Resume campaign'}
              </button>
            )}
          </div>
        </header>

        <nav className="campaign-detail-tabs" aria-label="Campaign detail views">
          <button type="button" className={tab === 'overview' ? 'active' : ''} aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => changeTab('overview')}>Overview</button>
          <button type="button" className={tab === 'setup' ? 'active' : ''} aria-current={tab === 'setup' ? 'page' : undefined} onClick={() => changeTab('setup')}>Setup &amp; Assignments</button>
        </nav>

        {actionMessage !== '' && <InlineMessage tone={messageTone(actionMessage)} className="campaign-inline-message">{actionMessage}</InlineMessage>}
        {configurationFeedback && <CampaignValidationPanel feedback={configurationFeedback} onNavigate={navigateToIssue} />}
        {canManageCampaigns && (campaign.status === 'draft' || campaign.status === 'scheduled') &&
          (eligibilityError || (deletionEligibility && !deletionEligibility.can_delete && deletionEligibility.reason)) && (
            <InlineMessage tone={eligibilityError ? 'error' : 'info'} className="campaign-inline-message">{eligibilityError || deletionEligibility?.reason}</InlineMessage>
          )}

        {tab === 'overview' && <div className="campaign-detail-overview">
          <div className="campaign-overview-top">
            <div className="campaign-overview-progress-wrap">
              <CampaignStats campaign={campaign} inProgressCount={progressBreakdown?.campaignId === campaign.id && progressBreakdown.total === campaign.sent && progressBreakdown.submitted === campaign.done ? progressBreakdown.inProgress : null} />
              {(campaign.status === 'review' || campaign.status === 'closed') && canReadReports ?
                <Link className="campaign-overview-report" to={`/reports/campaigns/${campaign.id}`} onClick={confirmLeaveCampaign}>
                  <span className="campaign-overview-report-icon"><BarChart3 size={18} aria-hidden="true" /></span>
                  <span className="campaign-overview-report-copy"><strong>View report overview</strong><small>See results, question insights, employee reports, and AI analysis.</small></span>
                  <ArrowUpRight className="campaign-overview-report-arrow" size={18} aria-hidden="true" />
                </Link> :
                <div className="campaign-overview-report campaign-overview-report-unavailable" role="status">
                  <span className="campaign-overview-report-icon"><LockKeyhole size={17} aria-hidden="true" /></span>
                  <span className="campaign-overview-report-copy"><strong>{campaign.status === 'review' || campaign.status === 'closed' ? 'Reports access required' : campaign.status === 'paused' ? 'Reports unavailable while paused' : 'Reports available in Review'}</strong><small>{campaign.status === 'review' || campaign.status === 'closed' ? 'Reports require reports.read permission.' : campaign.status === 'paused' ? 'Resume the campaign to access reports when permitted.' : 'Performance results are not available before Review.'}</small></span>
                </div>}
            </div>
            <CampaignTimeline campaign={campaign} />
          </div>
          <CampaignSetupSummary items={setupSummaryItems} onOpen={(section) => openSetupSection(section === 'pairs' ? 'matrix' : section === 'questionnaires' ? 'rules' : section)} />
          <CampaignEmails campaignId={Number(campaign.id)} isActive={campaign.status === 'active' && !campaign.isArchived} hasEndDate={Boolean(campaign.endDate)} />
          {campaign.status !== 'draft' && campaign.status !== 'scheduled' && <Link className="campaign-details-link" to={`/campaigns/${campaign.id}/completion`} onClick={confirmLeaveCampaign}>View completion status →</Link>}
        </div>}

        {tab === 'setup' && <div className="campaign-setup-workspace">
          <nav className="campaign-setup-nav" aria-label="Setup sections">
            <button type="button" className={setupSection === 'groups' ? 'active' : ''} aria-current={setupSection === 'groups' ? 'page' : undefined} onClick={() => changeTab('setup', 'groups')}><UsersRound size={17} aria-hidden="true" /><strong>Participants &amp; groups</strong></button>
            <button type="button" className={setupSection === 'pairs' ? 'active' : ''} aria-current={setupSection === 'pairs' ? 'page' : undefined} onClick={() => changeTab('setup', 'pairs')}><Grid2X2 size={17} aria-hidden="true" /><strong>Evaluation assignments</strong></button>
            <button type="button" className={setupSection === 'questionnaires' ? 'active' : ''} aria-current={setupSection === 'questionnaires' ? 'page' : undefined} onClick={() => changeTab('setup', 'questionnaires')}><ListChecks size={17} aria-hidden="true" /><strong>Questionnaire assignments</strong></button>
            <button type="button" className={setupSection === 'self' ? 'active' : ''} aria-current={setupSection === 'self' ? 'page' : undefined} onClick={() => changeTab('setup', 'self')}><UserRound size={17} aria-hidden="true" /><strong>Self-evaluations</strong></button>
          </nav>
        {setupPreviewError && <InlineMessage tone="error" className="campaign-inline-message">{setupPreviewError}</InlineMessage>}

        {setupSection === 'groups' && <div className="campaign-groups-workspace"><section className="campaign-groups-card" id="campaign-groups" tabIndex={-1}>
          <div className="campaign-groups-heading">
            <div>
              <h2>Campaign groups</h2>
              <p>Select which company groups are included in this campaign.</p>
            </div>
            {canEdit && <span className="campaign-group-autosave" role="status">{isSavingGroups || isSavingSetup ? <Pending label="Saving groups" /> : hasGroupChanges ? groupsMessage ? 'Not saved' : 'Waiting to save...' : 'Saved automatically'}</span>}
          </div>

          {campaignGroups.availableGroups.length === 0 ? (
            <div className="campaign-groups-empty">
              No groups have been created yet. Add groups from the People page first.
            </div>
          ) : (
            <>
            {campaignGroups.availableGroups.length > 8 && (
              <input className="form-control campaign-group-search" aria-label="Search campaign groups" placeholder="Search groups..." value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} />
            )}
            <div className="campaign-groups-grid">
              {campaignGroups.availableGroups.filter((group) => group.name.toLowerCase().includes(groupSearch.trim().toLowerCase())).map((group) => (
                <label className="campaign-group-option" key={group.id}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                      disabled={!canEdit || isSavingGroups || isSavingSetup || groupSaveBlocked || (selectedGroupIds.includes(group.id) && groupsWithIssuedAssignments.has(group.id))}
                    title={groupsWithIssuedAssignments.has(group.id) ? 'This group has issued evaluations and cannot be removed.' : undefined}
                    onChange={() => toggleGroup(group.id)}
                  />
                   <span>
                     <strong>{group.name}</strong>
                     <small>{previewEmployees ? `${activeGroupCounts.get(group.id) ?? 0} ${(activeGroupCounts.get(group.id) ?? 0) === 1 ? 'employee' : 'employees'}` : '— employees'}</small>
                     {group.description && <small>{group.description}</small>}
                    {groupsWithIssuedAssignments.has(group.id) && <small>Issued evaluations · group locked</small>}
                  </span>
                </label>
              ))}
            </div>
            </>
          )}

          <div className="campaign-groups-footer">
            <span>{countLabel(selectedGroupIds.length, 'group')} selected</span>
          </div>
          {groupsMessage !== '' && <InlineMessage tone={messageTone(groupsMessage)} className="campaign-inline-message">{groupsMessage}</InlineMessage>}
          {canEdit && groupSaveBlocked && <p className="campaign-setup-guidance">Save or discard questionnaire, matrix and self-evaluation changes before changing campaign groups.</p>}
          {canEdit && hasGroupChanges && !isSavingGroups && !isSavingSetup && groupsMessage && <div className="campaign-heading-actions"><button className="btn btn-secondary" type="button" disabled={groupSaveBlocked} onClick={retryGroupSave}>Retry saving</button><button className="btn btn-secondary" type="button" onClick={discardGroups}>Discard group changes</button></div>}
        </section>
        <CampaignGroupPreview employees={previewEmployees} selectedGroups={selectedPreviewGroups} loading={peopleLoading} error={!getAccessToken ? 'Employee preview is unavailable.' : peopleError} />
        <div className="campaign-groups-next"><div><strong>What happens next?</strong><p>Group selections save automatically. Continue to plan who evaluates whom.</p>{hasGroupChanges && <small role="status">{groupsMessage ? 'Group changes were not saved. Retry or discard them before continuing.' : 'Wait for automatic saving before continuing.'}</small>}</div><button className="btn btn-primary" type="button" disabled={!selectedGroupIds.length || hasGroupChanges || isSavingGroups || isSavingSetup || !!groupsMessage || isSetupPreviewLoading || !!setupPreviewError} onClick={() => changeTab('setup', 'pairs')}>Continue to evaluation assignments <ArrowUpRight size={16} aria-hidden="true" /></button></div>
        </div>}

        {setupSection === 'pairs' && <section className="campaign-rules-card campaign-matrix-workspace" id="campaign-evaluation-matrix" tabIndex={-1}>
          {isSetupPreviewLoading && campaign.status === 'scheduled' ? <><div className="campaign-matrix-inline-header"><div><h2>Evaluation matrix</h2><p>Select which employees evaluate which other employees.</p></div></div><LoadingState variant="section" label="Loading evaluation pairs" /></> : activeMatrixGroup ?
            <EvaluationMatrix
              group={matrixGroupWithSelfLocks(evaluationMatrix, activeMatrixGroup)}
              notice={matrixNotice}
              groups={evaluationMatrix.groups}
              onGroupChange={setActiveMatrixGroupId}
              rules={evaluationRules}
              selfForms={selectedSelfForms}
              selection={selectedMatrixAssignments}
              matrixDirty={hasMatrixChanges}
              rulesDirty={false}
              editable={canPlanPairs && matrixPlanningReadiness === 'ready' && !matrixAutoSaveBlocked && !isSavingGroups && !isSavingRules && !isSavingSelf && !isIssuingPlanned && !(matrixSaveError && !hasMatrixChanges)}
              disabledReason={!canPlanPairs ? 'This campaign is read-only.' : matrixAutoSaveBlocked ? 'Save or discard group and self-evaluation changes before editing the matrix.' : matrixPlanningReadiness === 'groups' ? 'Select and save campaign groups before editing the matrix.' : matrixPlanningReadiness === 'empty' ? 'Selected groups have no active employees.' : matrixSaveError && !hasMatrixChanges ? 'Reload to refresh the saved matrix details.' : ''}
              minimum={matrixMinimum}
              onMinimumChange={setMatrixMinimum}
              saving={isSavingMatrix || isSavingSetup}
              saveDisabled={!canPlanPairs || matrixAutoSaveBlocked || isSavingMatrix || isSavingGroups || isSavingSetup || isSavingRules || isSavingSelf || isIssuingPlanned || isSetupPreviewLoading || !!setupPreviewError || !hasMatrixChanges || matrixPlanningReadiness !== 'ready'}
              saveError={matrixSaveError}
              autosaveBlockedReason={matrixAutoSaveBlocked ? 'Save or discard group and self-evaluation changes before the matrix can save automatically.' : ''}
              message={matrixMessage}
              onToggle={toggleMatrixAssignment}
              onAddAll={applyMatrixSelectAll}
              onAddSelf={applyMatrixSelfEvaluations}
              onGenerate={applyMatrixMinimumReviewers}
              onClear={applyMatrixDeleteAll}
              onSave={handleUpdateMatrix}
              onDiscard={discardMatrix}
            /> : <><div className="campaign-matrix-inline-header"><div><h2>Evaluation matrix</h2><p>Select which employees evaluate which other employees.</p></div></div>{matrixNotice}<div className="campaign-groups-empty">Select at least one campaign group before setting up evaluations.</div></>}
        </section>}

        {setupSection === 'questionnaires' && <section className="campaign-rules-card campaign-questionnaire-workspace" id="campaign-form-assignment-rules" tabIndex={-1}>
          <div className="campaign-groups-heading">
            <div>
              <h2>Questionnaire assignments</h2>
              <p>Assign questionnaires to evaluator–evaluatee role relationships.</p>
            </div>
            {canAssignForms && <div className="campaign-assignment-autosave"><span role="status">{isSavingRules ? <Pending label="Saving questionnaires" /> : hasRuleChanges ? rulesMessage ? 'Not saved' : hasGroupChanges || hasMatrixChanges ? 'Waiting for groups and matrix...' : 'Waiting to save...' : rulesMessage ? 'Saved; refresh required' : 'Saved automatically'}</span>{hasRuleChanges && !setupSaveBusy && <button className="btn btn-secondary" type="button" onClick={discardRules}>Discard changes</button>}{hasRuleChanges && rulesMessage && <button className="btn btn-secondary" type="button" disabled={setupSaveBusy || hasGroupChanges || hasMatrixChanges || isSetupPreviewLoading || !!setupPreviewError} onClick={handleUpdateRules}>Retry saving</button>}</div>}
          </div>
          {!isSetupPreviewLoading && savedPairCount === 0 && selectedGroupIds.length > 0 && <div className="campaign-questionnaire-empty-plan" role="alert"><strong>No saved evaluation pairs yet.</strong><span>{selectedPairs > 0 ? 'Save your staged matrix selections first. ' : 'Select and save evaluation pairs first. '}You can review optional role assignments here, but required questionnaires are determined by saved pairs.</span><button className="campaign-link" type="button" onClick={() => changeTab('setup', 'pairs')}>Open evaluation assignments</button></div>}

          {isSetupPreviewLoading && campaign.status === 'scheduled' ? (
            <LoadingState variant="section" label="Loading questionnaire assignments" />
          ) : evaluationRules.groups.length === 0 ? (
            <div className="campaign-groups-empty">
              Select at least one campaign group before assigning forms to role relationships.
            </div>
          ) : (
            <div className="campaign-rule-groups">
              {evaluationRules.groups.map((group) => {
                const progress = formProgress.groups.find((item) => item.groupId === group.groupId);
                 return (
                 <div className="campaign-rule-group" key={group.groupId}>
                   <div className="campaign-rule-group-title">
                     <button className="campaign-rule-group-toggle" type="button" aria-expanded={expandedRuleGroups.has(group.groupId)} aria-controls={`campaign-rules-${group.groupId}`} onClick={() => setExpandedRuleGroups((current) => {
                       const next = new Set(current);
                       if (next.has(group.groupId)) next.delete(group.groupId);
                       else next.add(group.groupId);
                       return next;
                     })}>
                       <span className="campaign-rule-group-label"><strong>{group.groupName}</strong><small>{countLabel(group.rolePairs.length, 'role relationship')} · {progress?.missing ? countLabel(progress.missing, 'missing assignment') : progress?.required ? 'All required assignments configured' : 'No required assignments'}</small></span>
                       <span className={`campaign-rule-status-badge${progress?.missing ? ' incomplete' : progress?.required ? ' complete' : ''}`}>{progress?.missing ? `${progress.missing} missing` : progress?.required ? 'Complete' : 'No required forms'}</span>
                       <ChevronDown className={expandedRuleGroups.has(group.groupId) ? 'campaign-rule-chevron expanded' : 'campaign-rule-chevron'} size={18} aria-hidden="true" />
                     </button>
                   </div>
                  <div id={`campaign-rules-${group.groupId}`} hidden={!expandedRuleGroups.has(group.groupId)}>
                  {group.rolePairs.length === 0 ? (
                    <div className="campaign-groups-empty">
                      This group has no active members with roles yet.
                    </div>
                  ) : (
                    <div className="campaign-rule-table-wrap">
                       <table className="campaign-rule-table campaign-questionnaire-table">
                        <thead>
                          <tr>
                             <th scope="col">Role relationship</th>
                             <th scope="col">Assigned questionnaire</th>
                             <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                           {group.rolePairs.map((pair) => {
                              const ruleKey = `${group.groupId}:${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`;
                              const ruleLocked = pair.locked;
                              const required = pair.required;
                              const assigned = validFormIds.has(selectedRuleFormIds[ruleKey] ?? -1);
                             return (
                               <tr key={ruleKey}>
                                 <th scope="row" className="campaign-rule-relationship">{pair.evaluatorRoleName} <span aria-hidden="true">→</span> {pair.evaluateeRoleName}</th>
                                 <td>
                                   <div className="campaign-rule-form-cell">
                                     <select
                                       id={`campaign-rule-${group.groupId}-${pair.evaluatorRoleId}-${pair.evaluateeRoleId}`}
                                       className="form-control"
                                       aria-label={`${group.groupName}: ${pair.evaluatorRoleName} evaluates ${pair.evaluateeRoleName} form`}
                                       value={selectedRuleFormIds[ruleKey] ?? ''}
                                           disabled={!canAssignForms || ruleLocked || setupSaveBusy || hasGroupChanges || hasMatrixChanges || (!!rulesMessage && !hasRuleChanges)}
                                        title={ruleLocked ? 'Issued evaluations use this form rule. The rule is locked.' : undefined}
                                      onChange={(event) =>
                                        updateRuleForm(
                                          group.groupId,
                                          pair.evaluatorRoleId,
                                          pair.evaluateeRoleId,
                                          event.target.value === '' ? null : Number(event.target.value),
                                        )
                                      }
                                    >
                                      <option value="">No form</option>
                                      {evaluationRules.forms.map((form) => (
                                        <option key={form.id} value={form.id}>
                                          {form.name}
                                        </option>
                                      ))}
                                       </select>
                                   </div>
                                 </td>
                                 <td><span className={`campaign-rule-row-status ${ruleLocked ? 'locked' : !required ? 'optional' : assigned ? 'assigned' : 'required'}`} title={ruleLocked ? 'Issued evaluations use this form rule. The rule is locked.' : undefined}><span aria-hidden="true" />{ruleLocked ? 'Locked' : !required ? 'Optional' : assigned ? 'Assigned' : 'Form required'}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  </div>
                </div>
              ); })}
            </div>
          )}

          <div className="campaign-rule-totals"><span>{countLabel(displayedRelationships, 'role relationship')} displayed · {formProgress.configured} of {formProgress.required} required configured{formProgress.missing > 0 && ` · ${countLabel(formProgress.missing, 'missing assignment')}`}</span>{rulesMessage && <strong role="alert">{rulesMessage}</strong>}</div>
          <div className="campaign-rule-next"><div><strong>What happens next?</strong><p>Review optional self-evaluations, or finish any missing questionnaires before issuance.</p>{isSetupPreviewLoading || setupPreviewError ? <small>{setupPreviewError ? 'The setup preview is unavailable.' : 'Loading required questionnaire relationships.'}</small> : formProgress.missing > 0 ? <small>{countLabel(formProgress.missing, 'selected role relationship')} {formProgress.missing === 1 ? 'still needs' : 'still need'} a questionnaire before issuance.</small> : hasRuleChanges ? <small>{rulesMessage ? 'Automatic saving failed. Retry or discard changes before issuance.' : 'Questionnaire changes are saving automatically. Wait before continuing.'}</small> : missingPlannedForms ? <small>Planned self-evaluation pairs need individual questionnaires before issuance.</small> : savedPairCount > 0 ? <small>Required questionnaires are assigned. Planned pairs are ready for issuance when the campaign lifecycle allows it.</small> : <small>Save evaluation pairs first to determine which questionnaires are required.</small>}</div>
            <button className="btn btn-secondary" type="button" disabled={setupSaveBusy || hasRuleChanges} onClick={() => changeTab('setup', 'self')}>Continue to self-evaluations <ArrowUpRight size={16} aria-hidden="true" /></button>
          </div>
          {unissuedPairCount > 0 && <div className="campaign-rule-issue"><div><strong>{countLabel(unissuedPairCount, 'planned evaluation')} pending issuance</strong><p>{campaign.status === 'paused' ? 'Ready pairs will be issued on resume; employees cannot access them while paused.' : campaign.status === 'draft' || campaign.status === 'scheduled' ? 'Validated plans are issued during campaign activation.' : formProgress.missing > 0 || missingPlannedForms ? 'Assign questionnaires for every planned pair before issuing; changes save automatically.' : setupDirty || setupSaveBusy ? 'Wait for automatic saving, or resolve any unsaved changes, before issuing.' : 'Issue validated plans with immutable questionnaire snapshots.'}</p></div>{canAssignForms && (campaign.status === 'active' || campaign.status === 'review') && <button className="btn btn-primary" type="button" disabled={setupSaveBusy || setupDirty || formProgress.missing > 0 || missingPlannedForms || !!rulesMessage || !!selfMessage || !!matrixSaveError || !!groupsMessage} onClick={async () => { if (await confirm({ title: `Issue ${countLabel(unissuedPairCount, 'planned evaluation')}?`, message: 'Evaluators get access right away, and the questionnaire snapshots can’t be changed once issued.', confirmLabel: 'Issue evaluations' })) void handleIssuePlanned(); }}>{isIssuingPlanned ? <Pending label="Issuing" /> : 'Issue ready evaluations'}</button>}</div>}
          {issuanceMessage && <InlineMessage tone="error" className="campaign-inline-message">{issuanceMessage}</InlineMessage>}
        </section>}

        {setupSection === 'self' && <section className="campaign-rules-card campaign-self-workspace" id="campaign-self-evaluations" tabIndex={-1}>
          <div className="campaign-groups-heading">
            <div>
              <h2>Self-evaluations</h2>
              <p>Optionally assign a self-evaluation questionnaire to individual employees.</p>
            </div>
            {canEdit && <div className="campaign-assignment-autosave"><span role="status">{isSavingSelf ? 'Saving self-evaluations...' : hasSelfChanges ? selfMessage ? 'Not saved' : hasGroupChanges || hasMatrixChanges ? 'Waiting for groups and matrix...' : 'Waiting to save...' : selfMessage ? 'Saved; refresh required' : 'Saved automatically'}</span>{hasSelfChanges && !setupSaveBusy && <button className="btn btn-secondary" type="button" onClick={discardSelfForms}>Discard changes</button>}{hasSelfChanges && selfMessage && <button className="btn btn-secondary" type="button" disabled={setupSaveBusy || hasGroupChanges || hasMatrixChanges || isSetupPreviewLoading || !!setupPreviewError} onClick={handleUpdateSelfForms}>Retry saving</button>}</div>}
          </div>
           {(hasMatrixChanges || hasGroupChanges) && <p className="campaign-setup-guidance" role="status">Wait for matrix and group changes to save, or discard them, before changing self-evaluation questionnaires.</p>}
           {isSetupPreviewLoading && campaign.status === 'scheduled' ? (
             <LoadingState variant="section" label="Loading participants" />
           ) : selfEvaluations.participants.length === 0 ? (
               <div className="campaign-groups-empty">Select campaign groups with active participants to configure self-evaluations.</div>
           ) : (
             <div className="campaign-rule-group">
               <div className="campaign-rule-group-title"><button className="campaign-rule-group-toggle" type="button" aria-expanded={selfExpanded} aria-controls="campaign-self-participant-list" onClick={() => setSelfExpanded((open) => !open)}><span className="campaign-rule-group-label"><strong>Campaign participants</strong><small>{countLabel(selfEvaluations.participants.length, 'participant')} · {assignedSelfCount} assigned</small></span><span className="campaign-rule-status-badge">Optional</span><ChevronDown className={selfExpanded ? 'campaign-rule-chevron expanded' : 'campaign-rule-chevron'} size={18} aria-hidden="true" /></button></div>
               <div className="campaign-rule-table-wrap" id="campaign-self-participant-list" hidden={!selfExpanded}><table className="campaign-rule-table campaign-self-table">
                  <thead><tr><th scope="col">Participant</th><th scope="col">Groups</th><th scope="col">Assigned questionnaire</th><th scope="col">Status</th></tr></thead>
                 <tbody>{selfEvaluations.participants.map((person) => {
                   const locked = person.locked || issuedSelfIds.has(person.employeeId);
                   const assigned = validSelfForms.has(selectedSelfForms[person.employeeId] ?? -1);
                   return <tr key={person.employeeId}>
                     <th scope="row"><strong>{person.name}</strong><small>{person.roleName}</small></th>
                     <td>{person.groupNames.join(', ')}</td>
                     <td><select className="form-control" aria-label={`Self-evaluation questionnaire for ${person.name}${locked ? ', issued and locked' : ''}`} title={locked ? 'Issued self-evaluation is protected.' : undefined} value={selectedSelfForms[person.employeeId] ?? ''} disabled={!canEdit || locked || setupSaveBusy || hasMatrixChanges || hasGroupChanges || (!!selfMessage && !hasSelfChanges)} onChange={(event) => updateSelfForm(person.employeeId, event.target.value === '' ? null : Number(event.target.value))}>
                       <option value="">No form</option>{selfEvaluations.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                     </select></td>
                     <td><span className={`campaign-rule-row-status ${locked ? 'locked' : assigned ? 'assigned' : 'optional'}`}><span aria-hidden="true" />{locked ? 'Locked' : assigned ? 'Assigned' : 'Optional'}</span></td>
                   </tr>;
                 })}</tbody>
               </table></div>
             </div>
           )}
            {selfMessage && <InlineMessage tone={messageTone(selfMessage)} className="campaign-inline-message">{selfMessage}</InlineMessage>}
        </section>}

        </div>}
      </div>

       {destructiveAction && (
         <CampaignModal mode={destructiveAction} onClose={closeDestructiveConfirmation}>
           <div className="campaign-copy-preview">
              <p>{destructiveAction === 'delete'
                ? `Permanently delete ${campaign.name}? This cannot be undone. Only campaigns confirmed eligible by the server can be deleted.`
                : destructiveAction === 'archive'
                  ? campaign.status === 'paused'
                    ? `Archive ${campaign.name}? It will remain Paused. Employees cannot access its questionnaires, and it must be unarchived before HR can resume it. Its history and saved data remain available to authorized HR users.`
                    : `Archive ${campaign.name}? It will remain Closed and hidden from the default list. All historical evaluations, snapshots and answers will be preserved.`
                  : `Unarchive ${campaign.name}? It will appear in the default campaign list again.`}</p>
              {destructiveAction === 'delete' && <p>The campaign and its campaign-specific setup will be permanently removed. Shared Groups, Forms and Employees will not be deleted.</p>}
             {destructiveError && <InlineMessage tone="error">{destructiveError}</InlineMessage>}
             <div className="campaign-modal-actions">
               <button className="btn btn-secondary" type="button" disabled={isChangingArchive} onClick={closeDestructiveConfirmation}>Cancel</button>
               <button className={`btn ${destructiveAction === 'delete' ? 'btn-danger' : 'btn-primary'}`} type="button" disabled={isChangingArchive || (destructiveAction === 'delete' && !deletionEligibility?.can_delete)}
                 onClick={handleDestructiveAction}>
                 {isChangingArchive ? <Pending label="Updating" /> : destructiveAction === 'delete' ? 'Delete permanently' : destructiveAction === 'archive' ? 'Archive campaign' : 'Unarchive campaign'}
               </button>
             </div>
           </div>
         </CampaignModal>
       )}

       {confirmationAction && (
         <CampaignModal mode={confirmationAction} onClose={closeLifecycleConfirmation}>
           <div className="campaign-copy-preview">
              <p>{confirmationAction === 'review' ? 'Move this active campaign to review?' : 'Close this review campaign?'} Completion is based on issued evaluations, not planned assignments.</p>
              <p>{confirmationAction === 'review'
                ? 'Incomplete assigned evaluations remain fillable during Review, including after the configured deadline. The campaign end timestamp will not change.'
                : 'Closing blocks employee questionnaire access. Incomplete assignments remain incomplete historical records; submitted answers and snapshots are preserved.'}</p>
             {isLoadingMetrics && <LoadingState variant="section" label="Loading completion figures" />}
             {operationalMetrics && !isLoadingMetrics && (
               <dl className="campaign-copy-counts">
                 <div><dt>Total issued</dt><dd>{operationalMetrics.total}</dd></div>
                 <div><dt>Submitted</dt><dd>{operationalMetrics.submitted}</dd></div>
                 <div><dt>Incomplete</dt><dd>{operationalMetrics.incomplete}</dd></div>
                 <div><dt>Completion</dt><dd>{operationalMetrics.completion_rate}%</dd></div>
               </dl>
             )}
             {confirmationError && <InlineMessage tone="error">{confirmationError}</InlineMessage>}
             <div className="campaign-modal-actions">
               <button className="btn btn-secondary" type="button" disabled={isChangingLifecycle} onClick={closeLifecycleConfirmation}>Cancel</button>
               <button className="btn btn-primary" type="button" disabled={isLoadingMetrics || isChangingLifecycle || !operationalMetrics || !!confirmationError}
                 onClick={() => handleLifecycleAction(confirmationAction)}>
                 {isChangingLifecycle ? <Pending label="Updating" /> : confirmationAction === 'review' ? 'Confirm move to review' : 'Confirm close'}
               </button>
             </div>
           </div>
         </CampaignModal>
       )}

        {confirmGroupRemoval && (
        <CampaignModal mode="remove-group" onClose={() => { if (!isSavingSetup) { discardGroups(); setConfirmGroupRemoval(false); } }}>
          <div className="campaign-copy-preview">
            <p>Remove <strong>{removedGroupNames.join(', ')}</strong> from this campaign? The group records, Forms, Templates and Sections remain available.</p>
            <dl className="campaign-copy-counts">
              <div><dt>Campaign groups removed</dt><dd>{removedGroupIds.length}</dd></div>
              <div><dt>Form assignment rules removed</dt><dd>{removedRules}</dd></div>
              <div><dt>Self-evaluation form settings no longer needed</dt><dd>{removedSelfForms}</dd></div>
              <div><dt>Planned evaluator-evaluatee assignments affected</dt><dd>{removedAssignments.filter((item) => !item.issued).length}</dd></div>
              <div><dt>Issued assignments protected</dt><dd>{removedAssignments.filter((item) => item.issued).length}</dd></div>
            </dl>
            <p>Participants and self-evaluations shared with remaining groups stay. Eligible shared planned assignments move to a remaining group; issued evaluations cannot be removed. If a Scheduled campaign becomes incomplete, it returns to Draft.</p>
            {groupsMessage && <InlineMessage tone={messageTone(groupsMessage)}>{groupsMessage}</InlineMessage>}
            <div className="campaign-modal-actions">
              <button className="btn btn-secondary" type="button" disabled={isSavingSetup} onClick={() => { discardGroups(); setConfirmGroupRemoval(false); }}>Cancel</button>
              <button className="btn btn-danger" type="button" disabled={isSavingSetup || removedAssignments.some((item) => item.issued)}
                onClick={async () => { if (await handleUpdateSetup()) setConfirmGroupRemoval(false); }}>
                {isSavingSetup ? <Pending label="Saving" /> : 'Remove and save setup'}
              </button>
            </div>
          </div>
        </CampaignModal>
      )}

       {isEditOpen && canEdit && (
        <CampaignModal
          mode="edit"
          onClose={closeEdit}
        >
          <CampaignForm
            form={form}
            campaign={campaign}
            message={saveMessage}
            isSaving={isSavingCampaign}
            hasChanges={hasEditChanges}
            updateForm={updateForm}
            onSubmit={handleUpdateCampaign}
            onCancel={closeEdit}
          />
        </CampaignModal>
      )}

    </CampaignPage>
  );
}

export default CampaignDetails;
