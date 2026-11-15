import { formatUserName } from '../layout/sidebar-user';

import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type SignInStatus = 'Signed in' | 'Invited' | 'Invitation failed' | 'Not invited';

export type Employee = {
  id: number;
  userId: number | null;
  name: string;
  role: string;
  groups: string[];
  groupIds: number[];
  status: 'Active' | 'Inactive';
  email: string;
  signIn: SignInStatus;
  signInLinked: boolean;
  invitationSentAt: string | null;
  invitationError: string | null;
  photo: string | null;
  systemRoleId: number | null;
  systemRole: string | null;
};

export type NamedOption = { id: number; name: string; description?: string | null };

export type Group = {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  leaderIds: number[];
};

export type GroupFormValues = {
  name: string;
  description: string;
  leaderIds: number[];
};

export type EmployeeFormValues = {
  name: string;
  role: string;
  email: string;
  groupIds: number[];
};

export type EmployeeImportResult = {
  createdCount: number;
  errors: string[];
  invitationsSent: number;
  invitationErrors: string[];
};

export type GroupImportResult = {
  createdCount: number;
  errors: string[];
};

type PeopleGroupResponse = {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
  leader_ids?: number[];
};

type PeopleEmployeeResponse = {
  id: number;
  user_id?: number | null;
  username: string;
  full_name: string | null;
  email: string;
  role_name: string;
  groups: PeopleGroupResponse[];
  is_active: boolean;
  sign_in_status?: 'active' | 'invited' | 'failed' | 'not_invited';
  sign_in_linked?: boolean;
  invitation_sent_at?: string | null;
  invitation_error?: string | null;
  profile_image_url?: string | null;
  system_role_id?: number | null;
  system_role_name?: string | null;
};

type PeopleResponse = {
  employees: PeopleEmployeeResponse[];
  groups: PeopleGroupResponse[];
  company_roles?: NamedOption[];
  system_roles?: NamedOption[];
};

function mapGroup(group: PeopleGroupResponse): Group {
  return {
    id: group.id,
    name: group.name,
    description: group.description || 'No description provided.',
    memberCount: group.member_count,
    leaderIds: group.leader_ids ?? [],
  };
}

function mapEmployee(employee: PeopleEmployeeResponse): Employee {
  return {
    id: employee.id,
    userId: employee.user_id ?? null,
    name: employee.full_name || formatUserName(employee.username),
    role: employee.role_name,
    groups: employee.groups.map((group) => group.name),
    groupIds: employee.groups.map((group) => group.id),
    status: employee.is_active ? 'Active' : 'Inactive',
    email: employee.email,
    signIn: SIGN_IN_LABELS[employee.sign_in_status ?? 'not_invited'],
    signInLinked: employee.sign_in_linked ?? false,
    invitationSentAt: employee.invitation_sent_at ?? null,
    invitationError: employee.invitation_error ?? null,
    photo: employee.profile_image_url ?? null,
    systemRoleId: employee.system_role_id ?? null,
    systemRole: employee.system_role_name ?? null,
  };
}

const SIGN_IN_LABELS: Record<NonNullable<PeopleEmployeeResponse['sign_in_status']>, SignInStatus> = {
  active: 'Signed in', invited: 'Invited', failed: 'Invitation failed', not_invited: 'Not invited',
};

const INVITATION_ERRORS: Record<string, string> = {
  account_exists: 'An Auth0 account already exists with this email address.',
  provider_unavailable: 'Auth0 was unavailable. Resend the invitation later.',
  email_failed: 'The sign-in account was created, but the email could not be sent. Resend the invitation.',
  signup_rejected: 'Auth0 rejected the sign-up. Check that sign-ups are enabled on the database connection.',
  invalid_provider_response: 'Auth0 returned an unexpected response.',
  external_identity: 'This account signs in with an external provider.',
  not_configured: 'Sign-in invitations are not configured on the server.',
};

export function invitationErrorMessage(code: string | null) {
  return code ? INVITATION_ERRORS[code] ?? 'The invitation could not be sent.' : 'The invitation could not be sent.';
}

export async function resendInvitation(getAccessToken: AccessTokenGetter, employeeId: number): Promise<Employee> {
  const response = await authenticatedApiFetch(getAccessToken, `/people/employees/${employeeId}/invitation`, {
    method: 'POST',
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'The invitation could not be sent.');
  }
  return mapEmployee((await response.json()) as PeopleEmployeeResponse);
}

export async function fetchPeople(getAccessToken: AccessTokenGetter, signal: AbortSignal) {
  const response = await authenticatedApiFetch(getAccessToken, '/people', { signal });
  if (!response.ok) throw new Error('People data could not be loaded.');
  const people = (await response.json()) as PeopleResponse;
  return {
    employees: people.employees.map(mapEmployee),
    groups: people.groups.map(mapGroup),
    companyRoles: people.company_roles ?? [],
    systemRoles: people.system_roles ?? [],
  };
}

export type CompanyRoleUsage = {
  id: number;
  name: string;
  employee_count: number;
  used_in_campaigns: boolean;
  archived: boolean;
};

async function companyRolesResponse(response: Response, fallback: string): Promise<CompanyRoleUsage[]> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return (await response.json()) as CompanyRoleUsage[];
}

export async function fetchCompanyRoles(getAccessToken: AccessTokenGetter) {
  return companyRolesResponse(await authenticatedApiFetch(getAccessToken, '/people/company-roles'),
    'Company roles could not be loaded.');
}

/** Deletes an unused role; a role that campaigns refer to is archived instead. */
export async function deleteCompanyRole(getAccessToken: AccessTokenGetter, roleId: number) {
  return companyRolesResponse(await authenticatedApiFetch(getAccessToken, `/people/company-roles/${roleId}`, {
    method: 'DELETE',
  }), 'The company role could not be removed.');
}

export async function updateEmployeeSystemRole(getAccessToken: AccessTokenGetter, employeeId: number,
  systemRoleId: number): Promise<NamedOption> {
  const response = await authenticatedApiFetch(getAccessToken, `/people/employees/${employeeId}/system-role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_role_id: systemRoleId }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'The system role could not be changed.');
  }
  return (await response.json()) as NamedOption;
}

export async function createEmployee(getAccessToken: AccessTokenGetter, form: EmployeeFormValues): Promise<Employee> {
  const response = await authenticatedApiFetch(getAccessToken, '/people/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      role: form.role,
      email: form.email,
      group_ids: form.groupIds,
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(
      typeof detail === 'string' ? detail : 'Employee could not be saved.',
    );
  }
  return mapEmployee((await response.json()) as PeopleEmployeeResponse);
}

export async function updateEmployee(
  getAccessToken: AccessTokenGetter,
  id: number,
  form: EmployeeFormValues,
): Promise<Employee> {
  const response = await authenticatedApiFetch(getAccessToken, `/people/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      role: form.role,
      email: form.email,
      group_ids: form.groupIds,
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(
      typeof detail === 'string' ? detail : 'Employee could not be updated.',
    );
  }
  return mapEmployee((await response.json()) as PeopleEmployeeResponse);
}

export async function importEmployees(getAccessToken: AccessTokenGetter, file: File): Promise<EmployeeImportResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await authenticatedApiFetch(getAccessToken, '/people/employees/import', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json().catch(() => null)) as
    | { created_count?: number; errors?: string[]; detail?: string;
      invitations_sent?: number; invitation_errors?: string[] }
    | null;
  if (!response.ok) {
    throw new Error(body?.detail || 'Employees could not be imported.');
  }
  return {
    createdCount: body?.created_count ?? 0,
    errors: body?.errors ?? [],
    invitationsSent: body?.invitations_sent ?? 0,
    invitationErrors: body?.invitation_errors ?? [],
  };
}

export async function createGroup(getAccessToken: AccessTokenGetter, form: GroupFormValues): Promise<Group> {
  const response = await authenticatedApiFetch(getAccessToken, '/people/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null,
      leader_ids: form.leaderIds,
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Group could not be saved.');
  }
  return mapGroup((await response.json()) as PeopleGroupResponse);
}

export async function updateGroup(
  getAccessToken: AccessTokenGetter,
  id: number,
  form: GroupFormValues,
): Promise<Group> {
  const response = await authenticatedApiFetch(getAccessToken, `/people/groups/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null,
      leader_ids: form.leaderIds,
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Group could not be updated.');
  }
  return mapGroup((await response.json()) as PeopleGroupResponse);
}

export async function addGroupMember(
  getAccessToken: AccessTokenGetter,
  groupId: number,
  employeeId: number,
): Promise<Group> {
  const response = await authenticatedApiFetch(getAccessToken, `/people/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: employeeId }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Employee could not be added to the group.');
  }
  return mapGroup((await response.json()) as PeopleGroupResponse);
}

export async function removeGroupMember(
  getAccessToken: AccessTokenGetter,
  groupId: number,
  employeeId: number,
): Promise<Group> {
  const response = await authenticatedApiFetch(
    getAccessToken,
    `/people/groups/${groupId}/members/${employeeId}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(
      typeof detail === 'string'
        ? detail
        : 'Employee could not be removed from the group.',
    );
  }
  return mapGroup((await response.json()) as PeopleGroupResponse);
}

export async function importGroups(getAccessToken: AccessTokenGetter, file: File): Promise<GroupImportResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await authenticatedApiFetch(getAccessToken, '/people/groups/import', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json().catch(() => null)) as
    | { created_count?: number; errors?: string[]; detail?: string }
    | null;
  if (!response.ok) {
    throw new Error(body?.detail || 'Groups could not be imported.');
  }
  return {
    createdCount: body?.created_count ?? 0,
    errors: body?.errors ?? [],
  };
}
