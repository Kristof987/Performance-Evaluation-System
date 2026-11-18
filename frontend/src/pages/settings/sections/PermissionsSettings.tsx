import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { createSystemRole, deleteSystemRole, fetchPermissionMatrix, savePermissionMatrix, type PermissionMatrix } from '../workspace.api';
import SaveBar from './SaveBar';
import InlineMessage from '../../../components/feedback/InlineMessage';
import LoadError from '../../../components/feedback/LoadError';
import { useConfirm, useToast } from '../../../components/feedback/feedback-context';
import LoadingState from '../../../components/feedback/LoadingState';

// Removing these from your own role would lock you out of this page.
const SELF_PROTECTED = new Set(['permissions.manage', 'settings.read']);

const AREAS: Record<string, string> = {
  employees: 'People', groups: 'People', roles: 'People', campaigns: 'Campaigns', forms: 'Questionnaires',
  sections: 'Questionnaires', evaluations: 'Evaluations', reports: 'Reports', ai_analysis: 'Reports',
  settings: 'Settings', workspace: 'Administration', permissions: 'Administration', audit: 'Administration',
};

type Grants = Record<number, string[]>;

const grantsOf = (matrix: PermissionMatrix): Grants =>
  Object.fromEntries(matrix.roles.map((role) => [role.id, [...role.permissions].sort()]));

export default function PermissionsSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const { state, getAccessToken } = useAppAuth();
  const ownRoleId = state.status === 'authenticated' ? state.user.system_role_id : null;
  const canEdit = state.status === 'authenticated' && state.user.permissions.includes('permissions.manage');
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [draft, setDraft] = useState<Grants>({});
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [newRoleName, setNewRoleName] = useState('');
  const [copyFromRoleId, setCopyFromRoleId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchPermissionMatrix(getAccessToken, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setMatrix(result); setDraft(grantsOf(result)); setLoadError('');
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Permissions could not load.');
      });
    return () => controller.abort();
  }, [getAccessToken, attempt]);

  if (loadError) return <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!matrix) return <LoadingState variant="page" label="Loading permissions" />;

  const saved = grantsOf(matrix);
  const changedRoles = matrix.roles.filter((role) => draft[role.id]?.join() !== saved[role.id]?.join());
  const dirty = changedRoles.length > 0;
  const areas = [...new Set(matrix.permissions.map((permission) => AREAS[permission.name.split('.')[0]] ?? 'Other'))];

  function toggle(roleId: number, permission: string) {
    setDraft((current) => {
      const granted = new Set(current[roleId] ?? []);
      if (granted.has(permission)) granted.delete(permission); else granted.add(permission);
      return { ...current, [roleId]: [...granted].sort() };
    });
    setError('');
  }

  async function changeRoles(action: () => Promise<PermissionMatrix>, success: string) {
    setSaving(true); setError('');
    try {
      const result = await action();
      setMatrix(result); setDraft(grantsOf(result));
      toast.success(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The role could not be changed.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newRoleName.trim();
    if (!name) return;
    const created = await changeRoles(() => createSystemRole(getAccessToken, {
      name, copy_from_role_id: copyFromRoleId ? Number(copyFromRoleId) : null,
    }), `Role “${name}” created. Assign it to people on the People page`);
    if (created) { setNewRoleName(''); setCopyFromRoleId(''); }
  }

  async function save() {
    const names = changedRoles.map((role) => role.name).join(', ');
    const users = changedRoles.reduce((sum, role) => sum + role.active_users, 0);
    if (!(await confirm({
      title: `Change permissions for ${names}?`,
      message: `This changes what ${users} ${users === 1 ? 'user' : 'users'} can see and do. They get the new permissions the next time they load the app.`,
      confirmLabel: 'Save permissions',
    }))) return;
    setSaving(true); setError('');
    try {
      const result = await savePermissionMatrix(getAccessToken,
        changedRoles.map((role) => ({ role_id: role.id, permissions: draft[role.id] ?? [] })));
      setMatrix(result); setDraft(grantsOf(result));
      toast.success('Permissions saved. Affected users see the change after they reload the app');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Permissions could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="settings-preference-form">
    <section className="card settings-panel" aria-labelledby="permissions-title">
      <div className="settings-panel-header"><h2 id="permissions-title">Permissions</h2>
        <p>Choose what each system role is allowed to do. Every change is recorded in the audit log.</p></div>
      {!canEdit && <p className="settings-note">You can view this matrix, but only roles with permission management can change it.</p>}
      {canEdit && <form className="settings-role-create" onSubmit={(event) => void addRole(event)}>
        <label><span>New role</span>
          <input className="form-control" value={newRoleName} maxLength={60} placeholder="e.g. Team lead"
            onChange={(event) => setNewRoleName(event.target.value)} /></label>
        <label><span>Start from</span>
          <select className="form-control" value={copyFromRoleId} onChange={(event) => setCopyFromRoleId(event.target.value)}>
            <option value="">No permissions</option>
            {matrix.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select></label>
        <button className="btn btn-secondary" type="submit" disabled={saving || dirty || !newRoleName.trim()}
          title={dirty ? 'Save or discard your changes first.' : undefined}>Add role</button>
      </form>}
      <div className="settings-table-wrap"><table className="settings-table settings-permission-table">
        <thead><tr><th scope="col">Permission</th>{matrix.roles.map((role) => <th scope="col" key={role.id}>
          {role.name}<small>{role.active_users} {role.active_users === 1 ? 'user' : 'users'}{role.id === ownRoleId ? ' · your role' : ''}</small>
          {canEdit && !role.built_in && <button className="settings-role-delete" type="button"
            disabled={saving || dirty} title={dirty ? 'Save or discard your changes first.' : undefined}
            onClick={async () => {
              if (!(await confirm({ title: `Delete the “${role.name}” role?`, message: 'The role and its permission settings are removed permanently. Only roles nobody is assigned to can be deleted.', confirmLabel: 'Delete role', tone: 'danger' }))) return;
              void changeRoles(() => deleteSystemRole(getAccessToken, role.id), `Role “${role.name}” deleted`);
            }}>Delete</button>}
        </th>)}</tr></thead>
        <tbody>{areas.map((area) => <Fragment key={area}>
          <tr className="settings-table-group"><th scope="rowgroup" colSpan={matrix.roles.length + 1}>{area}</th></tr>
          {matrix.permissions.filter((permission) => (AREAS[permission.name.split('.')[0]] ?? 'Other') === area).map((permission) =>
            <tr key={permission.name}><th scope="row"><span>{permission.description}</span><code>{permission.name}</code></th>
              {matrix.roles.map((role) => {
                const locked = role.id === ownRoleId && SELF_PROTECTED.has(permission.name);
                const checked = draft[role.id]?.includes(permission.name) ?? false;
                return <td key={role.id}><input type="checkbox" checked={checked}
                  disabled={!canEdit || saving || (locked && checked)}
                  title={locked && checked ? 'You cannot remove this from your own role.' : undefined}
                  aria-label={`${role.name}: ${permission.description}`}
                  onChange={() => toggle(role.id, permission.name)} /></td>;
              })}
            </tr>)}
        </Fragment>)}</tbody>
      </table></div>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
          </section>
    <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(saved); setError(''); }} onSave={() => void save()} />
  </div>;
}
