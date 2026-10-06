import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Campaign,
  CampaignEvaluationRules,
  CampaignFormValues,
  CampaignGroups,
  UpdateCampaignField,
} from '../campaign.types';
import {
  areCampaignFormsEqual,
  emptyCampaignForm,
  getCampaignForm,
  getCampaignValidationError,
} from '../campaign.utils';
import {
  fetchCampaign,
  fetchCampaignEvaluationRules,
  fetchCampaignGroups,
  updateCampaign,
  updateCampaignEvaluationRules,
  updateCampaignGroups,
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
  const [selectedRuleFormIds, setSelectedRuleFormIds] = useState<Record<string, number | null>>({});
  const [activeRuleKey, setActiveRuleKey] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [form, setForm] = useState<CampaignFormValues>(emptyCampaignForm);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCampaignLoading, setIsCampaignLoading] = useState(true);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [groupsMessage, setGroupsMessage] = useState('');
  const [rulesMessage, setRulesMessage] = useState('');
  const [isSavingGroups, setIsSavingGroups] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
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
    setSelectedRuleFormIds({});
    setActiveRuleKey(null);
    setSelectedGroupIds([]);
    setForm(emptyCampaignForm);
    setCampaignError('');
    setGroupsMessage('');
    setRulesMessage('');
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
      ])
        .then(([loaded, loadedGroups, loadedRules]) => {
          if (!controller.signal.aborted) {
            setCampaign(loaded);
            setCampaignGroups(loadedGroups);
            setEvaluationRules(loadedRules);
            setSelectedRuleFormIds(getRuleFormMap(loadedRules));
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

  function toggleGroup(groupId: number) {
    setSelectedGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
    setGroupsMessage('');
    setRulesMessage('');
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
    setSuccessMessage('');
  }

  function activateRuleForm(
    groupId: number,
    evaluatorRoleId: number,
    evaluateeRoleId: number,
  ) {
    setActiveRuleKey(getRuleKey(groupId, evaluatorRoleId, evaluateeRoleId));
  }

  function applyRuleToMatchingGroups(
    sourceGroupId: number,
    evaluatorRoleId: number,
    evaluateeRoleId: number,
  ) {
    const sourceKey = getRuleKey(sourceGroupId, evaluatorRoleId, evaluateeRoleId);
    const sourceFormId = selectedRuleFormIds[sourceKey] ?? null;

    setSelectedRuleFormIds((current) => {
      const next = { ...current };
      for (const group of evaluationRules.groups) {
        if (group.groupId === sourceGroupId) continue;
        const hasMatchingPair = group.rolePairs.some(
          (pair) =>
            pair.evaluatorRoleId === evaluatorRoleId &&
            pair.evaluateeRoleId === evaluateeRoleId,
        );
        if (!hasMatchingPair) continue;
        next[getRuleKey(group.groupId, evaluatorRoleId, evaluateeRoleId)] = sourceFormId;
      }
      return next;
    });
    setRulesMessage('');
    setSuccessMessage('');
  }

  function applyGroupRulesToMatchingGroups(sourceGroupId: number) {
    const sourceGroup = evaluationRules.groups.find(
      (group) => group.groupId === sourceGroupId,
    );
    if (sourceGroup === undefined) return;

    const sourceValues = new Map(
      sourceGroup.rolePairs.map((pair) => [
        `${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`,
        selectedRuleFormIds[
          getRuleKey(sourceGroup.groupId, pair.evaluatorRoleId, pair.evaluateeRoleId)
        ] ?? null,
      ]),
    );

    setSelectedRuleFormIds((current) => {
      const next = { ...current };
      for (const group of evaluationRules.groups) {
        if (group.groupId === sourceGroupId) continue;
        for (const pair of group.rolePairs) {
          const sourceFormId = sourceValues.get(
            `${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`,
          );
          if (sourceFormId === undefined) continue;
          next[getRuleKey(group.groupId, pair.evaluatorRoleId, pair.evaluateeRoleId)] = sourceFormId;
        }
      }
      return next;
    });
    setRulesMessage('');
    setSuccessMessage('');
  }

  async function handleUpdateGroups() {
    if (id === undefined || isSavingGroups || !hasGroupChanges) return;
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
      if (routeVersion.current !== version) return;
      setEvaluationRules(loadedRules);
      setSelectedRuleFormIds(getRuleFormMap(loadedRules));
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
    selectedGroupIds,
    selectedRuleFormIds,
    activeRuleKey,
    groupsMessage,
    rulesMessage,
    saveMessage,
    successMessage,
    isSavingGroups,
    isSavingRules,
    hasEditChanges,
    hasGroupChanges,
    hasRuleChanges,
    updateForm,
    toggleGroup,
    updateRuleForm,
    activateRuleForm,
    applyRuleToMatchingGroups,
    applyGroupRulesToMatchingGroups,
    handleUpdateGroups,
    handleUpdateRules,
    openEdit,
    closeEdit,
    handleUpdateCampaign,
  };
}
