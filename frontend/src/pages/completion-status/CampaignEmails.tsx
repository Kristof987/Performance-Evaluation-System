import { useEffect, useState, type FormEvent } from 'react';
import { useAppAuth } from '../../auth/AppAuth';
import { formatShortDate } from '../hr-home/utils/hrHome.utils';
import {
  addCampaignReminder,
  deleteCampaignReminder,
  fetchCampaignEmails,
  sendReminderNow,
  setLaunchEmail,
  type CampaignEmailOverview,
} from './campaignEmails.api';

function dayLabel(days: number) {
  if (days === 0) return 'On the last day';
  return `${days} ${days === 1 ? 'day' : 'days'} before the end`;
}

/** Launch email, HR-scheduled reminders and a manual "remind now" for one campaign. */
export default function CampaignEmails({ campaignId, isActive, hasEndDate }: { campaignId: number; isActive: boolean; hasEndDate: boolean }) {
  const { state, getAccessToken } = useAppAuth();
  const canManage = state.status === 'authenticated' && state.user.permissions.includes('campaigns.manage');
  const [data, setData] = useState<CampaignEmailOverview | null>(null);
  const [days, setDays] = useState('3');
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!getAccessToken) return;
    const controller = new AbortController();
    fetchCampaignEmails(getAccessToken, campaignId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Campaign emails could not be loaded.' }); });
    return () => controller.abort();
  }, [campaignId, getAccessToken]);

  async function run(action: () => Promise<CampaignEmailOverview>, success: string) {
    if (!getAccessToken || busy) return;
    setBusy(true); setMessage(null);
    try {
      setData(await action());
      setMessage({ tone: 'success', text: success });
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Campaign emails could not be updated.' });
    } finally {
      setBusy(false);
    }
  }

  function addReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(days);
    if (!getAccessToken || !Number.isInteger(value) || value < 0 || value > 90) return;
    void run(() => addCampaignReminder(getAccessToken, campaignId, value), `Reminder added: ${dayLabel(value).toLowerCase()}.`);
  }

  async function sendNow() {
    if (!getAccessToken || busy) return;
    setBusy(true); setMessage(null); setConfirmSend(false);
    try {
      const result = await sendReminderNow(getAccessToken, campaignId);
      const parts = [`${result.sent} sent`];
      if (result.skipped_recently_reminded) parts.push(`${result.skipped_recently_reminded} skipped (reminded in the last 24 hours)`);
      if (result.failed) parts.push(`${result.failed} failed`);
      setMessage({ tone: result.failed ? 'error' : 'success', text: `Reminder emails: ${parts.join(', ')}.` });
      setData(await fetchCampaignEmails(getAccessToken, campaignId));
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Reminder emails could not be sent.' });
    } finally {
      setBusy(false);
    }
  }

  return <section className="card card-padded completion-emails" aria-labelledby="completionEmailsTitle">
    <div className="completion-emails-head">
      <div>
        <h2 id="completionEmailsTitle">Email reminders</h2>
        <p>Everyone with evaluations gets an email when the campaign opens. Add more reminders before the end date.</p>
      </div>
      {canManage && data && <div className="completion-emails-send">
        {confirmSend ? <>
          <span>Email {data.open_recipients} {data.open_recipients === 1 ? 'person' : 'people'} with open evaluations?</span>
          <button className="btn btn-secondary" type="button" onClick={() => setConfirmSend(false)} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={() => void sendNow()} disabled={busy}>Send</button>
        </> : <button className="btn btn-primary" type="button" disabled={busy || !isActive || !data.email_configured || data.open_recipients === 0}
          title={!isActive ? 'Reminders can be sent while the campaign is active.' : data.open_recipients === 0 ? 'Nobody has open evaluations.' : undefined}
          onClick={() => setConfirmSend(true)}>Send reminder now</button>}
      </div>}
    </div>

    {message && <p className={`completion-emails-message ${message.tone}`} role={message.tone === 'success' ? 'status' : 'alert'}>{message.text}</p>}
    {data && !data.email_configured && <p className="completion-emails-message error" role="status">Email sending is not configured on the server, so no emails go out yet.</p>}
    {!data && !message && <p className="completion-emails-muted">Loading email schedule…</p>}

    {data && <ul className="completion-emails-list">
      <li>
        <div><strong>When the campaign opens</strong><span>{data.launch_sent_count > 0 ? `Sent to ${data.launch_sent_count}` : data.launch_email_enabled ? 'Scheduled' : 'Off'}</span></div>
        {canManage && <label className="completion-check"><input type="checkbox" checked={data.launch_email_enabled} disabled={busy}
          onChange={(event) => { const enabled = event.target.checked; if (getAccessToken) void run(() => setLaunchEmail(getAccessToken, campaignId, enabled), enabled ? 'Launch email turned on.' : 'Launch email turned off.'); }} /> Send</label>}
      </li>
      {data.reminders.map((reminder) => <li key={reminder.id}>
        <div>
          <strong>{dayLabel(reminder.days_before_end)}</strong>
          <span>{reminder.scheduled_for ? formatShortDate(reminder.scheduled_for) : 'No end date'} · {reminder.sent_count > 0 ? `Sent to ${reminder.sent_count}` : 'Scheduled'}</span>
        </div>
        {canManage && <button className="btn btn-secondary" type="button" disabled={busy}
          onClick={() => { if (getAccessToken) void run(() => deleteCampaignReminder(getAccessToken, campaignId, reminder.id), 'Reminder removed.'); }}>Remove</button>}
      </li>)}
    </ul>}

    {data && canManage && <form className="completion-emails-add" onSubmit={addReminder}>
      <label htmlFor="reminderDays">Add reminder</label>
      <input id="reminderDays" className="form-control" type="number" min={0} max={90} step={1} value={days} onChange={(event) => setDays(event.target.value)} />
      <span>days before the end</span>
      <button className="btn btn-secondary" type="submit" disabled={busy || !hasEndDate || days === ''}
        title={hasEndDate ? undefined : 'Set a campaign end date first.'}>Add</button>
    </form>}
    {data && data.failed_count > 0 && <p className="completion-emails-muted">{data.failed_count} {data.failed_count === 1 ? 'email' : 'emails'} could not be delivered.</p>}
    {data?.manual_last_sent_at && <p className="completion-emails-muted">Last manual reminder: {formatShortDate(data.manual_last_sent_at)}</p>}
  </section>;
}
