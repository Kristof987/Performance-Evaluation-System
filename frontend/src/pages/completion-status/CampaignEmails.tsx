import { useEffect, useState, type FormEvent } from 'react';
import { useAppAuth } from '../../auth/AppAuth';
import InlineMessage from '../../components/feedback/InlineMessage';
import { useConfirm, useToast } from '../../components/feedback/feedback-context';
import Pending from '../../components/feedback/Pending';
import LoadingState from '../../components/feedback/LoadingState';
import { useDates } from '../../app/dates';
import {
  addCampaignReminder,
  deleteCampaignReminder,
  fetchCampaignEmails,
  fetchReminderRecipients,
  reminderDayLabel,
  resetCampaignReminders,
  sendReminderNow,
  setLaunchEmail,
  type CampaignEmailOverview,
  type ReminderRecipient,
} from './campaignEmails.api';

type Audience = 'everyone' | 'not_started' | 'in_progress';

function ReminderDialog({ campaignId, onClose, onSent }: {
  campaignId: number; onClose: () => void; onSent: (text: string, failed: boolean) => void;
}) {
  const dates = useDates();
  const { getAccessToken } = useAppAuth();
  const [recipients, setRecipients] = useState<ReminderRecipient[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!getAccessToken) return;
    let active = true;
    fetchReminderRecipients(getAccessToken, campaignId)
      .then((items) => {
        if (!active) return;
        setRecipients(items);
        setSelected(new Set(items.filter((item) => !item.recently_reminded).map((item) => item.employee_id)));
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Recipients could not be loaded.'); });
    return () => { active = false; };
  }, [campaignId, getAccessToken]);

  function choose(audience: Audience) {
    if (!recipients) return;
    setSelected(new Set(recipients.filter((item) => !item.recently_reminded && (audience === 'everyone'
      || (audience === 'not_started' ? item.not_started > 0 : item.in_progress > 0))).map((item) => item.employee_id)));
  }

  function toggle(employeeId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId); else next.add(employeeId);
      return next;
    });
  }

  async function send() {
    if (!getAccessToken || selected.size === 0 || sending) return;
    setSending(true); setError('');
    try {
      const result = await sendReminderNow(getAccessToken, campaignId, [...selected]);
      const parts = [`${result.sent} sent`];
      if (result.skipped_recently_reminded) parts.push(`${result.skipped_recently_reminded} skipped (reminded in the last 24 hours)`);
      if (result.failed) parts.push(`${result.failed} couldn’t be delivered`);
      onSent(`Reminder emails: ${parts.join(', ')}`, result.failed > 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reminder emails could not be sent.');
      setSending(false);
    }
  }

  const query = search.trim().toLowerCase();
  const visible = (recipients ?? []).filter((item) => !query || item.name.toLowerCase().includes(query) || item.email.toLowerCase().includes(query));
  return <div className="modal-backdrop open" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !sending) onClose(); }}>
    <div className="modal campaign-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="reminderDialogTitle">
      <div className="modal-head">
        <div>
          <h2 id="reminderDialogTitle">Send reminder email</h2>
          <p>Only people with unfinished evaluations are listed. Each person gets at most one manual reminder per 24 hours.</p>
        </div>
        <button className="close" type="button" onClick={onClose} disabled={sending} aria-label="Close">×</button>
      </div>
      <div className="modal-body">
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {recipients === null && !error && <LoadingState variant="section" label="Loading recipients" />}
        {recipients !== null && recipients.length === 0 && <p className="completion-emails-muted">Everyone has finished their evaluations.</p>}
        {recipients !== null && recipients.length > 0 && <>
          <div className="campaign-reminder-quick" role="group" aria-label="Quick selection">
            <span>Select:</span>
            <button className="btn btn-secondary" type="button" onClick={() => choose('everyone')}>Everyone not finished</button>
            <button className="btn btn-secondary" type="button" onClick={() => choose('not_started')}>Not started</button>
            <button className="btn btn-secondary" type="button" onClick={() => choose('in_progress')}>In progress</button>
            <button className="btn btn-secondary" type="button" onClick={() => setSelected(new Set())}>None</button>
          </div>
          <input className="form-control" value={search} placeholder="Search people" aria-label="Search people"
            onChange={(event) => setSearch(event.target.value)} />
          <ul className="campaign-reminder-people">
            {visible.map((item) => <li key={item.employee_id}>
              <label>
                <input type="checkbox" checked={selected.has(item.employee_id)} disabled={item.recently_reminded || sending}
                  onChange={() => toggle(item.employee_id)} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.email}</small>
                </span>
                <span className="campaign-reminder-counts">
                  {item.not_started > 0 && <em className="not-started">{item.not_started} not started</em>}
                  {item.in_progress > 0 && <em className="in-progress">{item.in_progress} in progress</em>}
                  {item.last_reminded_at && <small>{item.recently_reminded ? 'Reminded today' : `Last reminded ${dates.day(item.last_reminded_at)}`}</small>}
                </span>
              </label>
            </li>)}
          </ul>
        </>}
        <div className="modal-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={sending}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={() => void send()} disabled={sending || selected.size === 0}>
            {sending ? <Pending label="Sending" /> : `Send to ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`}
          </button>
        </div>
      </div>
    </div>
  </div>;
}

/** Launch email, scheduled reminders and manual reminders for one campaign. */
export default function CampaignEmails({ campaignId, isActive, hasEndDate }: { campaignId: number; isActive: boolean; hasEndDate: boolean }) {
  const dates = useDates();
  const { state, getAccessToken } = useAppAuth();
  const canManage = state.status === 'authenticated' && state.user.permissions.includes('campaigns.manage');
  const [data, setData] = useState<CampaignEmailOverview | null>(null);
  const [days, setDays] = useState('3');
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (!getAccessToken) return;
    const controller = new AbortController();
    fetchCampaignEmails(getAccessToken, campaignId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Campaign emails could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, getAccessToken]);

  async function run(action: () => Promise<CampaignEmailOverview>, success: string) {
    if (!getAccessToken || busy) return;
    setBusy(true); setError('');
    try {
      setData(await action());
      toast.success(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign emails could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  function addReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(days);
    if (!getAccessToken || !Number.isInteger(value) || value < 0 || value > 90) return;
    void run(() => addCampaignReminder(getAccessToken, campaignId, value), `Reminder added: ${reminderDayLabel(value).toLowerCase()}`);
  }

  async function afterSend(text: string, failed: boolean) {
    setDialogOpen(false);
    if (failed) toast.warning(`${text}. Check the email settings, then try again for those people.`);
    else toast.success(text);
    if (getAccessToken) setData(await fetchCampaignEmails(getAccessToken, campaignId).catch(() => data));
  }

  const sendBlocked = !data || !isActive || !data.email_configured || data.open_recipients === 0;
  return <section className="card card-padded completion-emails" aria-labelledby={`campaignEmailsTitle-${campaignId}`}>
    <div className="completion-emails-head">
      <div>
        <h2 id={`campaignEmailsTitle-${campaignId}`}>Email reminders</h2>
        <p>Everyone with evaluations gets an email when the campaign opens, then the reminders below.</p>
      </div>
      {canManage && data && <button className="btn btn-primary" type="button" disabled={sendBlocked || busy}
        title={!isActive ? 'Reminders can be sent while the campaign is active.' : data.open_recipients === 0 ? 'Everyone has finished.' : undefined}
        onClick={() => setDialogOpen(true)}>Send reminder…</button>}
    </div>

    {error && <InlineMessage tone="error" onDismiss={data ? () => setError('') : undefined}>{error}</InlineMessage>}
    {data && !data.email_configured && <InlineMessage tone="warning">Email sending isn’t configured on the server, so no emails go out yet.</InlineMessage>}
    {!data && !error && <LoadingState variant="section" label="Loading email schedule" />}

    {data && <>
      <p className="completion-emails-muted">
        {data.uses_workspace_defaults ? 'This campaign follows the workspace default reminders (Settings → Email reminders).' : 'This campaign has its own reminders.'}
        {data.open_recipients > 0 && ` ${data.open_recipients} ${data.open_recipients === 1 ? 'person has' : 'people have'} unfinished evaluations.`}
      </p>
      <ul className="completion-emails-list">
        <li>
          <div><strong>When the campaign opens</strong><span>{data.launch_sent_count > 0 ? `Sent to ${data.launch_sent_count}` : data.launch_email_enabled ? 'Scheduled' : 'Off'}</span></div>
          {canManage && <label className="completion-check"><input type="checkbox" checked={data.launch_email_enabled} disabled={busy}
            onChange={(event) => { const enabled = event.target.checked; if (getAccessToken) void run(() => setLaunchEmail(getAccessToken, campaignId, enabled), enabled ? 'Launch email turned on' : 'Launch email turned off'); }} /> Send</label>}
        </li>
        {data.reminders.map((reminder) => <li key={reminder.days_before_end}>
          <div>
            <strong>{reminderDayLabel(reminder.days_before_end)}{data.uses_workspace_defaults ? ' · default' : ''}</strong>
            <span>{reminder.scheduled_for ? dates.day(reminder.scheduled_for) : 'No end date'} · {reminder.sent_count > 0 ? `Sent to ${reminder.sent_count}` : 'Scheduled'}</span>
          </div>
          {canManage && <button className="btn btn-secondary" type="button" disabled={busy}
            onClick={() => { if (getAccessToken) void run(() => deleteCampaignReminder(getAccessToken, campaignId, reminder.days_before_end), `Reminder removed: ${reminderDayLabel(reminder.days_before_end).toLowerCase()}`); }}>Remove</button>}
        </li>)}
        {data.reminders.length === 0 && <li><span className="completion-emails-muted">No reminders before the end date.</span></li>}
      </ul>
    </>}

    {data && canManage && <div className="completion-emails-footer">
      <form className="completion-emails-add" onSubmit={addReminder}>
        <label htmlFor={`reminderDays-${campaignId}`}>Add reminder</label>
        <input id={`reminderDays-${campaignId}`} className="form-control" type="number" min={0} max={90} step={1} value={days} onChange={(event) => setDays(event.target.value)} />
        <span>days before the end</span>
        <button className="btn btn-secondary" type="submit" disabled={busy || !hasEndDate || days === ''}
          title={hasEndDate ? undefined : 'Set a campaign end date first.'}>Add</button>
      </form>
      {!data.uses_workspace_defaults && <button className="btn btn-secondary" type="button" disabled={busy}
        onClick={async () => {
          if (!getAccessToken || !(await confirm({
            title: 'Use the workspace default reminders?',
            message: 'This campaign’s own reminder schedule is replaced by the defaults from Settings. Reminders already sent are not affected.',
            confirmLabel: 'Use defaults',
          }))) return;
          void run(() => resetCampaignReminders(getAccessToken, campaignId), 'This campaign follows the workspace defaults again');
        }}>Use workspace defaults</button>}
    </div>}
    {data && data.failed_count > 0 && <InlineMessage tone="warning">{data.failed_count} {data.failed_count === 1 ? 'email' : 'emails'} couldn’t be delivered.</InlineMessage>}
    {data?.manual_last_sent_at && <p className="completion-emails-muted">Last manual reminder: {dates.day(data.manual_last_sent_at)}</p>}
    {dialogOpen && <ReminderDialog campaignId={campaignId} onClose={() => setDialogOpen(false)} onSent={(text, failed) => void afterSend(text, failed)} />}
  </section>;
}
