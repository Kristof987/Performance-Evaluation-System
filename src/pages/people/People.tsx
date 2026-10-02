import { getUserInitials } from '../layout/sidebar-user';
import AppLayout from '../layout/AppLayout';
import { useState } from 'react';
import './people.css';
import '../hr-home/hr-home.css';

type Employee = {
  id: number;
  name: string;
  role: string;
  groups: string[];
  status: 'Active' | 'Invited';
  email: string;
};
type Group = { name: string; description: string };
type SortKey = 'name' | 'role' | 'groups' | 'status';
type Page<T> = {
  items: T[];
  page: number;
  pages: number;
  from: number;
  to: number;
};

// Existing demonstration data; replace with API data when that feature is implemented.
const employees: Employee[] = [
  {
    id: 1,
    name: 'Anna Molnár',
    role: 'Engineering Manager',
    groups: ['Engineering', 'Managers'],
    status: 'Active',
    email: 'anna.molnar@company.com',
  },
  {
    id: 2,
    name: 'Bence Lakatos',
    role: 'Frontend Developer',
    groups: ['Engineering', 'Remote'],
    status: 'Active',
    email: 'bence.lakatos@company.com',
  },
  {
    id: 3,
    name: 'Eszter Papp',
    role: 'Product Designer',
    groups: ['Product', 'Design'],
    status: 'Active',
    email: 'eszter.papp@company.com',
  },
  {
    id: 4,
    name: 'Krisztián Tóth',
    role: 'Sales Lead',
    groups: ['Sales', 'Managers'],
    status: 'Invited',
    email: 'krisztian.toth@company.com',
  },
  {
    id: 5,
    name: 'Nóra Rácz',
    role: 'HR Specialist',
    groups: ['People Ops'],
    status: 'Active',
    email: 'nora.racz@company.com',
  },
  {
    id: 6,
    name: 'Dániel Farkas',
    role: 'Backend Developer',
    groups: ['Engineering'],
    status: 'Active',
    email: 'daniel.farkas@company.com',
  },
  {
    id: 7,
    name: 'Réka Varga',
    role: 'Account Executive',
    groups: ['Sales', 'Remote'],
    status: 'Active',
    email: 'reka.varga@company.com',
  },
  {
    id: 8,
    name: 'Máté Horváth',
    role: 'QA Engineer',
    groups: ['Engineering', 'Product'],
    status: 'Invited',
    email: 'mate.horvath@company.com',
  },
  {
    id: 9,
    name: 'Lilla Kovács',
    role: 'People Partner',
    groups: ['People Ops', 'Managers'],
    status: 'Active',
    email: 'lilla.kovacs@company.com',
  },
  {
    id: 10,
    name: 'Gábor Szabó',
    role: 'Product Manager',
    groups: ['Product', 'Managers'],
    status: 'Active',
    email: 'gabor.szabo@company.com',
  },
  {
    id: 11,
    name: 'Zsófia Nagy',
    role: 'Customer Success Manager',
    groups: ['Sales'],
    status: 'Active',
    email: 'zsofia.nagy@company.com',
  },
  {
    id: 12,
    name: 'Péter Kiss',
    role: 'Data Analyst',
    groups: ['Product', 'Remote'],
    status: 'Active',
    email: 'peter.kiss@company.com',
  },
];
const groups: Group[] = [
  {
    name: 'Engineering',
    description: 'Developers, QA and engineering managers.',
  },
  {
    name: 'Managers',
    description: 'People managers included in manager feedback workflows.',
  },
  {
    name: 'Product',
    description: 'Product managers, designers and product analysts.',
  },
  {
    name: 'Remote',
    description: 'Employees working mainly remotely.',
  },
  {
    name: 'Sales',
    description: 'Sales and account management team.',
  },
  {
    name: 'Design',
    description: 'Product and brand designers.',
  },
  {
    name: 'People Ops',
    description: 'HR and people operations team.',
  },
  {
    name: 'Customer Success',
    description: 'Customer-facing success managers.',
  },
  {
    name: 'Leadership',
    description: 'Company leadership and senior decision makers.',
  },
  {
    name: 'New Joiners',
    description: 'Employees who joined in the last 90 days.',
  },
];

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
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isGroupsModalOpen, setIsGroupsModalOpen] = useState(false);
  const [employeeTab, setEmployeeTab] = useState<'manualPanel' | 'excelPanel'>(
    'manualPanel',
  );
  const [groupTab, setGroupTab] = useState<
    'groupManualPanel' | 'groupExcelPanel'
  >('groupManualPanel');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>(
    { key: 'name', direction: 'asc' },
  );
  const [employeePage, setEmployeePage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<Group>(groups[0]);
  const [groupName, setGroupName] = useState(groups[0].name);
  const [groupDescription, setGroupDescription] = useState(
    groups[0].description,
  );

  const sortedEmployees = [...employees].sort((a, b) => {
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
  const members = sortedEmployees.filter((employee) =>
    employee.groups.includes(selectedGroup.name),
  );

  function handleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setEmployeePage(1);
  }

  function selectGroup(group: Group) {
    setSelectedGroup(group);
    setGroupName(group.name);
    setGroupDescription(group.description);
  }

  return (
    <div className="people-page">
      <AppLayout activePage="people" pageClassName="">
        <main className="main">
          <div className="top-actions">
            <button className="icon-btn">⌕</button>
            <button className="icon-btn">🔔</button>
          </div>
          <section className="hello">
            <h1>People</h1>
            <p>Manage employees, roles, emails and group memberships.</p>
          </section>

          <section className="page-head">
            <div className="title">
              <h2>Employee directory</h2>
              <p>
                One employee can belong to multiple groups used in review
                campaigns.
              </p>
            </div>
            <div className="actions">
              <button
                className="btn btn-primary people-button"
                id="addEmployeeBtn"
                onClick={() => setIsEmployeeModalOpen(true)}
              >
                Add employee
              </button>
            </div>
          </section>

          <div className="tabs">
            <div className="tab active">Employees</div>
            <div className="tab">Groups</div>
          </div>

          <section className="metrics">
            <div className="card metric">
              <span>Total employees</span>
              <strong>128</strong>
              <em>Across 9 groups</em>
            </div>
            <div className="card metric">
              <span>Active participants</span>
              <strong>116</strong>
              <em>Included in campaigns</em>
            </div>
            <div className="card metric">
              <span>Missing group</span>
              <strong>7</strong>
              <em>Needs attention</em>
            </div>
            <div className="card metric">
              <span>Invited</span>
              <strong>5</strong>
              <em>Waiting for activation</em>
            </div>
          </section>

          <section className="workspace">
            <div>
              <div className="card toolbar">
                <input
                  className="form-control"
                  placeholder="Search name, email or role…"
                />
                <select className="form-control">
                  <option>All groups</option>
                  <option>Engineering</option>
                  <option>Managers</option>
                  <option>Sales</option>
                </select>
                <select className="form-control">
                  <option>All statuses</option>
                  <option>Active</option>
                  <option>Invited</option>
                </select>
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
                    {employeePagination.items.map((employee) => (
                      <tr key={employee.id}>
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
                            {employee.groups.map((name) => (
                              <span
                                key={name}
                                className="badge badge-primary people-group-badge"
                              >
                                {name}
                              </span>
                            ))}
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
                          <a className="link" href="#">
                            Edit
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination
                  pagination={employeePagination}
                  total={employees.length}
                  noun="employees"
                  onPageChange={setEmployeePage}
                />
              </div>
            </div>

            <aside>
              <div className="card side-card">
                <h3>Groups</h3>
                <div className="group-row">
                  <div>
                    <strong>Engineering</strong>
                    <span>Department group</span>
                  </div>
                  <div className="count">42</div>
                </div>
                <div className="group-row">
                  <div>
                    <strong>Managers</strong>
                    <span>Role-based group</span>
                  </div>
                  <div className="count">14</div>
                </div>
                <div className="group-row">
                  <div>
                    <strong>Product</strong>
                    <span>Department group</span>
                  </div>
                  <div className="count">18</div>
                </div>
                <div className="group-row">
                  <div>
                    <strong>Remote</strong>
                    <span>Custom group</span>
                  </div>
                  <div className="count">27</div>
                </div>
                <button
                  className="btn btn-secondary people-button"
                  id="manageGroupsBtn"
                  onClick={() => setIsGroupsModalOpen(true)}
                  style={{ width: '100%', marginTop: 12 }}
                >
                  Manage groups
                </button>
              </div>
            </aside>
          </section>
        </main>
      </AppLayout>

      <div
        className={`modal-backdrop${isEmployeeModalOpen ? ' open' : ''}`}
        id="employeeModal"
        aria-hidden={!isEmployeeModalOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget)
            setIsEmployeeModalOpen(false);
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
              <h2 id="employeeModalTitle">Add employee</h2>
              <p>
                Add one employee manually or upload multiple employees from
                Excel.
              </p>
            </div>
            <button
              className="close"
              id="closeEmployeeModal"
              onClick={() => setIsEmployeeModalOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="modal-body">
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
            <div
              className={`panel${employeeTab === 'manualPanel' ? ' active' : ''}`}
              id="manualPanel"
            >
              <div className="form-grid">
                <div className="form-field field">
                  <label className="form-label">Full name</label>
                  <input
                    className="form-control"
                    placeholder="e.g. Anna Molnár"
                  />
                </div>
                <div className="form-field field">
                  <label className="form-label">Role</label>
                  <input
                    className="form-control"
                    placeholder="e.g. Engineering Manager"
                  />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Email address</label>
                  <input
                    className="form-control"
                    type="email"
                    placeholder="anna.molnar@company.com"
                  />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Groups</label>
                  <div className="group-checks">
                    <label>
                      <input type="checkbox" /> Engineering
                    </label>
                    <label>
                      <input type="checkbox" /> Managers
                    </label>
                    <label>
                      <input type="checkbox" /> Product
                    </label>
                    <label>
                      <input type="checkbox" /> Sales
                    </label>
                    <label>
                      <input type="checkbox" /> Remote
                    </label>
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                  id="cancelManual"
                  onClick={() => setIsEmployeeModalOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary people-button" type="button">
                  Save employee
                </button>
              </div>
            </div>
            <div
              className={`panel${employeeTab === 'excelPanel' ? ' active' : ''}`}
              id="excelPanel"
            >
              <div className="upload-box">
                <strong>Upload Excel file</strong>
                <p>
                  Use an .xlsx file with columns: name, role, email, groups.
                </p>
                <label className="file-picker">
                  <input type="file" accept=".xlsx,.xls,.csv" />
                  <span>Choose Excel file</span>
                </label>
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                >
                  Download template
                </button>
                <button className="btn btn-primary people-button" type="button">
                  Upload employees
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`modal-backdrop${isGroupsModalOpen ? ' open' : ''}`}
        id="groupsModal"
        aria-hidden={!isGroupsModalOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) setIsGroupsModalOpen(false);
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
              <h2 id="groupsModalTitle">Manage groups</h2>
              <p>
                Create groups manually or import group names and descriptions
                from Excel.
              </p>
            </div>
            <button
              className="close"
              id="closeGroupsModal"
              onClick={() => setIsGroupsModalOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            <div className="add-tabs">
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
            </div>
            <div
              className={`panel${groupTab === 'groupManualPanel' ? ' active' : ''}`}
              id="groupManualPanel"
            >
              <div className="form-grid">
                <div className="form-field field full">
                  <label className="form-label">Group name</label>
                  <input
                    className="form-control"
                    id="groupNameInput"
                    placeholder="e.g. Engineering"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                  />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-control"
                    id="groupDescriptionInput"
                    placeholder="Describe who belongs to this group and when it should be used…"
                    value={groupDescription}
                    onChange={(event) =>
                      setGroupDescription(event.target.value)
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
                    key={group.name}
                    className={`group-manager-row${selectedGroup.name === group.name ? ' active' : ''}`}
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
                <h4 id="selectedGroupTitle">{selectedGroup.name} members</h4>
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
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                  id="cancelGroups"
                  onClick={() => setIsGroupsModalOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary people-button" type="button">
                  Save group
                </button>
              </div>
            </div>
            <div
              className={`panel${groupTab === 'groupExcelPanel' ? ' active' : ''}`}
              id="groupExcelPanel"
            >
              <div className="upload-box">
                <strong>Import groups from Excel</strong>
                <p>Use an .xlsx file with columns: group name, description.</p>
                <label className="file-picker">
                  <input type="file" accept=".xlsx,.xls,.csv" />
                  <span>Choose Excel file</span>
                </label>
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                >
                  Download template
                </button>
                <button className="btn btn-primary people-button" type="button">
                  Import groups
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
