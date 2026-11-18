import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type {
  Campaign,
  CampaignFormValues,
  CampaignStatusFilter,
  UpdateCampaignField,
} from '../campaign.types';
import { emptyCampaignForm, validateCampaignTimes } from '../campaign.utils';
import { createCampaign, fetchCampaigns } from '../campaign.api';
import { formatUserName } from '../../layout/sidebar-user';
import { useAppAuth } from '../../../auth/AppAuth';
import { ApiAccessError } from '../../../auth/authenticated-api';
import { useToast } from '../../../components/feedback/feedback-context';

export function useCampaigns() {
  const navigate = useNavigate();
  const { state, retryAuth0, getAccessToken: getAccessTokenSilently } = useAppAuth();
  const user = state.status === 'authenticated' && state.mode === 'auth0' ? state.user : null;
  const canManageCampaigns = user?.permissions.includes('campaigns.manage') ?? false;
  const [campaignList, setCampaignList] = useState<Campaign[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<CampaignStatusFilter>('All statuses');
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<CampaignFormValues>(emptyCampaignForm);
  const [createMessage, setCreateMessage] = useState('');
  const toast = useToast();
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const saving = useRef(false);
  const filteredCampaigns = campaignList.filter(
    (campaign) =>
      campaign.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) &&
      (statusFilter === 'Archived' ? campaign.isArchived :
        !campaign.isArchived && (statusFilter === 'All statuses' || campaign.status === statusFilter)),
  );
  const summaryCampaigns = campaignList.filter((campaign) =>
    statusFilter === 'Archived' ? campaign.isArchived : !campaign.isArchived);

  useEffect(() => {
    const controller = new AbortController();
    fetchCampaigns(getAccessTokenSilently, controller.signal)
      .then((campaigns) => {
        if (!controller.signal.aborted) setCampaignList(campaigns);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiAccessError) retryAuth0();
        if (!controller.signal.aborted)
          setCampaignsError(error instanceof ApiAccessError ? error.message : 'Campaigns could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsCampaignsLoading(false);
      });
    return () => controller.abort();
  }, [getAccessTokenSilently]);

  const updateForm: UpdateCampaignField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setCreateMessage('');
  };
  function openCreate() {
    if (!canManageCampaigns) return;
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
    if (saving.current || !canManageCampaigns) {
      setCreateMessage('You do not have permission to create campaigns.');
      return;
    }
    const validation = validateCampaignTimes(form);
    if (validation) {
      setCreateMessage(validation);
      return;
    }
    saving.current = true;
    setIsSavingCampaign(true);
    setCreateMessage('');
    try {
      const saved = await createCampaign(getAccessTokenSilently, form);
      setCampaignList((current) => [saved, ...current]);
       setIsCreateOpen(false);
       setForm(emptyCampaignForm);
       toast.success(`“${saved.name}” created as a draft`);
       navigate(`/campaigns/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiAccessError) retryAuth0();
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
    summaryCampaigns,
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
    isSavingCampaign,
    canManageCampaigns,
    createdByName: user ? formatUserName(user.username) : 'User',
    updateForm,
    openCreate,
    closeCreate,
    handleCreateCampaign,
  };
}
