import { formatUserName } from '../layout/sidebar-user';

const API_BASE_URL = 'http://localhost:8000';

export type Employee = {
  id: number;
  name: string;
  role: string;
  groups: string[];
  groupIds: number[];
  status: 'Active' | 'Invited';
  email: string;
};

export type Group = {
  id: number;
  name: string;
  description: string;
  memberCount: number;
};

export type GroupFormValues = {
  name: string;
  description: string;
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
};

type PeopleEmployeeResponse = {
  id: number;
  username: string;
  email: string;
  role_name: string;
  groups: PeopleGroupResponse[];
  is_active: boolean;
};

type PeopleResponse = {
  employees: PeopleEmployeeResponse[];
  groups: PeopleGroupResponse[];
};

function mapGroup(group: PeopleGroupResponse): Group {
  return {
    id: group.id,
    name: group.name,
    description: group.description || 'No description provided.',
    memberCount: group.member_count,
  };
}

function mapEmployee(employee: PeopleEmployeeResponse): Employee {
  return {
    id: employee.id,
    name: formatUserName(employee.username),
    role: employee.role_name,
    groups: employee.groups.map((group) => group.name),
    groupIds: employee.groups.map((group) => group.id),
    status: employee.is_active ? 'Active' : 'Invited',
    email: employee.email,
  };
}

export async function fetchPeople(signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/people`, { signal });
  if (!response.ok) throw new Error('People data could not be loaded.');
  const people = (await response.json()) as PeopleResponse;
  return {
    employees: people.employees.map(mapEmployee),
    groups: people.groups.map(mapGroup),
  };
}

export async function createEmployee(form: EmployeeFormValues): Promise<Employee> {
  const response = await fetch(`${API_BASE_URL}/people/employees`, {
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
  id: number,
  form: EmployeeFormValues,
): Promise<Employee> {
  const response = await fetch(`${API_BASE_URL}/people/employees/${id}`, {
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

export async function importEmployees(file: File): Promise<EmployeeImportResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE_URL}/people/employees/import`, {
    method: 'POST',
    body: form,
  });
  const body = (await response.json().catch(() => null)) as
    | { created_count?: number; errors?: string[]; detail?: string }
    | null;
  if (!response.ok) {
    throw new Error(body?.detail || 'Employees could not be imported.');
  }
  return {
    createdCount: body?.created_count ?? 0,
    errors: body?.errors ?? [],
  };
}

export async function createGroup(form: GroupFormValues): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/people/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null,
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
  id: number,
  form: GroupFormValues,
): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/people/groups/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name,
      description: form.description || null,
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
  groupId: number,
  employeeId: number,
): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/people/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: employeeId }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Employee could not be added to the group.');
  }
  return mapGroup((await response.json()) as PeopleGroupResponse);
}

export async function importGroups(file: File): Promise<GroupImportResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE_URL}/people/groups/import`, {
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
