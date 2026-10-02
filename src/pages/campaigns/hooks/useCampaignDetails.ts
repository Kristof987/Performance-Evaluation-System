import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Campaign,
  CampaignFormValues,
  UpdateCampaignField,
} from '../campaign.types';
import {
  areCampaignFormsEqual,
  emptyCampaignForm,
  getCampaignForm,
  getCampaignValidationError,
} from '../campaign.utils';
import { fetchCampaign, updateCampaign } from '../campaign.api';

export function useCampaignDetails(id: string | undefined) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState<CampaignFormValues>(emptyCampaignForm);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCampaignLoading, setIsCampaignLoading] = useState(true);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const saving = useRef(false);
  const routeVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++routeVersion.current;
    setCampaign(null);
    setForm(emptyCampaignForm);
    setCampaignError('');
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
      fetchCampaign(id, controller.signal)
        .then((loaded) => {
          if (!controller.signal.aborted) {
            setCampaign(loaded);
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
    saveMessage,
    successMessage,
    hasEditChanges,
    updateForm,
    openEdit,
    closeEdit,
    handleUpdateCampaign,
  };
}
