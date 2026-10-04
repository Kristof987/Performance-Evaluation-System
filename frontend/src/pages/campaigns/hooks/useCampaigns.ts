import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Campaign,
  CampaignFormValues,
  CampaignStatusFilter,
  UpdateCampaignField,
} from '../campaign.types';
import { emptyCampaignForm } from '../campaign.utils';
import { createCampaign, fetchCampaigns } from '../campaign.api';
import { formatUserName } from '../../layout/sidebar-user';

function getCurrentUser(): { id: number; username: string } | null {
  try {
    const user: unknown = JSON.parse(
      sessionStorage.getItem('loggedInUser') ?? 'null',
    );
    if (
      user &&
      typeof user === 'object' &&
      'id' in user &&
      typeof user.id === 'number' &&
      'username' in user &&
      typeof user.username === 'string'
    ) {
      return { id: user.id, username: user.username };
    }
  } catch {
    /* Invalid stored login is treated as signed out. */
  }
  return null;
}

export function useCampaigns() {
  const [campaignList, setCampaignList] = useState<Campaign[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<CampaignStatusFilter>('All statuses');
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<CampaignFormValues>(emptyCampaignForm);
  const [createMessage, setCreateMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const saving = useRef(false);
  const currentUser = getCurrentUser();
  const filteredCampaigns = campaignList.filter(
    (campaign) =>
      campaign.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) &&
      (statusFilter === 'All statuses' || campaign.status === statusFilter),
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchCampaigns(controller.signal)
      .then((campaigns) => {
        if (!controller.signal.aborted) setCampaignList(campaigns);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCampaignsError('Campaigns could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsCampaignsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const updateForm: UpdateCampaignField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setCreateMessage('');
  };
  function openCreate() {
    setSuccessMessage('');
    setCreateMessage('');
    setIsCreateOpen(true);
  }
  function closeCreate() {
    if (saving.current) return;
    setIsCreateOpen(false);
    setForm(emptyCampaignForm);
    setCreateMessage('');
  }
  async function handleCreateCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const user = getCurrentUser();
    if (!user) {
      setCreateMessage('Please sign in before creating a campaign.');
      return;
    }
    if (form.endDate !== '' && form.endDate < form.startDate) {
      setCreateMessage('End date cannot be earlier than the start date.');
      return;
    }
    saving.current = true;
    setIsSavingCampaign(true);
    setCreateMessage('');
    try {
      const saved = await createCampaign(form, user.id);
      setCampaignList((current) => [saved, ...current]);
      setIsCreateOpen(false);
      setForm(emptyCampaignForm);
      setSuccessMessage('Campaign saved successfully.');
    } catch (error) {
      setCreateMessage(
        error instanceof Error ? error.message : 'Campaign could not be saved.',
      );
    } finally {
      saving.current = false;
      setIsSavingCampaign(false);
    }
  }
  return {
    campaignList,
    filteredCampaigns,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    isCampaignsLoading,
    campaignsError,
    isCreateOpen,
    form,
    createMessage,
    successMessage,
    isSavingCampaign,
    createdByName: currentUser ? formatUserName(currentUser.username) : 'User',
    updateForm,
    openCreate,
    closeCreate,
    handleCreateCampaign,
  };
}
