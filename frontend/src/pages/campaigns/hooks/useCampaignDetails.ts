import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Campaign,
  CampaignEvaluationMatrix,
  CampaignEvaluationRules,
  CampaignFormValues,
  CampaignGroups,
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
  updateCampaign,
  updateCampaignEvaluationMatrix,
  updateCampaignEvaluationRules,
  updateCampaignGroups,
  updateCampaignSelfEvaluations,
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
      if (assignment.evaluatorId === assignment.evaluateeId) selfIds.add(assignment.evaluatorId);
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
    setForm(emptyCampaignForm);
    setCampaignError('');
    setGroupsMessage('');
    setRulesMessage('');
    setMatrixMessage('');
    setIsEditOpen(false);
    setSaveMessage('');
    setSuccessMessage('');
    saving.current = false;
    setIsSavingCampaign(false);
    setIsCampaignLoading(true);
    if (id === undefined) {
      setCampaignError('Campaign not found.');
      setIsCampaignLoading(false);
    } else {
      Promise.all([
        fetchCampaign(id, controller.signal),
        fetchCampaignGroups(id, controller.signal),
        fetchCampaignEvaluationRules(id, controller.signal),
        fetchCampaignEvaluationMatrix(id, controller.signal),
        fetchCampaignSelfEvaluations(id, controller.signal),
      ])
        .then(([loaded, loadedGroups, loadedRules, loadedMatrix, loadedSelf]) => {
          if (!controller.signal.aborted) {
            setCampaign(loaded);
            setCampaignGroups(loadedGroups);
            setEvaluationRules(loadedRules);
            setEvaluationMatrix(loadedMatrix);
            setSelfEvaluations(loadedSelf);
            setSelectedSelfForms(selfFormMap(loadedSelf));
            setSelectedRuleFormIds(getRuleFormMap(loadedRules));
            setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
            setSelectedGroupIds(loadedGroups.assignedGroupIds);
            setForm(getCampaignForm(loaded));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setCampaignError('Campaign could not be loaded.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsCampaignLoading(false);
        });
    }
    return () => {
      controller.abort();
      if (routeVersion.current === version) routeVersion.current++;
    };
  }, [id]);

  const updateForm: UpdateCampaignField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveMessage('');
    setSuccessMessage('');
  };
  function openEdit() {
    if (!campaign) return;
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
  const hasEditChanges =
    campaign !== null &&
    !areCampaignFormsEqual(form, getCampaignForm(campaign));
  const hasGroupChanges = !areGroupIdsEqual(
    selectedGroupIds,
    campaignGroups.assignedGroupIds,
  );
  const hasRuleChanges = !areRuleFormMapsEqual(
    selectedRuleFormIds,
    getRuleFormMap(evaluationRules),
  );
  const hasMatrixChanges = matrixDirty(selectedMatrixAssignments, getMatrixAssignmentMap(evaluationMatrix));
  const hasSelfChanges = selfFormsDirty(selfEvaluations, selectedSelfForms);
  const formProgress = getFormAssignmentProgress(evaluationRules, selectedRuleFormIds);
  const matrixReadiness = getMatrixReadiness(formProgress, hasGroupChanges, hasRuleChanges);

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
    if (evaluatorId === evaluateeId && hasSelfChanges) return;
    setSelectedMatrixAssignments((current) => {
      const next = toggleMatrixPair(group, evaluationRules, current, evaluatorId, evaluateeId, selectedSelfForms);
      return next === current || evaluatorId !== evaluateeId ? next : synchronizeSelfPair(evaluationMatrix.groups, next, evaluatorId, Boolean(next[matrixKey(groupId, evaluatorId, evaluateeId)]));
    });
    setMatrixMessage('');
    setSuccessMessage('');
  }

  function applyMatrixSelectAll(groupId: number) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (group === undefined || matrixReadiness !== 'ready') return;
    if (hasSelfChanges) return;
    let next = selectMatrixPairs(group, evaluationRules, selectedMatrixAssignments, false, selectedSelfForms);
    for (const person of group.employees) {
      if (next[matrixKey(groupId, person.id, person.id)]) next = synchronizeSelfPair(evaluationMatrix.groups, next, person.id, true);
    }
    setSelectedMatrixAssignments(next);
    setMatrixMessage(matrixDirty(next, selectedMatrixAssignments) ? '' : 'All eligible pairs are already selected.');
    setSuccessMessage('');
  }

  function applyMatrixSelfEvaluations(groupId: number) {
    const rawGroup = evaluationMatrix.groups.find((item) => item.groupId === groupId);
    const group = rawGroup && matrixGroupWithSelfLocks(evaluationMatrix, rawGroup);
    if (group === undefined || matrixReadiness !== 'ready') return;
    if (hasSelfChanges) return;
    let next = selectMatrixPairs(group, evaluationRules, selectedMatrixAssignments, true, selectedSelfForms);
    const missing = group.employees.filter((person) => selectedSelfForms[person.id] == null &&
      !group.assignments.some((item) => item.evaluatorId === person.id && item.evaluateeId === person.id)).length;
    const protectedCount = group.employees.filter((person) => group.assignments.some((item) =>
      item.evaluatorId === person.id && item.evaluateeId === person.id)).length;
    for (const person of group.employees) {
      if (next[matrixKey(groupId, person.id, person.id)]) next = synchronizeSelfPair(evaluationMatrix.groups, next, person.id, true);
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
        if (!next[matrixKey(groupId, person.id, person.id)]) next = synchronizeSelfPair(evaluationMatrix.groups, next, person.id, false);
      }
      return next;
    });
    setMatrixMessage('');
    setSuccessMessage('');
  }

  function discardMatrix() {
    setSelectedMatrixAssignments(getMatrixAssignmentMap(evaluationMatrix));
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
    setSelectedSelfForms(selfFormMap(selfEvaluations));
    setSelfMessage('');
  }

  async function handleUpdateSelfForms() {
    if (id === undefined || isSavingSelf || !hasSelfChanges) return;
    if (hasMatrixChanges) {
      setSelfMessage('Save or discard matrix selections before changing self-evaluation forms.');
      return;
    }
    const version = routeVersion.current;
    setIsSavingSelf(true);
    setSelfMessage('');
    try {
      const saved = await updateCampaignSelfEvaluations(id, selfEvaluations.participants
        .map((person) => ({ employeeId: person.employeeId, formId: selectedSelfForms[person.employeeId] ?? null })));
      if (routeVersion.current !== version) return;
      setSelfEvaluations(saved);
      setSelectedSelfForms(selfFormMap(saved));
      setSelfMessage('Self-evaluation forms saved.');
    } catch (error) {
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
    setSelectedRuleFormIds(getRuleFormMap(evaluationRules));
    setRulesMessage('');
  }

  async function handleUpdateGroups() {
    if (id === undefined || isSavingGroups || !hasGroupChanges) return;
    if (hasRuleChanges || hasMatrixChanges || hasSelfChanges) {
      setGroupsMessage('Save or discard form-rule, self-evaluation and matrix changes before saving groups.');
      return;
    }
    const version = routeVersion.current;
    setIsSavingGroups(true);
    setGroupsMessage('');
    try {
      const saved = await updateCampaignGroups(id, selectedGroupIds);
      if (routeVersion.current !== version) return;
      setCampaignGroups(saved);
      setSelectedGroupIds(saved.assignedGroupIds);
      const controller = new AbortController();
      const loadedRules = await fetchCampaignEvaluationRules(id, controller.signal);
      const loadedMatrix = await fetchCampaignEvaluationMatrix(id, controller.signal);
      const loadedSelf = await fetchCampaignSelfEvaluations(id, controller.signal);
      if (routeVersion.current !== version) return;
      setEvaluationRules(loadedRules);
      setEvaluationMatrix(loadedMatrix);
      setSelfEvaluations(loadedSelf);
      setSelectedSelfForms(selfFormMap(loadedSelf));
      setSelectedRuleFormIds(getRuleFormMap(loadedRules));
      setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
      setSuccessMessage('Campaign groups updated successfully.');
    } catch (error) {
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
    if (id === undefined || isSavingRules || !hasRuleChanges) return;
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
      const saved = await updateCampaignEvaluationRules(id, rulesToSave);
      if (routeVersion.current !== version) return;
      setEvaluationRules(saved);
      setSelectedRuleFormIds(getRuleFormMap(saved));
      const controller = new AbortController();
      const loadedMatrix = await fetchCampaignEvaluationMatrix(id, controller.signal);
      if (routeVersion.current !== version) return;
      setEvaluationMatrix(loadedMatrix);
      setSelectedMatrixAssignments(getMatrixAssignmentMap(loadedMatrix));
      setSuccessMessage('Campaign form rules updated successfully.');
    } catch (error) {
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
    if (id === undefined || isSavingMatrix || !hasMatrixChanges || matrixReadiness !== 'ready') return;
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
      const saved = await updateCampaignEvaluationMatrix(id, assignmentsToSave);
      if (routeVersion.current !== version) return;
      setEvaluationMatrix({ groups: saved.groups });
      setSelectedMatrixAssignments(getMatrixAssignmentMap(saved));
      setSuccessMessage(
        `Evaluation matrix updated. Created: ${saved.createdCount}, removed: ${saved.removedCount}${
          saved.keptCompletedCount > 0
            ? `, kept completed: ${saved.keptCompletedCount}`
            : ''
        }.`,
      );
    } catch (error) {
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
    if (!campaign || saving.current || !hasEditChanges) return;
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
      const saved = await updateCampaign(campaign.id, form);
      if (routeVersion.current !== version) return;
      setCampaign(saved);
      setForm(getCampaignForm(saved));
      setIsEditOpen(false);
      setSuccessMessage('Campaign updated successfully.');
    } catch (error) {
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
