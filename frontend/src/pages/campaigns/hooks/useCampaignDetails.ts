import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useAppAuth } from '../../../auth/AppAuth';
import { ApiAccessError } from '../../../auth/authenticated-api';
import type {
  Campaign,
  CampaignEvaluationMatrix,
  CampaignEvaluationRules,
  CampaignFormValues,
  CampaignGroups,
  CampaignOperationalMetrics,
  CampaignSelfEvaluations,
  UpdateCampaignField,
} from '../campaign.types';
import { previewRuleCopy, type RuleCopyRequest } from '../rule-copy';
import { clearMatrixPairs, generateMatrixPairs, matrixDirty, matrixGroupWithSelfLocks, matrixKey, selectMatrixPairs, synchronizeSelfPair, toggleMatrixPair } from '../matrix.utils';
import { getFormAssignmentProgress, getMatrixReadiness } from '../campaign-readiness';
import { previewSelfCopy, selfFormMap, selfFormsDirty } from '../self-evaluations';
import {
  areCampaignFormsEqual,
  emptyCampaignForm,
  getCampaignForm,
  getCampaignValidationError,
} from '../campaign.utils';
import {
  fetchCampaign,
  fetchCampaignEvaluationMatrix,
  fetchCampaignEvaluationRules,
  fetchCampaignGroups,
  fetchCampaignSelfEvaluations,
  fetchCampaignSetupPreview,
  changeCampaignSchedule,
  changeCampaignLifecycle,
  fetchCampaignOperationalMetrics,
  type CampaignLifecycleAction,
  updateCampaign,
  updateCampaignEvaluationMatrix,
  updateCampaignEvaluationRules,
  updateCampaignGroups,
  updateCampaignSelfEvaluations,
  updateCampaignSetup,
} from '../campaign.api';

function areGroupIdsEqual(first: number[], second: number[]) {
  if (first.length !== second.length) return false;
  const normalizedFirst = [...first].sort((a, b) => a - b);
  const normalizedSecond = [...second].sort((a, b) => a - b);
  return normalizedFirst.every((id, index) => id === normalizedSecond[index]);
}

function getRuleKey(groupId: number, evaluatorRoleId: number, evaluateeRoleId: number) {
  return `${groupId}:${evaluatorRoleId}:${evaluateeRoleId}`;
}

const getMatrixKey = matrixKey;

function getRuleFormMap(rules: CampaignEvaluationRules) {
  const map: Record<string, number | null> = {};
  for (const group of rules.groups) {
    for (const pair of group.rolePairs) {
      map[getRuleKey(group.groupId, pair.evaluatorRoleId, pair.evaluateeRoleId)] = pair.formId;
    }
  }
  return map;
}

function areRuleFormMapsEqual(
  first: Record<string, number | null>,
  second: Record<string, number | null>,
) {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  for (const key of keys) {
    if ((first[key] ?? null) !== (second[key] ?? null)) return false;
  }
  return true;
}

function getMatrixAssignmentMap(matrix: CampaignEvaluationMatrix) {
  const map: Record<string, boolean> = {};
  const selfIds = new Set<number>();
  for (const group of matrix.groups) {
    for (const assignment of group.assignments) {
      map[getMatrixKey(group.groupId, assignment.evaluatorId, assignment.evaluateeId)] = true;
      if (assignment.issued && assignment.evaluatorId === assignment.evaluateeId) selfIds.add(assignment.evaluatorId);
    }
  }
  for (const employeeId of selfIds) {
    for (const group of matrix.groups) {
      if (group.employees.some((person) => person.id === employeeId)) {
        map[getMatrixKey(group.groupId, employeeId, employeeId)] = true;
      }
    }
  }
  return map;
}

export function useCampaignDetails(id: string | undefined) {
  const { getAccessTokenSilently } = useAuth0();
  const { state, retryAuth0 } = useAppAuth();
  const canManageCampaigns = state.status === 'authenticated' && state.mode === 'auth0'
    && state.user.permissions.includes('campaigns.manage');
  function handleAuthError(error: unknown) {
    if (error instanceof ApiAccessError) retryAuth0();
  }
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignGroups, setCampaignGroups] = useState<CampaignGroups>({
    availableGroups: [],
    assignedGroupIds: [],
  });
  const [evaluationRules, setEvaluationRules] = useState<CampaignEvaluationRules>({
    forms: [],
    groups: [],
  });
  const [evaluationMatrix, setEvaluationMatrix] = useState<CampaignEvaluationMatrix>({
    groups: [],
  });
  const [selfEvaluations, setSelfEvaluations] = useState<CampaignSelfEvaluations>({ forms: [], participants: [] });
  const [selectedSelfForms, setSelectedSelfForms] = useState<Record<number, number | null>>({});
  const [selfMessage, setSelfMessage] = useState('');
  const [isSavingSelf, setIsSavingSelf] = useState(false);
  const [selectedRuleFormIds, setSelectedRuleFormIds] = useState<Record<string, number | null>>({});
  const [selectedMatrixAssignments, setSelectedMatrixAssignments] = useState<Record<string, boolean>>({});
  const [activeRuleKey, setActiveRuleKey] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [form, setForm] = useState<CampaignFormValues>(emptyCampaignForm);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCampaignLoading, setIsCampaignLoading] = useState(true);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [groupsMessage, setGroupsMessage] = useState('');
  const [rulesMessage, setRulesMessage] = useState('');
  const [matrixMessage, setMatrixMessage] = useState('');
  const [isSavingGroups, setIsSavingGroups] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [isSavingMatrix, setIsSavingMatrix] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isChangingSchedule, setIsChangingSchedule] = useState(false);
  const [confirmationAction, setConfirmationAction] = useState<'review' | 'close' | null>(null);
  const [operationalMetrics, setOperationalMetrics] = useState<CampaignOperationalMetrics | null>(null);
  const [confirmationError, setConfirmationError] = useState('');
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [isChangingLifecycle, setIsChangingLifecycle] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [isSetupPreviewLoading, setIsSetupPreviewLoading] = useState(false);
  const [setupPreviewError, setSetupPreviewError] = useState('');
  const savedRules = useRef<CampaignEvaluationRules>({ forms: [], groups: [] });
  const savedMatrix = useRef<CampaignEvaluationMatrix>({ groups: [] });
  const savedSelf = useRef<CampaignSelfEvaluations>({ forms: [], participants: [] });
  const saving = useRef(false);
  const routeVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++routeVersion.current;
    setCampaign(null);
    setCampaignGroups({ availableGroups: [], assignedGroupIds: [] });
    setEvaluationRules({ forms: [], groups: [] });
    setEvaluationMatrix({ groups: [] });
    setSelfEvaluations({ forms: [], participants: [] });
    setSelectedSelfForms({});
    setSelfMessage('');
    setSelectedRuleFormIds({});
    setSelectedMatrixAssignments({});
    setActiveRuleKey(null);
    setSelectedGroupIds([]);
    savedRules.current = { forms: [], groups: [] };
    savedMatrix.current = { groups: [] };
    savedSelf.current = { forms: [], participants: [] };
    setSetupPreviewError('');
    setIsSetupPreviewLoading(false);
    setForm(emptyCampaignForm);
    setCampaignError('');
    setGroupsMessage('');
    setRulesMessage('');
    setMatrixMessage('');
    setIsEditOpen(false);
    setSaveMessage('');
    setSuccessMessage('');
    setActionMessage('');
    setIsChangingSchedule(false);
    setConfirmationAction(null);
    setOperationalMetrics(null);
    setConfirmationError('');
    setIsLoadingMetrics(false);
    setIsChangingLifecycle(false);
    saving.current = false;
    setIsSavingCampaign(false);
    setIsCampaignLoading(true);
    if (id === undefined) {
      setCampaignError('Campaign not found.');
      setIsCampaignLoading(false);
    } else {
      Promise.all([
        fetchCampaign(getAccessTokenSilently, id, controller.signal),
        fetchCampaignGroups(getAccessTokenSilently, id, controller.signal),
        fetchCampaignEvaluationRules(getAccessTokenSilently, id, controller.signal),
        fetchCampaignEvaluationMatrix(getAccessTokenSilently, id, controller.signal),
        fetchCampaignSelfEvaluations(getAccessTokenSilently, id, controller.signal),
      ])
        .then(([loaded, loadedGroups, loadedRules, loadedMatrix, loadedSelf]) => {
          if (!controller.signal.aborted) {
            setCampaign(loaded);
            setCampaignGroups(loadedGroups);
            setEvaluationRules(loadedRules);
            setEvaluationMatrix(loadedMatrix);
            setSelfEvaluations(loadedSelf);
            savedRules.current = loadedRules;
            savedMatrix.current = loadedMatrix;
            savedSelf.current = loadedSelf;
            setSelectedSelfForms(selfFormMap(loadedSelf));
            setSelectedRuleFormIds(getRuleFormMap(loadedRules));
            setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
            setSelectedGroupIds(loadedGroups.assignedGroupIds);
            setForm(getCampaignForm(loaded));
          }
        })
        .catch((error: unknown) => {
          handleAuthError(error);
          if (!controller.signal.aborted)
            setCampaignError(error instanceof ApiAccessError ? error.message : 'Campaign could not be loaded.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsCampaignLoading(false);
        });
    }
    return () => {
      controller.abort();
      if (routeVersion.current === version) routeVersion.current++;
    };
  }, [id, getAccessTokenSilently]);

  useEffect(() => {
    if (!campaign || campaign.status !== 'scheduled') return;
    const controller = new AbortController();
    const version = routeVersion.current;
    setIsSetupPreviewLoading(true);
    setSetupPreviewError('');
    fetchCampaignSetupPreview(getAccessTokenSilently, campaign.id, selectedGroupIds, controller.signal)
      .then((preview) => {
        if (controller.signal.aborted || routeVersion.current !== version) return;
        setEvaluationRules(preview.rules);
        setSelfEvaluations(preview.selfEvaluations);
        setEvaluationMatrix(preview.matrix);
        const ruleDefaults = getRuleFormMap(preview.rules);
        setSelectedRuleFormIds((current) => ({ ...ruleDefaults, ...current }));
        const selfDefaults = selfFormMap(preview.selfEvaluations);
        setSelectedSelfForms((current) => ({ ...selfDefaults, ...current }));
        const matrixDefaults = getMatrixAssignmentMap(preview.matrix);
        setSelectedMatrixAssignments((current) => ({ ...matrixDefaults, ...current }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || routeVersion.current !== version) return;
        handleAuthError(error);
        setSetupPreviewError(error instanceof Error ? error.message : 'Selected group setup could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted && routeVersion.current === version) setIsSetupPreviewLoading(false); });
    return () => controller.abort();
  }, [campaign?.id, campaign?.status, selectedGroupIds, getAccessTokenSilently]);

  const updateForm: UpdateCampaignField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveMessage('');
    setSuccessMessage('');
  };
  function openEdit() {
    if (!campaign || !canManageCampaigns || campaign.status === 'closed') return;
    setForm(getCampaignForm(campaign));
    setSaveMessage('');
    setSuccessMessage('');
    setIsEditOpen(true);
  }
  function closeEdit() {
    if (saving.current) return;
    setIsEditOpen(false);
    setSaveMessage('');
    if (campaign) setForm(getCampaignForm(campaign));
  }
  async function handleScheduleAction(action: 'schedule' | 'unschedule') {
    if (!campaign || !canManageCampaigns || isChangingSchedule || hasEditChanges && isEditOpen) return;
    if (hasGroupChanges || hasRuleChanges || hasMatrixChanges || hasSelfChanges) {
      setActionMessage('Save or discard configuration changes before changing the schedule.');
      return;
    }
    const version = routeVersion.current;
    setIsChangingSchedule(true);
    setActionMessage('');
    try {
      const updated = await changeCampaignSchedule(getAccessTokenSilently, campaign.id, action);
      if (routeVersion.current !== version) return;
      setCampaign(updated);
      setForm(getCampaignForm(updated));
      setSuccessMessage(action === 'schedule' ? 'Campaign scheduled.' : 'Campaign returned to draft.');
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) setActionMessage(error instanceof Error ? error.message : 'Campaign status could not be updated.');
    } finally {
      if (routeVersion.current === version) setIsChangingSchedule(false);
    }
  }
  function closeLifecycleConfirmation() {
    if (isChangingLifecycle) return;
    setConfirmationAction(null);
    setOperationalMetrics(null);
    setConfirmationError('');
  }
  async function openLifecycleConfirmation(action: 'review' | 'close') {
    if (!campaign || !canManageCampaigns || isChangingLifecycle || isLoadingMetrics ||
        (action === 'review' ? campaign.status !== 'active' : campaign.status !== 'review')) return;
    setConfirmationAction(action);
    setOperationalMetrics(null);
    setConfirmationError('');
    setIsLoadingMetrics(true);
    const version = routeVersion.current;
    try {
      const metrics = await fetchCampaignOperationalMetrics(getAccessTokenSilently, campaign.id);
      if (routeVersion.current !== version) return;
      if (metrics.campaign_status !== campaign.status) {
        setConfirmationError('Campaign status changed. Refresh the page before trying again.');
        const refreshed = await fetchCampaign(getAccessTokenSilently, campaign.id, new AbortController().signal);
        if (routeVersion.current === version) {
          setCampaign(refreshed);
          setForm(getCampaignForm(refreshed));
        }
      } else setOperationalMetrics(metrics);
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) setConfirmationError(error instanceof Error ? error.message : 'Campaign completion metrics could not be loaded.');
    } finally {
      if (routeVersion.current === version) setIsLoadingMetrics(false);
    }
  }
  async function handleLifecycleAction(action: CampaignLifecycleAction) {
    if (!campaign || !canManageCampaigns || isChangingLifecycle || isLoadingMetrics || campaign.isArchived ||
        (action === 'pause' && campaign.status !== 'active' && campaign.status !== 'review') ||
        (action === 'resume' && campaign.status !== 'paused') ||
        (action === 'review' && campaign.status !== 'active') ||
        (action === 'close' && campaign.status !== 'review') ||
        ((action === 'review' || action === 'close') && (confirmationAction !== action || !operationalMetrics || confirmationError))) return;
    const version = routeVersion.current;
    setIsChangingLifecycle(true);
    setActionMessage('');
    try {
      const updated = await changeCampaignLifecycle(getAccessTokenSilently, campaign.id, action);
      if (routeVersion.current !== version) return;
      setCampaign(updated);
      setForm(getCampaignForm(updated));
      setConfirmationAction(null);
      setOperationalMetrics(null);
      setConfirmationError('');
      setIsEditOpen(false);
      setSuccessMessage(action === 'pause' ? 'Campaign paused.' : action === 'resume' ? 'Campaign resumed.' : action === 'review' ? 'Campaign moved to review.' : 'Campaign closed.');
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) {
        const message = error instanceof Error ? error.message : 'Campaign status could not be updated.';
        if (confirmationAction) setConfirmationError(message);
        else setActionMessage(message);
      }
    } finally {
      if (routeVersion.current === version) {
        try {
          const refreshed = await fetchCampaign(getAccessTokenSilently, campaign.id, new AbortController().signal);
          if (routeVersion.current === version) {
            setCampaign(refreshed);
            setForm(getCampaignForm(refreshed));
            if (refreshed.status !== campaign.status) {
              setConfirmationAction(null);
              setOperationalMetrics(null);
            }
          }
        } catch (error) {
          handleAuthError(error);
          if (routeVersion.current === version) setActionMessage('Campaign status could not be refreshed. Reload for the latest status.');
        }
        if (routeVersion.current === version) setIsChangingLifecycle(false);
      }
    }
  }
  const hasEditChanges =
    campaign !== null &&
    !areCampaignFormsEqual(form, getCampaignForm(campaign));
  const hasGroupChanges = !areGroupIdsEqual(
    selectedGroupIds,
    campaignGroups.assignedGroupIds,
  );
  const selectedGroupKeys = <T,>(values: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(values).filter(([key]) => selectedGroupIds.includes(Number(key.split(':')[0]))));
  const hasRuleChanges = !areRuleFormMapsEqual(
    campaign?.status === 'scheduled' ? selectedGroupKeys(selectedRuleFormIds) : selectedRuleFormIds,
    campaign?.status === 'scheduled' ? selectedGroupKeys(getRuleFormMap(savedRules.current)) : getRuleFormMap(evaluationRules),
  );
  const hasMatrixChanges = matrixDirty(
    campaign?.status === 'scheduled' ? selectedGroupKeys(selectedMatrixAssignments) : selectedMatrixAssignments,
    campaign?.status === 'scheduled' ? selectedGroupKeys(getMatrixAssignmentMap(savedMatrix.current)) : getMatrixAssignmentMap(evaluationMatrix));
  const hasSelfChanges = selfFormsDirty(campaign?.status === 'scheduled' ? savedSelf.current : selfEvaluations, selectedSelfForms);
  const formProgress = getFormAssignmentProgress(evaluationRules, selectedRuleFormIds, campaign?.status === 'scheduled');
  const matrixReadiness = getMatrixReadiness(formProgress, campaign?.status === 'scheduled' ? false : hasGroupChanges,
    campaign?.status === 'scheduled' ? false : hasRuleChanges);

  async function handleUpdateSetup() {
    if (!campaign || (campaign.status !== 'scheduled' && campaign.status !== 'draft') || !canManageCampaigns || isSavingSetup || isSetupPreviewLoading || setupPreviewError ||
        !(hasGroupChanges || hasRuleChanges || hasMatrixChanges || hasSelfChanges)) return;
    const removedCount = campaignGroups.assignedGroupIds.filter((groupId) => !selectedGroupIds.includes(groupId)).length;
    const version = routeVersion.current;
    setIsSavingSetup(true);
    setActionMessage('');
    try {
      const rules = evaluationRules.groups.flatMap((group) => group.rolePairs.flatMap((pair) => {
        const formId = selectedRuleFormIds[getRuleKey(group.groupId, pair.evaluatorRoleId, pair.evaluateeRoleId)];
        return formId == null || !selectedGroupIds.includes(group.groupId) ? [] : [{
          companyGroupId: group.groupId, evaluatorRoleId: pair.evaluatorRoleId,
          evaluateeRoleId: pair.evaluateeRoleId, formId,
        }];
      }));
      const assignments = evaluationMatrix.groups.flatMap((group) => group.employees.flatMap((evaluator) =>
        group.employees.flatMap((evaluatee) =>
          selectedGroupIds.includes(group.groupId) && selectedMatrixAssignments[getMatrixKey(group.groupId, evaluator.id, evaluatee.id)]
            ? [{ companyGroupId: group.groupId, evaluatorId: evaluator.id, evaluateeId: evaluatee.id }] : [],
        ),
      ));
      const selectedParticipants = new Set(evaluationMatrix.groups.filter((group) => selectedGroupIds.includes(group.groupId))
        .flatMap((group) => group.employees.filter((person) => person.active !== false).map((person) => person.id)));
      await updateCampaignSetup(getAccessTokenSilently, campaign.id, selectedGroupIds, rules,
        selfEvaluations.participants.filter((person) => selectedParticipants.has(person.employeeId)).map((person) => ({
          employeeId: person.employeeId, formId: selectedSelfForms[person.employeeId] ?? null,
        })), assignments);
      if (routeVersion.current !== version) return;
      const controller = new AbortController();
      const [loadedGroups, loadedRules, loadedSelf, loadedMatrix, loadedCampaign] = await Promise.all([
        fetchCampaignGroups(getAccessTokenSilently, campaign.id, controller.signal),
        fetchCampaignEvaluationRules(getAccessTokenSilently, campaign.id, controller.signal),
        fetchCampaignSelfEvaluations(getAccessTokenSilently, campaign.id, controller.signal),
        fetchCampaignEvaluationMatrix(getAccessTokenSilently, campaign.id, controller.signal),
        fetchCampaign(getAccessTokenSilently, campaign.id, controller.signal),
      ]);
      if (routeVersion.current !== version) return;
      setCampaignGroups(loadedGroups);
      setSelectedGroupIds(loadedGroups.assignedGroupIds);
      setEvaluationRules(loadedRules);
      savedRules.current = loadedRules;
      setSelectedRuleFormIds(getRuleFormMap(loadedRules));
      setSelfEvaluations(loadedSelf);
      savedSelf.current = loadedSelf;
      setSelectedSelfForms(selfFormMap(loadedSelf));
      setEvaluationMatrix(loadedMatrix);
      savedMatrix.current = loadedMatrix;
      setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
      setCampaign(loadedCampaign);
      setSuccessMessage(removedCount
        ? `${removedCount} campaign ${removedCount === 1 ? 'group' : 'groups'} removed with dependent configuration. Shared participants and eligible planned assignments were retained.`
        : 'Campaign setup saved.');
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) setActionMessage(error instanceof Error ? error.message : 'Campaign setup could not be saved.');
    } finally {
      if (routeVersion.current === version) setIsSavingSetup(false);
    }
  }

  function toggleGroup(groupId: number) {
    setSelectedGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
    setGroupsMessage('');
    setRulesMessage('');
    setMatrixMessage('');
    setSuccessMessage('');
  }

  function updateRuleForm(
    groupId: number,
    evaluatorRoleId: number,
    evaluateeRoleId: number,
    formId: number | null,
  ) {
    setActiveRuleKey(getRuleKey(groupId, evaluatorRoleId, evaluateeRoleId));
    setSelectedRuleFormIds((current) => ({
      ...current,
      [getRuleKey(groupId, evaluatorRoleId, evaluateeRoleId)]: formId,
    }));
    setRulesMessage('');
    setMatrixMessage('');
    setSuccessMessage('');
  }

  function toggleMatrixAssignment(
    groupId: number,
    evaluatorId: number,
    evaluateeId: number,
  ) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (matrixReadiness !== 'ready' || !group) return;
    if (campaign?.status !== 'scheduled' && evaluatorId === evaluateeId && hasSelfChanges && !selectedMatrixAssignments[matrixKey(groupId, evaluatorId, evaluateeId)]) return;
    setSelectedMatrixAssignments((current) => {
      const next = toggleMatrixPair(group, evaluationRules, current, evaluatorId, evaluateeId, selectedSelfForms);
      return next === current || evaluatorId !== evaluateeId ? next : synchronizeSelfPair(evaluationMatrix.groups, next, groupId, evaluatorId, Boolean(next[matrixKey(groupId, evaluatorId, evaluateeId)]));
    });
    setMatrixMessage('');
    setSuccessMessage('');
  }

  function applyMatrixSelectAll(groupId: number) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (group === undefined || matrixReadiness !== 'ready') return;
    if (hasSelfChanges && campaign?.status !== 'scheduled') return;
    let next = selectMatrixPairs(group, evaluationRules, selectedMatrixAssignments, false, selectedSelfForms);
    for (const person of group.employees) {
      if (next[matrixKey(groupId, person.id, person.id)]) next = synchronizeSelfPair(evaluationMatrix.groups, next, groupId, person.id, true);
    }
    setSelectedMatrixAssignments(next);
    setMatrixMessage(matrixDirty(next, selectedMatrixAssignments) ? '' : 'All eligible pairs are already selected.');
    setSuccessMessage('');
  }

  function applyMatrixSelfEvaluations(groupId: number) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (group === undefined || matrixReadiness !== 'ready') return;
    if (hasSelfChanges && campaign?.status !== 'scheduled') return;
    let next = selectMatrixPairs(group, evaluationRules, selectedMatrixAssignments, true, selectedSelfForms);
    const missing = group.employees.filter((person) => selectedSelfForms[person.id] == null &&
      !group.assignments.some((item) => item.issued && item.evaluatorId === person.id && item.evaluateeId === person.id)).length;
    const protectedCount = group.employees.filter((person) => group.assignments.some((item) =>
      item.issued && item.evaluatorId === person.id && item.evaluateeId === person.id)).length;
    for (const person of group.employees) {
      if (next[matrixKey(groupId, person.id, person.id)]) next = synchronizeSelfPair(evaluationMatrix.groups, next, groupId, person.id, true);
    }
    setSelectedMatrixAssignments(next);
    const skipped = [missing && `${missing} without a self-evaluation form`, protectedCount && `${protectedCount} already issued`].filter(Boolean).join(', ');
    setMatrixMessage(`${matrixDirty(next, selectedMatrixAssignments) ? 'Eligible self-evaluations selected.' : 'No additional eligible self-evaluations are available.'}${skipped ? ` Skipped: ${skipped}.` : ''}`);
    setSuccessMessage('');
  }

  function applyMatrixMinimumReviewers(groupId: number, minimumReviewers: number) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (group === undefined || matrixReadiness !== 'ready') return;
    try {
      const result = generateMatrixPairs(group, evaluationRules, selectedMatrixAssignments, minimumReviewers);
      setSelectedMatrixAssignments(result.selection);
      setMatrixMessage(result.unmet.length ? `Minimum could not be reached: ${result.unmet.join(', ')}.` : 'Requested peer-review minimum reached where eligible. Self-evaluations are not counted.');
    } catch (error) {
      setMatrixMessage(error instanceof Error ? error.message : 'Invalid review minimum.');
    }
    setSuccessMessage('');
  }

  function applyMatrixDeleteAll(groupId: number) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (group === undefined || matrixReadiness !== 'ready') return;
    setSelectedMatrixAssignments((current) => {
      let next = clearMatrixPairs(group, evaluationRules, current, selectedSelfForms);
      for (const person of group.employees) {
        if (!next[matrixKey(groupId, person.id, person.id)]) next = synchronizeSelfPair(evaluationMatrix.groups, next, groupId, person.id, false);
      }
      return next;
    });
    setMatrixMessage('');
    setSuccessMessage('');
  }

  function discardMatrix() {
    setSelectedMatrixAssignments(getMatrixAssignmentMap(campaign?.status === 'scheduled' ? savedMatrix.current : evaluationMatrix));
    setMatrixMessage('');
  }

  function updateSelfForm(employeeId: number, formId: number | null) {
    if (selfEvaluations.participants.find((person) => person.employeeId === employeeId)?.locked) return;
    setSelectedSelfForms((current) => ({ ...current, [employeeId]: formId }));
    setSelfMessage('');
  }

  function copySelfForm(sourceId: number) {
    if (isSavingSelf) return;
    const preview = previewSelfCopy(selfEvaluations, selectedSelfForms, sourceId);
    setSelectedSelfForms((current) => ({ ...current, ...preview.changes }));
    setSelfMessage('');
  }

  function discardSelfForms() {
    setSelectedSelfForms(selfFormMap(campaign?.status === 'scheduled' ? savedSelf.current : selfEvaluations));
    setSelfMessage('');
  }

  async function handleUpdateSelfForms() {
    if (id === undefined || isSavingSelf || !hasSelfChanges || !canManageCampaigns || campaign?.status === 'closed') return;
    if (hasMatrixChanges) {
      setSelfMessage('Save or discard matrix selections before changing self-evaluation forms.');
      return;
    }
    const version = routeVersion.current;
    setIsSavingSelf(true);
    setSelfMessage('');
    try {
      const saved = await updateCampaignSelfEvaluations(getAccessTokenSilently, id, selfEvaluations.participants
        .map((person) => ({ employeeId: person.employeeId, formId: selectedSelfForms[person.employeeId] ?? null })));
      if (routeVersion.current !== version) return;
      setSelfEvaluations(saved);
      setSelectedSelfForms(selfFormMap(saved));
      setSelfMessage('Self-evaluation forms saved.');
      try {
        const controller = new AbortController();
        const [loadedMatrix, loadedCampaign, loadedRules] = await Promise.all([
          fetchCampaignEvaluationMatrix(getAccessTokenSilently, id, controller.signal),
          fetchCampaign(getAccessTokenSilently, id, controller.signal),
          fetchCampaignEvaluationRules(getAccessTokenSilently, id, controller.signal),
        ]);
        if (routeVersion.current !== version) return;
        setEvaluationMatrix(loadedMatrix);
        setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
        setCampaign(loadedCampaign);
        setEvaluationRules(loadedRules);
        setSelectedRuleFormIds(getRuleFormMap(loadedRules));
      } catch (error) {
        handleAuthError(error);
        if (routeVersion.current === version) setSelfMessage('Self-evaluation forms saved, but assignment status could not be refreshed.');
      }
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) setSelfMessage(error instanceof Error ? error.message : 'Self-evaluations could not be saved.');
    } finally {
      if (routeVersion.current === version) setIsSavingSelf(false);
    }
  }

  function activateRuleForm(
    groupId: number,
    evaluatorRoleId: number,
    evaluateeRoleId: number,
  ) {
    setActiveRuleKey(getRuleKey(groupId, evaluatorRoleId, evaluateeRoleId));
  }

  function applyRuleCopy(request: RuleCopyRequest) {
    const preview = previewRuleCopy(evaluationRules, selectedRuleFormIds, request);
    if (!Object.keys(preview.changes).length) return;
    setSelectedRuleFormIds((current) => ({ ...current, ...preview.changes }));
    setRulesMessage('');
    setSuccessMessage('');
  }

  function discardRules() {
    setSelectedRuleFormIds(getRuleFormMap(campaign?.status === 'scheduled' ? savedRules.current : evaluationRules));
    setRulesMessage('');
  }

  async function handleUpdateGroups() {
    if (id === undefined || isSavingGroups || !hasGroupChanges || !canManageCampaigns || campaign?.status === 'closed') return;
    if (hasRuleChanges || hasMatrixChanges || hasSelfChanges) {
      setGroupsMessage('Save or discard form-rule, self-evaluation and matrix changes before saving groups.');
      return;
    }
    const version = routeVersion.current;
    setIsSavingGroups(true);
    setGroupsMessage('');
    try {
      const saved = await updateCampaignGroups(getAccessTokenSilently, id, selectedGroupIds);
      if (routeVersion.current !== version) return;
      setCampaignGroups(saved);
      setSelectedGroupIds(saved.assignedGroupIds);
      const controller = new AbortController();
      const loadedRules = await fetchCampaignEvaluationRules(getAccessTokenSilently, id, controller.signal);
      const loadedMatrix = await fetchCampaignEvaluationMatrix(getAccessTokenSilently, id, controller.signal);
      const loadedSelf = await fetchCampaignSelfEvaluations(getAccessTokenSilently, id, controller.signal);
      if (routeVersion.current !== version) return;
      setEvaluationRules(loadedRules);
      setEvaluationMatrix(loadedMatrix);
      setSelfEvaluations(loadedSelf);
      setSelectedSelfForms(selfFormMap(loadedSelf));
      setSelectedRuleFormIds(getRuleFormMap(loadedRules));
      setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
      setSuccessMessage('Campaign groups updated successfully.');
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) {
        setGroupsMessage(
          error instanceof Error
            ? error.message
            : 'Campaign groups could not be updated.',
        );
      }
    } finally {
      if (routeVersion.current === version) setIsSavingGroups(false);
    }
  }

  async function handleUpdateRules() {
    if (id === undefined || isSavingRules || !hasRuleChanges || !canManageCampaigns || campaign?.status === 'closed') return;
    if (hasMatrixChanges) {
      setRulesMessage('Save or discard matrix selections before saving form rules.');
      return;
    }
    const version = routeVersion.current;
    setIsSavingRules(true);
    setRulesMessage('');
    try {
      const rulesToSave = evaluationRules.groups.flatMap((group) =>
        group.rolePairs.flatMap((pair) => {
          const formId = selectedRuleFormIds[
            getRuleKey(group.groupId, pair.evaluatorRoleId, pair.evaluateeRoleId)
          ];
          if (formId === null || formId === undefined) return [];
          return [{
            companyGroupId: group.groupId,
            evaluatorRoleId: pair.evaluatorRoleId,
            evaluateeRoleId: pair.evaluateeRoleId,
            formId,
          }];
        }),
      );
      const saved = await updateCampaignEvaluationRules(getAccessTokenSilently, id, rulesToSave);
      if (routeVersion.current !== version) return;
      setEvaluationRules(saved);
      setSelectedRuleFormIds(getRuleFormMap(saved));
      const controller = new AbortController();
      const loadedMatrix = await fetchCampaignEvaluationMatrix(getAccessTokenSilently, id, controller.signal);
      if (routeVersion.current !== version) return;
      setEvaluationMatrix(loadedMatrix);
      setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
      setSuccessMessage('Campaign form rules updated successfully.');
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) {
        setRulesMessage(
          error instanceof Error
            ? error.message
            : 'Campaign form rules could not be updated.',
        );
      }
    } finally {
      if (routeVersion.current === version) setIsSavingRules(false);
    }
  }

  async function handleUpdateMatrix() {
    if (id === undefined || isSavingMatrix || !hasMatrixChanges || matrixReadiness !== 'ready' || !canManageCampaigns || campaign?.status === 'closed') return;
    if (hasSelfChanges) {
      setMatrixMessage('Save or discard self-evaluation form changes before saving the matrix.');
      return;
    }
    const version = routeVersion.current;
    setIsSavingMatrix(true);
    setMatrixMessage('');
    try {
      const assignmentsToSave = evaluationMatrix.groups.flatMap((group) =>
        group.employees.flatMap((evaluator) =>
          group.employees.flatMap((evaluatee) => {
            const key = getMatrixKey(group.groupId, evaluator.id, evaluatee.id);
            if (!(selectedMatrixAssignments[key] ?? false)) return [];
            return [{
              companyGroupId: group.groupId,
              evaluatorId: evaluator.id,
              evaluateeId: evaluatee.id,
            }];
          }),
        ),
      );
      const saved = await updateCampaignEvaluationMatrix(getAccessTokenSilently, id, assignmentsToSave);
      if (routeVersion.current !== version) return;
      setEvaluationMatrix({ groups: saved.groups, issuanceErrors: saved.issuanceErrors });
      setSelectedMatrixAssignments(getMatrixAssignmentMap(saved));
      const controller = new AbortController();
      try {
        const [loadedMatrix, loadedSelf, loadedCampaign, loadedRules] = await Promise.all([
          fetchCampaignEvaluationMatrix(getAccessTokenSilently, id, controller.signal),
          fetchCampaignSelfEvaluations(getAccessTokenSilently, id, controller.signal),
          fetchCampaign(getAccessTokenSilently, id, controller.signal),
          fetchCampaignEvaluationRules(getAccessTokenSilently, id, controller.signal),
        ]);
        if (routeVersion.current !== version) return;
        setEvaluationMatrix(loadedMatrix);
        setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
        setSelfEvaluations(loadedSelf);
        setSelectedSelfForms(selfFormMap(loadedSelf));
        setCampaign(loadedCampaign);
        setEvaluationRules(loadedRules);
        setSelectedRuleFormIds(getRuleFormMap(loadedRules));
      } catch (error) {
        handleAuthError(error);
        if (routeVersion.current === version) setMatrixMessage('Matrix saved, but the latest assignment details could not be refreshed.');
      }
      if (routeVersion.current !== version) return;
      setSuccessMessage(
        `Evaluation matrix updated. Created: ${saved.createdCount}, removed: ${saved.removedCount}${
          saved.keptCompletedCount > 0
            ? `, kept completed: ${saved.keptCompletedCount}`
            : ''
        }.`,
      );
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version) {
        setMatrixMessage(
          error instanceof Error
            ? error.message
            : 'Campaign evaluation matrix could not be updated.',
        );
      }
    } finally {
      if (routeVersion.current === version) setIsSavingMatrix(false);
    }
  }

  async function handleUpdateCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaign || saving.current || !hasEditChanges || !canManageCampaigns || campaign.status === 'closed') return;
    const validation = getCampaignValidationError(form, campaign);
    if (validation) {
      setSaveMessage(validation);
      return;
    }
    const version = routeVersion.current;
    saving.current = true;
    setIsSavingCampaign(true);
    setSaveMessage('');
    try {
      const saved = await updateCampaign(getAccessTokenSilently, campaign, form);
      if (routeVersion.current !== version) return;
      if (saved.issuedFormsCount > campaign.issuedFormsCount || saved.status !== campaign.status) {
        setEvaluationMatrix({ groups: [] });
        setSelectedMatrixAssignments({});
      }
      setCampaign(saved);
      setForm(getCampaignForm(saved));
      setIsEditOpen(false);
      setSuccessMessage('Campaign updated successfully.');
      try {
        const controller = new AbortController();
        const [loadedMatrix, loadedSelf] = await Promise.all([
          fetchCampaignEvaluationMatrix(getAccessTokenSilently, campaign.id, controller.signal),
          fetchCampaignSelfEvaluations(getAccessTokenSilently, campaign.id, controller.signal),
        ]);
        if (routeVersion.current !== version) return;
        setEvaluationMatrix(loadedMatrix);
        setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
        setSelfEvaluations(loadedSelf);
        setSelectedSelfForms(selfFormMap(loadedSelf));
      } catch (error) {
        handleAuthError(error);
        if (routeVersion.current === version) setMatrixMessage('Campaign updated, but assignments could not be refreshed. Reload to see their current status.');
      }
    } catch (error) {
      handleAuthError(error);
      if (routeVersion.current === version)
        setSaveMessage(
          error instanceof Error
            ? error.message
            : 'Campaign could not be updated.',
        );
    } finally {
      if (routeVersion.current === version) {
        saving.current = false;
        setIsSavingCampaign(false);
      }
    }
  }
  return {
    canManageCampaigns,
    campaign,
    form,
    isEditOpen,
    isCampaignLoading,
    isSavingCampaign,
    campaignError,
    campaignGroups,
    evaluationRules,
    evaluationMatrix,
    selfEvaluations,
    persistedEvaluationRules: savedRules.current,
    persistedEvaluationMatrix: savedMatrix.current,
    persistedSelfEvaluations: savedSelf.current,
    selectedSelfForms,
    selfMessage,
    isSavingSelf,
    hasSelfChanges,
    updateSelfForm,
    copySelfForm,
    discardSelfForms,
    handleUpdateSelfForms,
    selectedGroupIds,
    selectedRuleFormIds,
    selectedMatrixAssignments,
    activeRuleKey,
    groupsMessage,
    rulesMessage,
    matrixMessage,
    saveMessage,
    successMessage,
    actionMessage,
    isChangingSchedule,
    confirmationAction,
    operationalMetrics,
    confirmationError,
    isLoadingMetrics,
    isChangingLifecycle,
    openLifecycleConfirmation,
    closeLifecycleConfirmation,
    handleLifecycleAction,
    isSavingSetup,
    isSetupPreviewLoading,
    setupPreviewError,
    handleUpdateSetup,
    handleScheduleAction,
    isSavingGroups,
    isSavingRules,
    isSavingMatrix,
    hasEditChanges,
    hasGroupChanges,
    hasRuleChanges,
    hasMatrixChanges,
    formProgress,
    matrixReadiness,
    updateForm,
    toggleGroup,
    updateRuleForm,
    toggleMatrixAssignment,
    applyMatrixSelectAll,
    applyMatrixSelfEvaluations,
    applyMatrixMinimumReviewers,
    applyMatrixDeleteAll,
    discardMatrix,
    activateRuleForm,
    applyRuleCopy,
    discardRules,
    handleUpdateGroups,
    handleUpdateRules,
    handleUpdateMatrix,
    openEdit,
    closeEdit,
    handleUpdateCampaign,
  };
}
