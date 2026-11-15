import { Fragment, useEffect, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { fetchPermissionMatrix, savePermissionMatrix, type PermissionMatrix } from '../workspace.api';
import SaveBar from './SaveBar';

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
  const { state, getAccessToken } = useAppAuth();
  const ownRoleId = state.status === 'authenticated' ? state.user.system_role_id : null;
  const canEdit = state.status === 'authenticated' && state.user.permissions.includes('permissions.manage');
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [draft, setDraft] = useState<Grants>({});
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  if (loadError) return <div className="card card-padded settings-error" role="alert">{loadError}
    <button className="btn btn-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>;
  if (!matrix) return <div className="card card-padded settings-state" role="status">Loading permissions...</div>;

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
    setMessage(''); setError('');
  }

  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await savePermissionMatrix(getAccessToken,
        changedRoles.map((role) => ({ role_id: role.id, permissions: draft[role.id] ?? [] })));
      setMatrix(result); setDraft(grantsOf(result));
      setMessage('Permissions saved. Affected users see the change after they reload the app.');
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
      <div className="settings-table-wrap"><table className="settings-table settings-permission-table">
        <thead><tr><th scope="col">Permission</th>{matrix.roles.map((role) => <th scope="col" key={role.id}>
          {role.name}<small>{role.active_users} {role.active_users === 1 ? 'user' : 'users'}{role.id === ownRoleId ? ' · your role' : ''}</small>
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
      {error && <p className="settings-error" role="alert">{error}</p>}
      {message && <p className="settings-success" role="status">{message}</p>}
    </section>
    <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(saved); setError(''); }} onSave={() => void save()} />
  </div>;
}
