import { getUserInitials } from '../layout/sidebar-user';
import AppLayout from '../layout/AppLayout';
import { useEffect, useState, type FormEvent } from 'react';
import {
  addGroupMember,
  createEmployee,
  createGroup,
  fetchPeople,
  importEmployees,
  importGroups,
  updateEmployee,
  updateGroup,
  type Employee,
  type EmployeeFormValues,
  type Group,
  type GroupFormValues,
} from './people.api';
import './people.css';
import '../hr-home/hr-home.css';

type SortKey = 'name' | 'role' | 'groups' | 'status';
type Page<T> = {
  items: T[];
  page: number;
  pages: number;
  from: number;
  to: number;
};

const emptyEmployeeForm: EmployeeFormValues = {
  name: '',
  role: '',
  email: '',
  groupIds: [],
};
const emptyGroupForm: GroupFormValues = {
  name: '',
  description: '',
};
const employeeTemplateUrl = new URL(
  '../../resources/upload_employee_empty_template.xlsx',
  import.meta.url,
).href;
const groupTemplateUrl = new URL(
  '../../resources/upload_group_empty_template.xlsx',
  import.meta.url,
).href;

function paginate<T>(items: T[], requestedPage: number, size: number): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(requestedPage, 1), pages);
  const start = (page - 1) * size;
  const visible = items.slice(start, start + size);
  return {
    items: visible,
    page,
    pages,
    from: items.length ? start + 1 : 0,
    to: start + visible.length,
  };
}

function Pagination({
  pagination,
  total,
  noun,
  onPageChange,
}: {
  pagination: Pick<Page<unknown>, 'page' | 'pages' | 'from' | 'to'>;
  total: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="table-footer">
      <span>
        Showing {pagination.from}–{pagination.to} of {total} {noun}
      </span>
      <div className="pager">
        <button
          type="button"
          disabled={pagination.page === 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          ← Previous
        </button>
        <span>
          Page {pagination.page} / {pagination.pages}
        </span>
        <button
          type="button"
          disabled={pagination.page === pagination.pages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default function People() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isPeopleLoading, setIsPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState('');
  const [activePeopleTab, setActivePeopleTab] = useState<'employees' | 'groups'>(
    'employees',
  );
  const [employeeForm, setEmployeeForm] =
    useState<EmployeeFormValues>(emptyEmployeeForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [employeeFormMessage, setEmployeeFormMessage] = useState('');
  const [isSavingEmployee, setIsSavingEmployee] = useState(false);
  const [employeeImportFile, setEmployeeImportFile] = useState<File | null>(null);
  const [employeeImportMessage, setEmployeeImportMessage] = useState('');
  const [employeeImportErrors, setEmployeeImportErrors] = useState<string[]>([]);
  const [isImportingEmployees, setIsImportingEmployees] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isGroupsModalOpen, setIsGroupsModalOpen] = useState(false);
  const [employeeTab, setEmployeeTab] = useState<'manualPanel' | 'excelPanel'>(
    'manualPanel',
  );
  const [groupTab, setGroupTab] = useState<
    'groupManualPanel' | 'groupExcelPanel'
  >('groupManualPanel');
  const [groupForm, setGroupForm] = useState<GroupFormValues>(emptyGroupForm);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupFormMessage, setGroupFormMessage] = useState('');
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [groupModalEmployeeId, setGroupModalEmployeeId] = useState('');
  const [sidePanelEmployeeId, setSidePanelEmployeeId] = useState('');
  const [groupMemberMessage, setGroupMemberMessage] = useState('');
  const [isAddingGroupMember, setIsAddingGroupMember] = useState(false);
  const [groupImportFile, setGroupImportFile] = useState<File | null>(null);
  const [groupImportMessage, setGroupImportMessage] = useState('');
  const [groupImportErrors, setGroupImportErrors] = useState<string[]>([]);
  const [isImportingGroups, setIsImportingGroups] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>(
    { key: 'name', direction: 'asc' },
  );
  const [employeePage, setEmployeePage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('All groups');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const selectedEmployee =
    employees.find((employee) => employee.id === selectedEmployeeId) ??
    employees[0] ??
    null;

  function applyPeopleData(people: { employees: Employee[]; groups: Group[] }) {
    setEmployees(people.employees);
    setGroups(people.groups);
    if (people.employees.length > 0) {
      setSelectedEmployeeId((current) => current ?? people.employees[0].id);
    }
    if (people.groups.length > 0) {
      setSelectedGroupId((current) => current ?? people.groups[0].id);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchPeople(controller.signal)
      .then((people) => {
        if (controller.signal.aborted) return;
        applyPeopleData(people);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setPeopleError('People data could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsPeopleLoading(false);
      });
    return () => controller.abort();
  }, []);

  const filteredEmployees = employees.filter((employee) => {
    const search = employeeSearch.trim().toLowerCase();
    const matchesSearch = `${employee.name} ${employee.email} ${employee.role}`
      .toLowerCase()
      .includes(search);
    const matchesGroup =
      groupFilter === 'All groups' || employee.groups.includes(groupFilter);
    const matchesStatus =
      statusFilter === 'All statuses' || employee.status === statusFilter;
    return matchesSearch && matchesGroup && matchesStatus;
  });

  const sortedEmployees = [...filteredEmployees].sort((a, b) => {
    const first = sort.key === 'groups' ? a.groups.join(', ') : a[sort.key];
    const second = sort.key === 'groups' ? b.groups.join(', ') : b[sort.key];
    return (
      first.localeCompare(second, 'hu') * (sort.direction === 'asc' ? 1 : -1)
    );
  });
  const employeePagination = paginate(sortedEmployees, employeePage, 7);
  const filteredGroups = groups.filter((group) =>
    `${group.name}${group.description}`
      .toLowerCase()
      .includes(groupSearch.toLowerCase()),
  );
  const groupPagination = paginate(filteredGroups, groupPage, 5);
  const members = selectedGroup
    ? employees.filter((employee) =>
        employee.groups.includes(selectedGroup.name),
      )
    : [];
  const selectedGroupAvailableEmployees = selectedGroup
    ? employees.filter((employee) => !employee.groupIds.includes(selectedGroup.id))
    : [];
  const editingGroupAvailableEmployees = editingGroupId
    ? employees.filter((employee) => !employee.groupIds.includes(editingGroupId))
    : [];
  const activeEmployees = employees.filter(
    (employee) => employee.status === 'Active',
  ).length;
  const missingGroupEmployees = employees.filter(
    (employee) => employee.groups.length === 0,
  ).length;
  const multiGroupEmployees = employees.filter(
    (employee) => employee.groups.length > 1,
  ).length;
  const totalGroupMemberships = groups.reduce(
    (sum, group) => sum + group.memberCount,
    0,
  );
  const emptyGroups = groups.filter((group) => group.memberCount === 0).length;
  const largestGroup = groups.reduce<Group | null>(
    (largest, group) =>
      largest === null || group.memberCount > largest.memberCount
        ? group
        : largest,
    null,
  );
  const largestGroups = largestGroup
    ? groups.filter((group) => group.memberCount === largestGroup.memberCount)
    : [];
  const averageMembersPerGroup =
    groups.length > 0 ? Math.round(totalGroupMemberships / groups.length) : 0;

  function handleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setEmployeePage(1);
  }

  function selectGroup(group: Group) {
    setSelectedGroupId(group.id);
  }

  function openAddGroupModal() {
    setEditingGroupId(null);
    setGroupForm(emptyGroupForm);
    setGroupFormMessage('');
    setGroupModalEmployeeId('');
    setGroupMemberMessage('');
    setGroupTab('groupManualPanel');
    setIsGroupsModalOpen(true);
  }

  function openEditGroupModal(group: Group) {
    setEditingGroupId(group.id);
    setSelectedGroupId(group.id);
    setGroupForm({ name: group.name, description: group.description });
    setGroupFormMessage('');
    setGroupModalEmployeeId('');
    setGroupMemberMessage('');
    setGroupTab('groupManualPanel');
    setIsGroupsModalOpen(true);
  }

  function closeGroupModal() {
    if (isSavingGroup || isImportingGroups) return;
    setIsGroupsModalOpen(false);
    setEditingGroupId(null);
    setGroupForm(emptyGroupForm);
    setGroupFormMessage('');
    setGroupModalEmployeeId('');
    setGroupMemberMessage('');
    setGroupImportFile(null);
    setGroupImportMessage('');
    setGroupImportErrors([]);
  }

  function updateGroupForm<K extends keyof GroupFormValues>(
    key: K,
    value: GroupFormValues[K],
  ) {
    setGroupForm((current) => ({ ...current, [key]: value }));
    setGroupFormMessage('');
  }

  async function handleSaveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingGroup) return;
    if (groupForm.name.trim() === '') {
      setGroupFormMessage('Group name is required.');
      return;
    }

    setIsSavingGroup(true);
    setGroupFormMessage('');
    try {
      const payload = {
        name: groupForm.name.trim(),
        description: groupForm.description.trim(),
      };
      if (editingGroupId === null) {
        await createGroup(payload);
      } else {
        await updateGroup(editingGroupId, payload);
      }
      const people = await fetchPeople(new AbortController().signal);
      applyPeopleData(people);
      setGroupPage(1);
      setIsGroupsModalOpen(false);
      setEditingGroupId(null);
      setGroupForm(emptyGroupForm);
    } catch (error) {
      setGroupFormMessage(
        error instanceof Error ? error.message : 'Group could not be saved.',
      );
    } finally {
      setIsSavingGroup(false);
    }
  }

  async function handleAddGroupMember(groupId: number, employeeId: string) {
    if (isAddingGroupMember) return;
    if (employeeId === '') {
      setGroupMemberMessage('Select an employee first.');
      return;
    }

    setIsAddingGroupMember(true);
    setGroupMemberMessage('');
    try {
      await addGroupMember(groupId, Number(employeeId));
      const people = await fetchPeople(new AbortController().signal);
      applyPeopleData(people);
      setGroupModalEmployeeId('');
      setSidePanelEmployeeId('');
    } catch (error) {
      setGroupMemberMessage(
        error instanceof Error ? error.message : 'Employee could not be added to the group.',
      );
    } finally {
      setIsAddingGroupMember(false);
    }
  }

  async function handleImportGroups() {
    if (isImportingGroups) return;
    if (groupImportFile === null) {
      setGroupImportMessage('Please choose an Excel file first.');
      setGroupImportErrors([]);
      return;
    }

    setIsImportingGroups(true);
    setGroupImportMessage('');
    setGroupImportErrors([]);
    try {
      const result = await importGroups(groupImportFile);
      if (result.errors.length > 0) {
        setGroupImportErrors(result.errors);
        setGroupImportMessage('Groups were not imported. Fix the errors below and upload again.');
        return;
      }
      const people = await fetchPeople(new AbortController().signal);
      applyPeopleData(people);
      setGroupImportFile(null);
      setGroupImportMessage(
        `${result.createdCount} group${result.createdCount === 1 ? '' : 's'} imported successfully.`,
      );
      setGroupPage(1);
    } catch (error) {
      setGroupImportMessage(
        error instanceof Error ? error.message : 'Groups could not be imported.',
      );
    } finally {
      setIsImportingGroups(false);
    }
  }

  function resetEmployeeFilters() {
    setEmployeeSearch('');
    setGroupFilter('All groups');
    setStatusFilter('All statuses');
    setEmployeePage(1);
  }

  function closeEmployeeModal() {
    if (isSavingEmployee || isImportingEmployees) return;
    setIsEmployeeModalOpen(false);
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeFormMessage('');
    setEmployeeImportFile(null);
    setEmployeeImportMessage('');
    setEmployeeImportErrors([]);
  }

  function openAddEmployeeModal() {
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeFormMessage('');
    setEmployeeTab('manualPanel');
    setIsEmployeeModalOpen(true);
  }

  function openEditEmployeeModal(employee: Employee) {
    setEditingEmployeeId(employee.id);
    setEmployeeForm({
      name: employee.name,
      role: employee.role,
      email: employee.email,
      groupIds: employee.groupIds,
    });
    setEmployeeFormMessage('');
    setEmployeeTab('manualPanel');
    setIsEmployeeModalOpen(true);
  }

  function updateEmployeeForm<K extends keyof EmployeeFormValues>(
    key: K,
    value: EmployeeFormValues[K],
  ) {
    setEmployeeForm((current) => ({ ...current, [key]: value }));
    setEmployeeFormMessage('');
  }

  function toggleEmployeeGroup(groupId: number) {
    setEmployeeForm((current) => ({
      ...current,
      groupIds: current.groupIds.includes(groupId)
        ? current.groupIds.filter((id) => id !== groupId)
        : [...current.groupIds, groupId],
    }));
    setEmployeeFormMessage('');
  }

  async function handleCreateEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingEmployee) return;
    if (
      employeeForm.name.trim() === '' ||
      employeeForm.role.trim() === '' ||
      employeeForm.email.trim() === ''
    ) {
      setEmployeeFormMessage('Name, role and email are required.');
      return;
    }

    setIsSavingEmployee(true);
    setEmployeeFormMessage('');
    try {
      const payload = {
        ...employeeForm,
        name: employeeForm.name.trim(),
        role: employeeForm.role.trim(),
        email: employeeForm.email.trim(),
      };
      if (editingEmployeeId === null) {
        await createEmployee(payload);
      } else {
        await updateEmployee(editingEmployeeId, payload);
      }
      const people = await fetchPeople(new AbortController().signal);
      applyPeopleData(people);
      setEmployeePage(1);
      setEditingEmployeeId(null);
      setEmployeeForm(emptyEmployeeForm);
      setIsEmployeeModalOpen(false);
    } catch (error) {
      setEmployeeFormMessage(
        error instanceof Error ? error.message : 'Employee could not be saved.',
      );
    } finally {
      setIsSavingEmployee(false);
    }
  }

  async function handleImportEmployees() {
    if (isImportingEmployees) return;
    if (employeeImportFile === null) {
      setEmployeeImportMessage('Please choose an Excel file first.');
      setEmployeeImportErrors([]);
      return;
    }

    setIsImportingEmployees(true);
    setEmployeeImportMessage('');
    setEmployeeImportErrors([]);
    try {
      const result = await importEmployees(employeeImportFile);
      if (result.errors.length > 0) {
        setEmployeeImportErrors(result.errors);
        setEmployeeImportMessage('Employees were not imported. Fix the errors below and upload again.');
        return;
      }
      const people = await fetchPeople(new AbortController().signal);
      applyPeopleData(people);
      setEmployeeImportFile(null);
      setEmployeeImportMessage(
        `${result.createdCount} employee${result.createdCount === 1 ? '' : 's'} imported successfully.`,
      );
      setEmployeePage(1);
    } catch (error) {
      setEmployeeImportMessage(
        error instanceof Error ? error.message : 'Employees could not be imported.',
      );
    } finally {
      setIsImportingEmployees(false);
    }
  }

  return (
    <div className="people-page">
      <AppLayout activePage="people" pageClassName="">
        <main className="main">
          <section className="hello">
            <h1>People</h1>
            <p>Manage employees, roles, emails and group memberships.</p>
          </section>

          <section className="page-head">
            <div className="title">
              <h2>
                {activePeopleTab === 'employees'
                  ? 'Employee directory'
                  : 'Groups'}
              </h2>
              <p>
                One employee can belong to multiple groups used in review
                campaigns.
              </p>
            </div>
            <div className="actions">
              {activePeopleTab === 'employees' ? (
                <button
                  className="btn btn-primary people-button"
                  id="addEmployeeBtn"
                  onClick={openAddEmployeeModal}
                >
                  Add employee
                </button>
              ) : (
                <button
                  className="btn btn-primary people-button"
                  id="manageGroupsBtn"
                  onClick={openAddGroupModal}
                >
                  Add group
                </button>
              )}
            </div>
          </section>

          <div className="tabs">
            <button
              className={`tab${activePeopleTab === 'employees' ? ' active' : ''}`}
              type="button"
              onClick={() => setActivePeopleTab('employees')}
            >
              Employees
            </button>
            <button
              className={`tab${activePeopleTab === 'groups' ? ' active' : ''}`}
              type="button"
              onClick={() => setActivePeopleTab('groups')}
            >
              Groups
            </button>
          </div>

          <section className="metrics">
            {activePeopleTab === 'employees' ? (
              <>
                <div className="card metric">
                  <span>Total employees</span>
                  <strong>{employees.length}</strong>
                  <em>Across {groups.length} groups</em>
                </div>
                <div className="card metric">
                  <span>Active participants</span>
                  <strong>{activeEmployees}</strong>
                  <em>Included in campaigns</em>
                </div>
                <div className="card metric">
                  <span>Missing group</span>
                  <strong>{missingGroupEmployees}</strong>
                  <em>Needs attention</em>
                </div>
                <div className="card metric">
                  <span>Multiple groups</span>
                  <strong>{multiGroupEmployees}</strong>
                  <em>Assigned to more than one group</em>
                </div>
              </>
            ) : (
              <>
                <div className="card metric">
                  <span>Total groups</span>
                  <strong>{groups.length}</strong>
                  <em>Available for campaigns</em>
                </div>
                <div className="card metric">
                  <span>Group memberships</span>
                  <strong>{totalGroupMemberships}</strong>
                  <em>Employees assigned to groups</em>
                </div>
                <div className="card metric">
                  <span>Empty groups</span>
                  <strong>{emptyGroups}</strong>
                  <em>Need members</em>
                </div>
                <div className="card metric">
                  <span>Largest group</span>
                  <strong>{largestGroup?.memberCount ?? 0}</strong>
                  <em>
                    {largestGroups.length > 0
                      ? largestGroups.map((group) => group.name).join(', ')
                      : `${averageMembersPerGroup} avg members`}
                  </em>
                </div>
              </>
            )}
          </section>

          {activePeopleTab === 'employees' && <section className="workspace">
            <div>
              <div className="card toolbar">
                <input
                  className="form-control"
                  placeholder="Search name, email or role…"
                  value={employeeSearch}
                  onChange={(event) => {
                    setEmployeeSearch(event.target.value);
                    setEmployeePage(1);
                  }}
                />
                <select
                  className="form-control"
                  value={groupFilter}
                  onChange={(event) => {
                    setGroupFilter(event.target.value);
                    setEmployeePage(1);
                  }}
                >
                  <option>All groups</option>
                  {groups.map((group) => (
                    <option key={group.id}>{group.name}</option>
                  ))}
                </select>
                <select
                  className="form-control"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setEmployeePage(1);
                  }}
                >
                  <option>All statuses</option>
                  <option>Active</option>
                  <option>Invited</option>
                </select>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={resetEmployeeFilters}
                >
                  Reset
                </button>
              </div>

              <div className="card table-card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          className={
                            sort.key === 'name'
                              ? `active${sort.direction === 'asc' ? ' asc' : ''}`
                              : ''
                          }
                          type="button"
                          onClick={() => handleSort('name')}
                        >
                          Employee
                        </button>
                      </th>
                      <th>
                        <button
                          className={
                            sort.key === 'role'
                              ? `active${sort.direction === 'asc' ? ' asc' : ''}`
                              : ''
                          }
                          type="button"
                          onClick={() => handleSort('role')}
                        >
                          Role
                        </button>
                      </th>
                      <th>
                        <button
                          className={
                            sort.key === 'groups'
                              ? `active${sort.direction === 'asc' ? ' asc' : ''}`
                              : ''
                          }
                          type="button"
                          onClick={() => handleSort('groups')}
                        >
                          Groups
                        </button>
                      </th>
                      <th>
                        <button
                          className={
                            sort.key === 'status'
                              ? `active${sort.direction === 'asc' ? ' asc' : ''}`
                              : ''
                          }
                          type="button"
                          onClick={() => handleSort('status')}
                        >
                          Status
                        </button>
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="employeeRows">
                    {!isPeopleLoading &&
                      !peopleError &&
                      employeePagination.items.map((employee) => (
                        <tr
                          key={employee.id}
                          className={selectedEmployee?.id === employee.id ? 'people-selected-row' : ''}
                          onClick={() => setSelectedEmployeeId(employee.id)}
                        >
                          <td>
                            <div className="person">
                              <div className="mini">
                                {getUserInitials(employee.name)}
                              </div>
                              <div>
                                <strong>{employee.name}</strong>
                                <span>{employee.email}</span>
                              </div>
                            </div>
                          </td>
                          <td>{employee.role}</td>
                          <td>
                            <div className="badges">
                              {employee.groups.length > 0 ? (
                                employee.groups.map((name) => (
                                  <span
                                    key={name}
                                    className="badge badge-primary people-group-badge"
                                  >
                                    {name}
                                  </span>
                                ))
                              ) : (
                                <span className="badge badge-warning people-status">
                                  No group
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${employee.status === 'Active' ? 'badge-success' : 'badge-warning'} people-status`}
                            >
                              {employee.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="link people-link-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditEmployeeModal(employee);
                              }}
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {(isPeopleLoading || peopleError || sortedEmployees.length === 0) && (
                  <div className="people-empty-log">
                    {isPeopleLoading && 'Loading people from database...'}
                    {!isPeopleLoading && peopleError && peopleError}
                    {!isPeopleLoading &&
                      !peopleError &&
                      employees.length === 0 &&
                      'No employees have been added yet.'}
                    {!isPeopleLoading &&
                      !peopleError &&
                      employees.length > 0 &&
                      sortedEmployees.length === 0 &&
                      'No employees match the current filters.'}
                  </div>
                )}
                <Pagination
                  pagination={employeePagination}
                  total={sortedEmployees.length}
                  noun="employees"
                  onPageChange={setEmployeePage}
                />
              </div>
            </div>

            <aside>
              <div className="card side-card">
                <h3>Employee details</h3>
                {selectedEmployee ? (
                  <>
                    <div className="person people-detail-person">
                      <div className="mini">
                        {getUserInitials(selectedEmployee.name)}
                      </div>
                      <div>
                        <strong>{selectedEmployee.name}</strong>
                        <span>{selectedEmployee.email}</span>
                      </div>
                    </div>
                    <div className="group-row">
                      <div>
                        <strong>Role</strong>
                        <span>{selectedEmployee.role}</span>
                      </div>
                    </div>
                    <div className="group-row">
                      <div>
                        <strong>Status</strong>
                        <span>{selectedEmployee.status}</span>
                      </div>
                    </div>
                    <div className="group-row">
                      <div>
                        <strong>Group(s)</strong>
                        <span>
                          {selectedEmployee.groups.length > 0
                            ? selectedEmployee.groups.join(', ')
                            : 'No group assigned'}
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary people-button"
                      type="button"
                      onClick={() => openEditEmployeeModal(selectedEmployee)}
                      style={{ width: '100%', marginTop: 12 }}
                    >
                      Edit employee
                    </button>
                  </>
                ) : (
                  <div className="group-row">
                    <div>
                      <strong>No employee selected</strong>
                      <span>Select an employee from the table.</span>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </section>}

          {activePeopleTab === 'groups' && <section className="workspace">
            <div>
              <div className="card toolbar">
                <input
                  className="form-control"
                  id="groupPageSearch"
                  value={groupSearch}
                  onChange={(event) => {
                    setGroupSearch(event.target.value);
                    setGroupPage(1);
                  }}
                  placeholder="Search groups..."
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setGroupSearch('');
                    setGroupPage(1);
                  }}
                >
                  Reset
                </button>
              </div>

              <div className="card table-card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Description</th>
                      <th>Members</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="groupRows">
                    {!isPeopleLoading &&
                      !peopleError &&
                      groupPagination.items.map((group) => (
                        <tr key={group.id}>
                          <td>
                            <button
                              className={`group-table-button${selectedGroup?.id === group.id ? ' active' : ''}`}
                              type="button"
                              onClick={() => selectGroup(group)}
                            >
                              {group.name}
                            </button>
                          </td>
                          <td>{group.description}</td>
                          <td>{group.memberCount}</td>
                          <td>
                            <button
                              className="link people-link-button"
                              type="button"
                              onClick={() => openEditGroupModal(group)}
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {(isPeopleLoading || peopleError || filteredGroups.length === 0) && (
                  <div className="people-empty-log">
                    {isPeopleLoading && 'Loading groups from database...'}
                    {!isPeopleLoading && peopleError && peopleError}
                    {!isPeopleLoading &&
                      !peopleError &&
                      groups.length === 0 &&
                      'No groups have been added yet.'}
                    {!isPeopleLoading &&
                      !peopleError &&
                      groups.length > 0 &&
                      filteredGroups.length === 0 &&
                      'No groups match the current filters.'}
                  </div>
                )}
                <Pagination
                  pagination={groupPagination}
                  total={filteredGroups.length}
                  noun="groups"
                  onPageChange={setGroupPage}
                />
              </div>
            </div>

            <aside>
              <div className="card side-card">
                <h3>{selectedGroup ? selectedGroup.name : 'Group members'}</h3>
                {selectedGroup && <p>{selectedGroup.description}</p>}
                <div className="member-list" id="groupPageMembers">
                  {members.length > 0 ? (
                    members.map((employee) => (
                      <span className="member-chip" key={employee.id}>
                        {employee.name}
                      </span>
                    ))
                  ) : (
                    <span className="member-chip">
                      No employees in this group yet
                    </span>
                  )}
                </div>
                {selectedGroup && (
                  <div className="people-member-add">
                    <div>
                      <strong>Add employee</strong>
                      <span>Select an employee to include in this group.</span>
                    </div>
                    <select
                      className="form-control"
                      value={sidePanelEmployeeId}
                      onChange={(event) => {
                        setSidePanelEmployeeId(event.target.value);
                        setGroupMemberMessage('');
                      }}
                    >
                      <option value="">Select employee</option>
                      {selectedGroupAvailableEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary people-button"
                      type="button"
                      onClick={() =>
                        handleAddGroupMember(selectedGroup.id, sidePanelEmployeeId)
                      }
                      disabled={isAddingGroupMember}
                    >
                      Add employee
                    </button>
                  </div>
                )}
                {groupMemberMessage !== '' && (
                  <div className="people-form-message">{groupMemberMessage}</div>
                )}
              </div>
            </aside>
          </section>}
        </main>
      </AppLayout>

      <div
        className={`modal-backdrop${isEmployeeModalOpen ? ' open' : ''}`}
        id="employeeModal"
        aria-hidden={!isEmployeeModalOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeEmployeeModal();
        }}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="employeeModalTitle"
        >
          <div className="modal-head">
            <div>
              <h2 id="employeeModalTitle">
                {editingEmployeeId === null ? 'Add employee' : 'Edit employee'}
              </h2>
              <p>
                {editingEmployeeId === null
                  ? 'Add one employee manually or upload multiple employees from Excel.'
                  : 'Update employee details and group memberships.'}
              </p>
            </div>
            <button
              className="close"
              id="closeEmployeeModal"
              onClick={closeEmployeeModal}
              type="button"
              disabled={isSavingEmployee}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            {editingEmployeeId === null && (
              <div className="add-tabs">
                <button
                  className={`add-tab${employeeTab === 'manualPanel' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setEmployeeTab('manualPanel')}
                >
                  Manual entry
                </button>
                <button
                  className={`add-tab${employeeTab === 'excelPanel' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setEmployeeTab('excelPanel')}
                >
                  Excel upload
                </button>
              </div>
            )}
            <div
              className={`panel${employeeTab === 'manualPanel' || editingEmployeeId !== null ? ' active' : ''}`}
              id="manualPanel"
            >
              <form onSubmit={handleCreateEmployee}>
              <div className="form-grid">
                <div className="form-field field">
                  <label className="form-label">Full name</label>
                  <input
                    className="form-control"
                    placeholder="e.g. Anna Molnár"
                    value={employeeForm.name}
                    onChange={(event) =>
                      updateEmployeeForm('name', event.target.value)
                    }
                  />
                </div>
                <div className="form-field field">
                  <label className="form-label">Role</label>
                  <input
                    className="form-control"
                    placeholder="e.g. Engineering Manager"
                    value={employeeForm.role}
                    onChange={(event) =>
                      updateEmployeeForm('role', event.target.value)
                    }
                  />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Email address</label>
                  <input
                    className="form-control"
                    type="email"
                    placeholder="anna.molnar@company.com"
                    value={employeeForm.email}
                    onChange={(event) =>
                      updateEmployeeForm('email', event.target.value)
                    }
                  />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Groups</label>
                  <div className="group-checks">
                    {groups.map((group) => (
                      <label key={group.id}>
                        <input
                          type="checkbox"
                          checked={employeeForm.groupIds.includes(group.id)}
                          onChange={() => toggleEmployeeGroup(group.id)}
                        />{' '}
                        {group.name}
                      </label>
                    ))}
                    {groups.length === 0 && <span>No groups available.</span>}
                  </div>
                </div>
              </div>
              {employeeFormMessage !== '' && (
                <div className="people-form-message">{employeeFormMessage}</div>
              )}
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                  id="cancelManual"
                  onClick={closeEmployeeModal}
                  disabled={isSavingEmployee}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary people-button"
                  type="submit"
                  disabled={isSavingEmployee}
                >
                  {isSavingEmployee
                    ? 'Saving...'
                    : editingEmployeeId === null
                      ? 'Save employee'
                      : 'Update employee'}
                </button>
              </div>
              </form>
            </div>
            {editingEmployeeId === null && <div
              className={`panel${employeeTab === 'excelPanel' ? ' active' : ''}`}
              id="excelPanel"
            >
              <div className="upload-box">
                <strong>Upload Excel file</strong>
                <p>
                  Use an .xlsx file with columns: name, role, email, groups.
                </p>
                <label className="file-picker">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(event) => {
                      setEmployeeImportFile(event.target.files?.[0] ?? null);
                      setEmployeeImportMessage('');
                      setEmployeeImportErrors([]);
                    }}
                  />
                  <span>
                    {employeeImportFile?.name ?? 'Choose Excel file'}
                  </span>
                </label>
              </div>
              {(employeeImportMessage !== '' || employeeImportErrors.length > 0) && (
                <div className="people-form-message">
                  {employeeImportMessage !== '' && <p>{employeeImportMessage}</p>}
                  {employeeImportErrors.length > 0 && (
                    <ul>
                      {employeeImportErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <a
                  className="btn btn-secondary people-button"
                  href={employeeTemplateUrl}
                  download="upload_employee_empty_template.xlsx"
                >
                  Download template
                </a>
                <button
                  className="btn btn-primary people-button"
                  type="button"
                  onClick={handleImportEmployees}
                  disabled={isImportingEmployees}
                >
                  {isImportingEmployees ? 'Uploading...' : 'Upload employees'}
                </button>
              </div>
            </div>}
          </div>
        </div>
      </div>

      <div
        className={`modal-backdrop${isGroupsModalOpen ? ' open' : ''}`}
        id="groupsModal"
        aria-hidden={!isGroupsModalOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeGroupModal();
        }}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="groupsModalTitle"
        >
          <div className="modal-head">
            <div>
              <h2 id="groupsModalTitle">
                {editingGroupId === null ? 'Add group' : 'Edit group'}
              </h2>
              <p>
                {editingGroupId === null
                  ? 'Create groups manually or import group names and descriptions from Excel.'
                  : 'Update group name and description.'}
              </p>
            </div>
            <button
              className="close"
              id="closeGroupsModal"
              onClick={closeGroupModal}
              type="button"
              disabled={isSavingGroup}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            {editingGroupId === null && <div className="add-tabs">
              <button
                className={`add-tab${groupTab === 'groupManualPanel' ? ' active' : ''}`}
                type="button"
                onClick={() => setGroupTab('groupManualPanel')}
              >
                Manual group
              </button>
              <button
                className={`add-tab${groupTab === 'groupExcelPanel' ? ' active' : ''}`}
                type="button"
                onClick={() => setGroupTab('groupExcelPanel')}
              >
                Excel import
              </button>
            </div>}
            <div
              className={`panel${groupTab === 'groupManualPanel' || editingGroupId !== null ? ' active' : ''}`}
              id="groupManualPanel"
            >
              <form onSubmit={handleSaveGroup}>
              <div className="form-grid">
                <div className="form-field field full">
                  <label className="form-label">Group name</label>
                  <input
                    className="form-control"
                    id="groupNameInput"
                    placeholder="e.g. Engineering"
                    value={groupForm.name}
                    onChange={(event) =>
                      updateGroupForm('name', event.target.value)
                    }
                  />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-control"
                    id="groupDescriptionInput"
                    placeholder="Describe who belongs to this group and when it should be used…"
                    value={groupForm.description}
                    onChange={(event) =>
                      updateGroupForm('description', event.target.value)
                    }
                  />
                </div>
              </div>
              <div className="group-manager-tools">
                <strong>Existing groups</strong>
                <input
                  className="form-control"
                  id="groupSearch"
                  value={groupSearch}
                  onChange={(event) => {
                    setGroupSearch(event.target.value);
                    setGroupPage(1);
                  }}
                  placeholder="Search groups…"
                />
              </div>
              <div className="group-manager-list" id="groupManagerList">
                {groupPagination.items.map((group) => (
                  <button
                    key={group.id}
                    className={`group-manager-row${selectedGroup?.id === group.id ? ' active' : ''}`}
                    type="button"
                    onClick={() => selectGroup(group)}
                  >
                    <strong>{group.name}</strong>
                    <span>{group.description}</span>
                  </button>
                ))}
              </div>
              <Pagination
                pagination={groupPagination}
                total={filteredGroups.length}
                noun="groups"
                onPageChange={setGroupPage}
              />
              <div className="members-box">
                <h4 id="selectedGroupTitle">
                  {selectedGroup ? `${selectedGroup.name} members` : 'Group members'}
                </h4>
                <div className="member-list" id="groupMembers">
                  {members.length > 0 ? (
                    members.map((employee) => (
                      <span className="member-chip" key={employee.id}>
                        {employee.name}
                      </span>
                    ))
                  ) : (
                    <span className="member-chip">
                      No employees in this group yet
                    </span>
                  )}
                </div>
                {editingGroupId !== null && (
                  <div className="people-member-add">
                    <div>
                      <strong>Add employee</strong>
                      <span>Select an employee to include in this group.</span>
                    </div>
                    <select
                      className="form-control"
                      value={groupModalEmployeeId}
                      onChange={(event) => {
                        setGroupModalEmployeeId(event.target.value);
                        setGroupMemberMessage('');
                      }}
                    >
                      <option value="">Select employee</option>
                      {editingGroupAvailableEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary people-button"
                      type="button"
                      onClick={() =>
                        handleAddGroupMember(editingGroupId, groupModalEmployeeId)
                      }
                      disabled={isAddingGroupMember}
                    >
                      Add employee
                    </button>
                  </div>
                )}
              </div>
              {groupMemberMessage !== '' && (
                <div className="people-form-message">{groupMemberMessage}</div>
              )}
              {groupFormMessage !== '' && (
                <div className="people-form-message">{groupFormMessage}</div>
              )}
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                  id="cancelGroups"
                  onClick={closeGroupModal}
                  disabled={isSavingGroup}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary people-button"
                  type="submit"
                  disabled={isSavingGroup}
                >
                  {isSavingGroup
                    ? 'Saving...'
                    : editingGroupId === null
                      ? 'Save group'
                      : 'Update group'}
                </button>
              </div>
              </form>
            </div>
            {editingGroupId === null && <div
              className={`panel${groupTab === 'groupExcelPanel' ? ' active' : ''}`}
              id="groupExcelPanel"
            >
              <div className="upload-box">
                <strong>Import groups from Excel</strong>
                <p>Use the provided .xlsx template with Group Name and Group Description columns.</p>
                <label className="file-picker">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(event) => {
                      setGroupImportFile(event.target.files?.[0] ?? null);
                      setGroupImportMessage('');
                      setGroupImportErrors([]);
                    }}
                  />
                  <span>{groupImportFile?.name ?? 'Choose Excel file'}</span>
                </label>
              </div>
              {(groupImportMessage !== '' || groupImportErrors.length > 0) && (
                <div className="people-form-message">
                  {groupImportMessage !== '' && <p>{groupImportMessage}</p>}
                  {groupImportErrors.length > 0 && (
                    <ul>
                      {groupImportErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <a
                  className="btn btn-secondary people-button"
                  href={groupTemplateUrl}
                  download="upload_group_empty_template.xlsx"
                >
                  Download template
                </a>
                <button
                  className="btn btn-primary people-button"
                  type="button"
                  onClick={handleImportGroups}
                  disabled={isImportingGroups}
                >
                  {isImportingGroups ? 'Importing...' : 'Import groups'}
                </button>
              </div>
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
