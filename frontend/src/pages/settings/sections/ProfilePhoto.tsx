import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import Avatar from '../../../components/Avatar';
import InlineMessage from '../../../components/feedback/InlineMessage';
import { useConfirm, useToast } from '../../../components/feedback/feedback-context';
import { setProfilePhotoOverride } from '../profile-photo-store';
import {
  deleteProfilePhoto, PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, uploadProfilePhoto,
} from '../settings.api';

export default function ProfilePhoto({ name, employeeId, initialPhoto }: {
  name: string; employeeId: number | null; initialPhoto: string | null;
}) {
  const { state, getAccessToken } = useAppAuth();
  const canEdit = employeeId !== null && state.status === 'authenticated'
    && state.user.permissions.includes('settings.manage_self');
  const [photo, setPhoto] = useState(initialPhoto);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(selected: File | null) {
    setError('');
    if (input.current) input.current.value = '';
    if (!selected) return;
    if (!PROFILE_PHOTO_TYPES.includes(selected.type)) { setError('Choose a JPG, PNG or WebP image.'); return; }
    if (selected.size > PROFILE_PHOTO_MAX_BYTES) { setError('The image must be 5 MB or smaller.'); return; }
    setFile(selected);
  }

  async function run(action: 'upload' | 'remove') {
    if (busy || employeeId === null) return;
    if (action === 'remove' && !(await confirm({ title: 'Remove your profile photo?', message: 'Your initials will be shown instead. You can upload a new photo any time.', confirmLabel: 'Remove photo', tone: 'danger' }))) return;
    setBusy(action); setError('');
    try {
      const result = action === 'upload' && file
        ? await uploadProfilePhoto(getAccessToken, file) : await deleteProfilePhoto(getAccessToken);
      setPhoto(result.profile_image_url);
      setProfilePhotoOverride(employeeId, result.profile_image_url);
      setFile(null);
      toast.success(action === 'upload' ? 'Profile photo updated' : 'Profile photo removed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  return <div className="settings-photo">
    {preview ? <div className="settings-photo-avatar"><img src={preview} alt="" /></div>
      : <Avatar className="settings-photo-avatar" name={name} photo={photo} />}
    <div className="settings-photo-body">
      <strong>Profile photo</strong>
      <span>{file ? 'Preview — save to use this photo.' : 'Shown next to your name across PerfEval. JPG, PNG or WebP, up to 5 MB.'}</span>
      {canEdit && <div className="settings-photo-actions">
        <input ref={input} id="profile-photo-input" type="file" accept={PROFILE_PHOTO_TYPES.join(',')} hidden
          onChange={(event) => choose(event.target.files?.[0] ?? null)} />
        {file ? <>
          <button className="btn btn-primary" type="button" disabled={busy !== null} onClick={() => void run('upload')}>
            {busy === 'upload' ? 'Saving...' : 'Save photo'}</button>
          <button className="btn btn-secondary" type="button" disabled={busy !== null} onClick={() => setFile(null)}>Cancel</button>
        </> : <>
          <button className="btn btn-secondary" type="button" disabled={busy !== null} onClick={() => input.current?.click()}>
            {photo ? 'Change photo' : 'Upload photo'}</button>
          {photo && <button className="btn btn-ghost" type="button" disabled={busy !== null} onClick={() => void run('remove')}>
            {busy === 'remove' ? 'Removing...' : 'Remove'}</button>}
        </>}
      </div>}
      {error && <InlineMessage tone="error" onDismiss={() => setError('')}>{error}</InlineMessage>}
    </div>
  </div>;
}
