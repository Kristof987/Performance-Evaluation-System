import { getUserInitials } from '../layout/sidebar-user';
import AppLayout from '../layout/AppLayout';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  addGroupMember,
  createEmployee,
  createGroup,
  fetchPeople,
  importEmployees,
  importGroups,
  removeGroupMember,
  updateEmployee,
  updateGroup,
  type Employee,
  type EmployeeFormValues,
  type Group,
  type GroupFormValues,
} from './people.api';
import '../hr-home/hr-home.css';
import '../hr-home/components/MetricsGrid.css';
import './people.css';

type SortKey = 'name' | 'role' | 'groups' | 'status';
type Page<T> = {
  items: T[];
  page: number;
  pages: number;
  from: number;
  to: number;
};

type PeopleTab = 'employees' | 'groups';

type PeopleMetric = {
  label: string;
  value: ReactNode;
  context: ReactNode;
};

type EmployeeFormErrors = Partial<Record<keyof EmployeeFormValues, string>>;

type PendingMemberRemoval = {
  groupId: number;
  groupName: string;
  employeeId: number;
  employeeName: string;
} | null;

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

function isValidExcelFile(file: File) {
  return file.name.toLowerCase().endsWith('.xlsx');
}

function validateEmployeeForm(form: EmployeeFormValues): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  if (form.name.trim() === '') errors.name = 'Full name is required.';
  if (form.role.trim() === '') errors.role = 'Role is required.';
  if (form.email.trim() === '') {
    errors.email = 'Email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}

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

function PeopleHeader({
  activeTab,
  onAddEmployee,
  onAddGroup,
}: {
  activeTab: PeopleTab;
  onAddEmployee: () => void;
  onAddGroup: () => void;
}) {
  return (
    <section className="people-header">
      <div>
        <h1>People</h1>
        <p>Manage employees and groups in your organization.</p>
      </div>
      <button
        className="btn btn-primary people-button"
        type="button"
        onClick={activeTab === 'employees' ? onAddEmployee : onAddGroup}
      >
        {activeTab === 'employees' ? 'Add employee' : 'Add group'}
      </button>
    </section>
  );
}

function PeopleTabs({
  activeTab,
  onChange,
}: {
  activeTab: PeopleTab;
  onChange: (tab: PeopleTab) => void;
}) {
  return (
    <div className="tabs people-tabs" aria-label="People views">
      <button
        className={`tab${activeTab === 'employees' ? ' active' : ''}`}
        type="button"
        onClick={() => onChange('employees')}
      >
        Employees
      </button>
      <button
        className={`tab${activeTab === 'groups' ? ' active' : ''}`}
        type="button"
        onClick={() => onChange('groups')}
      >
        Groups
      </button>
    </div>
  );
}

function PeopleMetrics({
  metrics,
  label,
}: {
  metrics: PeopleMetric[];
  label: string;
}) {
  return (
    <section className="card kpi-section people-kpi-section" aria-label={label}>
      {metrics.map((metric) => (
        <div className="kpi-item" key={metric.label}>
          <div className="kpi-label">{metric.label}</div>
          <div className="kpi-value">{metric.value}</div>
          <div className="kpi-context">{metric.context}</div>
        </div>
      ))}
    </section>
  );
}

function DetailDrawer({
  isOpen,
  title,
  titleId,
  onClose,
  suspendFocusTrap = false,
  children,
}: {
  isOpen: boolean;
  title: string;
  titleId: string;
  onClose: () => void;
  suspendFocusTrap?: boolean;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || suspendFocusTrap) return undefined;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = drawer
      ? Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter(
          (element) => !element.hasAttribute('disabled'),
        )
      : [];
    focusable[0]?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || drawer === null) return;
      const currentFocusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute('disabled'));
      if (currentFocusable.length === 0) return;
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('people-drawer-lock');
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('people-drawer-lock');
      previousFocusRef.current?.focus();
    };
  }, [isOpen, suspendFocusTrap]);

  if (!isOpen) return null;

  return (
    <div
      className="people-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="people-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={drawerRef}
      >
        <div className="people-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button
            className="close"
            type="button"
            onClick={onClose}
            aria-label="Close details"
          >
            ×
          </button>
        </div>
        <div className="people-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function isEmptyDescription(description: string) {
  return description.trim() === '' || description === 'No description provided.';
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="people-field-error">{message}</span>;
}

function useViewportDropdownPosition(
  isOpen: boolean,
  anchorRef: RefObject<HTMLElement | null>,
) {
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const margin = 14;
      const gap = 6;
      const preferredMaxHeight = 240;
      const minimumUsefulHeight = 120;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - margin - gap;
      const spaceAbove = rect.top - margin - gap;
      const openDown = spaceBelow >= minimumUsefulHeight || spaceBelow >= spaceAbove;
      const availableHeight = Math.max(
        minimumUsefulHeight,
        openDown ? spaceBelow : spaceAbove,
      );
      const maxHeight = Math.min(preferredMaxHeight, availableHeight);
      const width = Math.min(rect.width, viewportWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, viewportWidth - margin - width),
      );
      const top = openDown
        ? Math.min(rect.bottom + gap, viewportHeight - margin - maxHeight)
        : Math.max(margin, rect.top - gap - maxHeight);

      setStyle({
        left,
        maxHeight,
        position: 'fixed',
        top,
        width,
      });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, isOpen]);

  return style;
}

function GroupMultiSelect({
  groups,
  selectedGroupIds,
  onChange,
}: {
  groups: Group[];
  selectedGroupIds: number[];
  onChange: (groupIds: number[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownStyle = useViewportDropdownPosition(isOpen, anchorRef);
  const selectedGroups = groups.filter((group) => selectedGroupIds.includes(group.id));
  const filteredGroups = groups.filter((group) =>
    group.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  function toggleGroup(groupId: number) {
    onChange(
      selectedGroupIds.includes(groupId)
        ? selectedGroupIds.filter((id) => id !== groupId)
        : [...selectedGroupIds, groupId],
    );
  }

  return (
    <div className="group-multiselect" ref={rootRef}>
      <div className="group-selected-list" aria-label="Selected groups">
        {selectedGroups.length > 0 ? (
          selectedGroups.map((group) => (
            <span className="group-selected-chip" key={group.id}>
              {group.name}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-label={`Remove ${group.name}`}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="group-empty-selection">No groups selected</span>
        )}
      </div>
      <div className="group-search-control" ref={anchorRef}>
        <input
          className="form-control group-search-input"
          type="search"
          value={search}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            setIsOpen(true);
          }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setIsOpen(false);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            window.requestAnimationFrame(() => {
              dropdownRef.current
                ?.querySelector<HTMLInputElement>('.group-option input')
                ?.focus();
            });
          }
        }}
          placeholder="Search and add groups..."
          aria-label="Search groups"
          aria-expanded={isOpen}
          aria-controls="group-multiselect-options"
        />
        <button
          className="group-dropdown-toggle"
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-label={isOpen ? 'Close group options' : 'Open group options'}
          aria-expanded={isOpen}
        >
          ▾
        </button>
      </div>
      {isOpen && createPortal(
        <div
          className="group-option-list"
          id="group-multiselect-options"
          role="group"
          aria-label="Available groups"
          ref={dropdownRef}
          style={dropdownStyle}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          {groups.length === 0 && <span>No groups available.</span>}
          {groups.length > 0 && filteredGroups.length === 0 && (
            <span>No groups match your search.</span>
          )}
          {filteredGroups.map((group) => (
            <label className="group-option" key={group.id}>
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setIsOpen(false);
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const options = Array.from(
                      dropdownRef.current?.querySelectorAll<HTMLInputElement>(
                        '.group-option input',
                      ) ?? [],
                    );
                    const currentIndex = options.indexOf(event.currentTarget);
                    const nextIndex =
                      event.key === 'ArrowDown'
                        ? Math.min(options.length - 1, currentIndex + 1)
                        : Math.max(0, currentIndex - 1);
                    options[nextIndex]?.focus();
                  }
                }}
              />
              <span>{group.name}</span>
            </label>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function EmployeeCombobox({
  employees,
  selectedEmployeeId,
  search,
  onSearchChange,
  onSelect,
}: {
  employees: Employee[];
  selectedEmployeeId: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (employeeId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownStyle = useViewportDropdownPosition(isOpen, anchorRef);
  const selectedEmployee = employees.find(
    (employee) => String(employee.id) === selectedEmployeeId,
  );
  const filteredEmployees = employees.filter((employee) =>
    `${employee.name} ${employee.email}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const inputValue = selectedEmployee && !isOpen ? selectedEmployee.name : search;

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  return (
    <div className="employee-combobox" ref={rootRef}>
      <div className="employee-combobox-control" ref={anchorRef}>
        <input
          className="form-control"
          type="search"
          value={inputValue}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onChange={(event) => {
            onSearchChange(event.target.value);
            onSelect('');
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setIsOpen(false);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIsOpen(true);
              window.requestAnimationFrame(() => {
                dropdownRef.current
                  ?.querySelector<HTMLButtonElement>('.employee-combobox-option')
                  ?.focus();
              });
            }
          }}
          placeholder="Search employees..."
          aria-label="Search employees to add"
          aria-expanded={isOpen}
          aria-controls="group-member-options"
        />
        {selectedEmployeeId !== '' && (
          <button
            type="button"
            onClick={() => {
              onSelect('');
              onSearchChange('');
              setIsOpen(false);
            }}
            aria-label="Clear selected employee"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-label={isOpen ? 'Close employee options' : 'Open employee options'}
          aria-expanded={isOpen}
        >
          ▾
        </button>
      </div>
      {isOpen && createPortal(
        <div
          className="employee-combobox-options"
          id="group-member-options"
          role="listbox"
          aria-label="Eligible employees"
          ref={dropdownRef}
          style={dropdownStyle}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          {employees.length === 0 && (
            <div className="employee-combobox-empty">
              All employees are already members of this group.
            </div>
          )}
          {employees.length > 0 && filteredEmployees.length === 0 && (
            <div className="employee-combobox-empty">No employees match your search.</div>
          )}
          {filteredEmployees.map((employee) => (
            <button
              className="employee-combobox-option"
              type="button"
              key={employee.id}
              role="option"
              aria-selected={String(employee.id) === selectedEmployeeId}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const options = Array.from(
                    dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
                      '.employee-combobox-option',
                    ) ?? [],
                  );
                  const currentIndex = options.indexOf(event.currentTarget);
                  const nextIndex =
                    event.key === 'ArrowDown'
                      ? Math.min(options.length - 1, currentIndex + 1)
                      : Math.max(0, currentIndex - 1);
                  options[nextIndex]?.focus();
                }
              }}
              onClick={() => {
                onSelect(String(employee.id));
                onSearchChange('');
                setIsOpen(false);
              }}
            >
              <strong>{employee.name}</strong>
              <span>{employee.email}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ImportPanel({
  title,
  description,
  file,
  message,
  errors,
  templateUrl,
  templateName,
  uploadLabel,
  uploadingLabel,
  isUploading,
  onFileChange,
  onUpload,
}: {
  title: string;
  description: string;
  file: File | null;
  message: string;
  errors: string[];
  templateUrl: string;
  templateName: string;
  uploadLabel: string;
  uploadingLabel: string;
  isUploading: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
}) {
  const hasValidFile = file !== null && isValidExcelFile(file);

  return (
    <>
      <div className="upload-box">
        <strong>{title}</strong>
        <p>{description}</p>
        <label className="file-picker">
          <input
            type="file"
            accept=".xlsx"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
          <span>{file?.name ?? 'Choose Excel file'}</span>
        </label>
        {file !== null && !isValidExcelFile(file) && (
          <div className="people-form-message">Upload an .xlsx file.</div>
        )}
      </div>
      {(message !== '' || errors.length > 0) && (
        <div className="people-form-message" aria-live="polite">
          {message !== '' && <p>{message}</p>}
          {errors.length > 0 && (
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="modal-actions">
        <a
          className="btn btn-secondary people-button"
          href={templateUrl}
          download={templateName}
        >
          Download template
        </a>
        <button
          className="btn btn-primary people-button"
          type="button"
          onClick={onUpload}
          disabled={isUploading || !hasValidFile}
        >
          {isUploading ? uploadingLabel : uploadLabel}
        </button>
      </div>
    </>
  );
}

export default function People() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isPeopleLoading, setIsPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState('');
  const [activePeopleTab, setActivePeopleTab] = useState<PeopleTab>('employees');
  const [employeeForm, setEmployeeForm] =
    useState<EmployeeFormValues>(emptyEmployeeForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [employeeFormErrors, setEmployeeFormErrors] = useState<EmployeeFormErrors>({});
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
  const [shouldRestoreGroupDrawer, setShouldRestoreGroupDrawer] = useState(false);
  const [groupFormMessage, setGroupFormMessage] = useState('');
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [sidePanelEmployeeId, setSidePanelEmployeeId] = useState('');
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [groupMemberMessage, setGroupMemberMessage] = useState('');
  const [isAddingGroupMember, setIsAddingGroupMember] = useState(false);
  const [removingGroupMemberId, setRemovingGroupMemberId] = useState<number | null>(
    null,
  );
  const [pendingMemberRemoval, setPendingMemberRemoval] =
    useState<PendingMemberRemoval>(null);
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
    groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedEmployee =
    employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const memberManagementGroup =
    selectedGroup ??
    (editingGroupId !== null
      ? groups.find((group) => group.id === editingGroupId) ?? null
      : null);

  function applyPeopleData(people: { employees: Employee[]; groups: Group[] }) {
    setEmployees(people.employees);
    setGroups(people.groups);
    setSelectedEmployeeId((current) =>
      current !== null && people.employees.some((employee) => employee.id === current)
        ? current
        : null,
    );
    setSelectedGroupId((current) =>
      current !== null && people.groups.some((group) => group.id === current)
        ? current
        : null,
    );
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
  const members = memberManagementGroup
    ? employees.filter((employee) =>
        employee.groups.includes(memberManagementGroup.name),
      )
    : [];
  const selectedGroupAvailableEmployees = selectedGroup
    ? employees.filter((employee) => !employee.groupIds.includes(selectedGroup.id))
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
  const employeeFiltersActive =
    employeeSearch.trim() !== '' ||
    groupFilter !== 'All groups' ||
    statusFilter !== 'All statuses';
  const groupFiltersActive = groupSearch.trim() !== '';
  const employeeMetrics: PeopleMetric[] = [
    {
      label: 'Total employees',
      value: employees.length,
      context: `Across ${groups.length} groups`,
    },
    {
      label: 'Active employees',
      value: activeEmployees,
      context: 'Enabled accounts',
    },
    {
      label: 'Without a group',
      value: missingGroupEmployees,
      context: 'No group assigned',
    },
    {
      label: 'Multiple groups',
      value: multiGroupEmployees,
      context: 'In 2+ groups',
    },
  ];
  const groupMetrics: PeopleMetric[] = [
    {
      label: 'Total groups',
      value: groups.length,
      context: 'Available for campaigns',
    },
    {
      label: 'Group memberships',
      value: totalGroupMemberships,
      context: 'Total member assignments',
    },
    {
      label: 'Empty groups',
      value: emptyGroups,
      context: 'No assigned members',
    },
    {
      label: 'Largest group',
      value: largestGroup?.memberCount ?? 0,
      context:
        largestGroups.length > 0
          ? largestGroups.map((group) => group.name).join(', ')
          : `${averageMembersPerGroup} avg members`,
    },
  ];

  function handlePeopleTabChange(tab: PeopleTab) {
    setActivePeopleTab(tab);
    setSelectedEmployeeId(null);
    setSelectedGroupId(null);
    setGroupMemberMessage('');
    setSidePanelEmployeeId('');
  }

  function openEmployeeDrawer(employee: Employee) {
    setSelectedEmployeeId(employee.id);
  }

  function openGroupDrawer(group: Group) {
    setSelectedGroupId(group.id);
    setGroupMemberMessage('');
    setSidePanelEmployeeId('');
  }

  function handleInteractiveRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    action: () => void,
  ) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea')) {
      return;
    }
    event.preventDefault();
    action();
  }

  function handleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setEmployeePage(1);
  }

  function openAddGroupModal() {
    setEditingGroupId(null);
    setShouldRestoreGroupDrawer(false);
    setGroupForm(emptyGroupForm);
    setGroupFormMessage('');
    setGroupMemberMessage('');
    setGroupTab('groupManualPanel');
    setIsGroupsModalOpen(true);
  }

  function openEditGroupModal(group: Group) {
    setShouldRestoreGroupDrawer(selectedGroupId === group.id);
    setEditingGroupId(group.id);
    setGroupForm({ name: group.name, description: group.description });
    setGroupFormMessage('');
    setGroupMemberMessage('');
    setGroupTab('groupManualPanel');
    setIsGroupsModalOpen(true);
  }

  function closeGroupModal() {
    if (isSavingGroup || isImportingGroups) return;
    setIsGroupsModalOpen(false);
    if (!shouldRestoreGroupDrawer) setSelectedGroupId(null);
    setShouldRestoreGroupDrawer(false);
    setEditingGroupId(null);
    setGroupForm(emptyGroupForm);
    setGroupFormMessage('');
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
      if (!shouldRestoreGroupDrawer) setSelectedGroupId(null);
      setShouldRestoreGroupDrawer(false);
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
      setSidePanelEmployeeId('');
      setGroupMemberSearch('');
    } catch (error) {
      setGroupMemberMessage(
        error instanceof Error ? error.message : 'Employee could not be added to the group.',
      );
    } finally {
      setIsAddingGroupMember(false);
    }
  }

  function requestRemoveGroupMember(groupId: number, employeeId: number) {
    const group = groups.find((item) => item.id === groupId);
    const employee = employees.find((item) => item.id === employeeId);
    if (!group || !employee) return;
    setPendingMemberRemoval({
      groupId,
      groupName: group.name,
      employeeId,
      employeeName: employee.name,
    });
  }

  async function confirmRemoveGroupMember() {
    if (removingGroupMemberId !== null || pendingMemberRemoval === null) return;

    setRemovingGroupMemberId(pendingMemberRemoval.employeeId);
    setGroupMemberMessage('');
    try {
      await removeGroupMember(
        pendingMemberRemoval.groupId,
        pendingMemberRemoval.employeeId,
      );
      const people = await fetchPeople(new AbortController().signal);
      applyPeopleData(people);
      setSidePanelEmployeeId('');
      setGroupMemberSearch('');
      setPendingMemberRemoval(null);
    } catch (error) {
      setGroupMemberMessage(
        error instanceof Error
          ? error.message
          : 'Employee could not be removed from the group.',
      );
    } finally {
      setRemovingGroupMemberId(null);
    }
  }

  async function handleImportGroups() {
    if (isImportingGroups) return;
    if (groupImportFile === null) {
      setGroupImportMessage('Please choose an Excel file first.');
      setGroupImportErrors([]);
      return;
    }
    if (!isValidExcelFile(groupImportFile)) {
      setGroupImportMessage('Upload an .xlsx file.');
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
    setEmployeeFormErrors({});
    setEmployeeFormMessage('');
    setEmployeeImportFile(null);
    setEmployeeImportMessage('');
    setEmployeeImportErrors([]);
  }

  function openAddEmployeeModal() {
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeFormErrors({});
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
    setEmployeeFormErrors({});
    setEmployeeTab('manualPanel');
    setIsEmployeeModalOpen(true);
  }

  function updateEmployeeForm<K extends keyof EmployeeFormValues>(
    key: K,
    value: EmployeeFormValues[K],
  ) {
    setEmployeeForm((current) => ({ ...current, [key]: value }));
    setEmployeeFormMessage('');
    setEmployeeFormErrors((current) => ({ ...current, [key]: undefined }));
  }

  function updateEmployeeGroups(groupIds: number[]) {
    setEmployeeForm((current) => ({
      ...current,
      groupIds,
    }));
    setEmployeeFormMessage('');
  }

  async function handleCreateEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingEmployee) return;
    const validationErrors = validateEmployeeForm(employeeForm);
    setEmployeeFormErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setEmployeeFormMessage('Review the highlighted fields.');
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
      setEmployeeFormErrors({});
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
    if (!isValidExcelFile(employeeImportFile)) {
      setEmployeeImportMessage('Upload an .xlsx file.');
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
          <PeopleHeader
            activeTab={activePeopleTab}
            onAddEmployee={openAddEmployeeModal}
            onAddGroup={openAddGroupModal}
          />

          <PeopleTabs activeTab={activePeopleTab} onChange={handlePeopleTabChange} />

          <PeopleMetrics
            metrics={activePeopleTab === 'employees' ? employeeMetrics : groupMetrics}
            label={activePeopleTab === 'employees' ? 'Employee metrics' : 'Group metrics'}
          />

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
                  className={`btn btn-secondary${employeeFiltersActive ? '' : ' people-reset-subtle'}`}
                  type="button"
                  onClick={resetEmployeeFilters}
                  disabled={!employeeFiltersActive}
                >
                  Reset
                </button>
              </div>

              <div className="card table-card">
                <table className="table people-employee-table">
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
                          tabIndex={0}
                          aria-selected={selectedEmployee?.id === employee.id}
                          onClick={() => openEmployeeDrawer(employee)}
                          onKeyDown={(event) =>
                            handleInteractiveRowKeyDown(event, () => openEmployeeDrawer(employee))
                          }
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
                  className={`btn btn-secondary${groupFiltersActive ? '' : ' people-reset-subtle'}`}
                  type="button"
                  onClick={() => {
                    setGroupSearch('');
                    setGroupPage(1);
                  }}
                  disabled={!groupFiltersActive}
                >
                  Reset
                </button>
              </div>

              <div className="card table-card">
                <table className="table people-group-table">
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
                        <tr
                          key={group.id}
                          className={selectedGroup?.id === group.id ? 'people-selected-row' : ''}
                          tabIndex={0}
                          aria-selected={selectedGroup?.id === group.id}
                          onClick={() => openGroupDrawer(group)}
                          onKeyDown={(event) =>
                            handleInteractiveRowKeyDown(event, () => openGroupDrawer(group))
                          }
                        >
                          <td>
                            <button
                              className={`group-table-button${selectedGroup?.id === group.id ? ' active' : ''}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openGroupDrawer(group);
                              }}
                            >
                              {group.name}
                            </button>
                          </td>
                          <td className="people-muted-cell">
                            {isEmptyDescription(group.description) ? '—' : group.description}
                          </td>
                          <td className="people-count-cell">{group.memberCount}</td>
                          <td>
                            <button
                              className="link people-link-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditGroupModal(group);
                              }}
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

          </section>}
        </main>
      </AppLayout>

      <DetailDrawer
        isOpen={activePeopleTab === 'employees' && selectedEmployee !== null}
        title="Employee details"
        titleId="employeeDetailsTitle"
        onClose={() => setSelectedEmployeeId(null)}
      >
        {selectedEmployee && (
          <div className="people-detail-stack">
            <div className="person people-detail-person">
              <div className="mini">{getUserInitials(selectedEmployee.name)}</div>
              <div>
                <strong>{selectedEmployee.name}</strong>
                <span>{selectedEmployee.email}</span>
              </div>
            </div>

            <dl className="people-detail-list">
              <div>
                <dt>Role</dt>
                <dd>{selectedEmployee.role}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selectedEmployee.status}</dd>
              </div>
              <div>
                <dt>Groups</dt>
                <dd>
                  {selectedEmployee.groups.length > 0
                    ? selectedEmployee.groups.join(' · ')
                    : 'No group assigned'}
                </dd>
              </div>
            </dl>

            <button
              className="btn btn-secondary people-button people-drawer-action"
              type="button"
              onClick={() => openEditEmployeeModal(selectedEmployee)}
            >
              Edit employee
            </button>
          </div>
        )}
      </DetailDrawer>

      <DetailDrawer
        isOpen={activePeopleTab === 'groups' && selectedGroup !== null}
        title={selectedGroup?.name ?? 'Group details'}
        titleId="groupDetailsTitle"
        suspendFocusTrap={pendingMemberRemoval !== null}
        onClose={() => {
          setSelectedGroupId(null);
          setGroupMemberMessage('');
          setSidePanelEmployeeId('');
          setGroupMemberSearch('');
        }}
      >
        {selectedGroup && (
          <div className="people-detail-stack">
            <div className="people-group-summary">
              <span>Group details</span>
              <p>
                {isEmptyDescription(selectedGroup.description)
                  ? 'No description'
                  : selectedGroup.description}
              </p>
            </div>

            <section className="people-drawer-section">
              <div className="people-section-head">
                <h3>Members</h3>
                <span>
                  {members.length} employee{members.length === 1 ? '' : 's'}
                </span>
              </div>

              {members.length > 0 ? (
                <div className="people-member-list" id="groupPageMembers">
                  {members.map((employee) => (
                    <div className="people-member-row" key={employee.id}>
                      <div className="person">
                        <div className="mini">{getUserInitials(employee.name)}</div>
                        <div>
                          <strong>{employee.name}</strong>
                          <span>{employee.role}</span>
                        </div>
                      </div>
                      <button
                        className="link people-link-button people-remove-button"
                        type="button"
                        onClick={() => requestRemoveGroupMember(selectedGroup.id, employee.id)}
                        disabled={removingGroupMemberId === employee.id}
                        aria-label={`Remove ${employee.name} from ${selectedGroup.name}`}
                      >
                        {removingGroupMemberId === employee.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="people-empty-inline">No employees in this group yet.</div>
              )}
            </section>

            <section className="people-drawer-section people-member-add">
              <div>
                <strong>Add member</strong>
                <span>Select an employee who is not already in this group.</span>
              </div>
              <EmployeeCombobox
                employees={selectedGroupAvailableEmployees}
                selectedEmployeeId={sidePanelEmployeeId}
                search={groupMemberSearch}
                onSearchChange={setGroupMemberSearch}
                onSelect={(employeeId) => {
                  setSidePanelEmployeeId(employeeId);
                  setGroupMemberMessage('');
                }}
              />
              <button
                className="btn btn-primary people-button"
                type="button"
                onClick={() => handleAddGroupMember(selectedGroup.id, sidePanelEmployeeId)}
                disabled={isAddingGroupMember || sidePanelEmployeeId === ''}
              >
                {isAddingGroupMember ? 'Adding...' : 'Add to group'}
              </button>
              {groupMemberMessage !== '' && (
                <div className="people-form-message" aria-live="polite">
                  {groupMemberMessage}
                </div>
              )}
            </section>

            <button
              className="btn btn-secondary people-button people-drawer-action"
              type="button"
              onClick={() => openEditGroupModal(selectedGroup)}
            >
              Edit group details
            </button>
          </div>
        )}
      </DetailDrawer>

      {pendingMemberRemoval !== null && (
        <div className="modal-backdrop open" role="presentation">
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="removeMemberTitle"
          >
            <div className="modal-head">
              <div>
                <h2 id="removeMemberTitle">
                  Remove {pendingMemberRemoval.employeeName} from {pendingMemberRemoval.groupName}?
                </h2>
                <p>This employee will no longer belong to this group.</p>
              </div>
              <button
                className="close"
                type="button"
                onClick={() => setPendingMemberRemoval(null)}
                disabled={removingGroupMemberId !== null}
                aria-label="Cancel removal"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-actions">
                <button
                  className="btn btn-secondary people-button"
                  type="button"
                  onClick={() => setPendingMemberRemoval(null)}
                  disabled={removingGroupMemberId !== null}
                  autoFocus
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary people-button danger-action"
                  type="button"
                  onClick={confirmRemoveGroupMember}
                  disabled={removingGroupMemberId !== null}
                >
                  {removingGroupMemberId !== null ? 'Removing...' : 'Remove member'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <label className="form-label">Full name <span aria-hidden="true">*</span></label>
                  <input
                    className="form-control"
                    placeholder="e.g. Anna Molnár"
                    value={employeeForm.name}
                    onChange={(event) =>
                      updateEmployeeForm('name', event.target.value)
                    }
                    aria-invalid={employeeFormErrors.name ? true : undefined}
                  />
                  <FieldError message={employeeFormErrors.name} />
                </div>
                <div className="form-field field">
                  <label className="form-label">Role <span aria-hidden="true">*</span></label>
                  <input
                    className="form-control"
                    placeholder="e.g. Engineering Manager"
                    value={employeeForm.role}
                    onChange={(event) =>
                      updateEmployeeForm('role', event.target.value)
                    }
                    aria-invalid={employeeFormErrors.role ? true : undefined}
                  />
                  <FieldError message={employeeFormErrors.role} />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Email address <span aria-hidden="true">*</span></label>
                  <input
                    className="form-control"
                    type="email"
                    placeholder="anna.molnar@company.com"
                    value={employeeForm.email}
                    onChange={(event) =>
                      updateEmployeeForm('email', event.target.value)
                    }
                    aria-invalid={employeeFormErrors.email ? true : undefined}
                  />
                  <FieldError message={employeeFormErrors.email} />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Groups</label>
                  <GroupMultiSelect
                    groups={groups}
                    selectedGroupIds={employeeForm.groupIds}
                    onChange={updateEmployeeGroups}
                  />
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
              <ImportPanel
                title="Upload Excel file"
                description="Use an .xlsx file with columns: name, role, email, groups."
                file={employeeImportFile}
                message={employeeImportMessage}
                errors={employeeImportErrors}
                templateUrl={employeeTemplateUrl}
                templateName="upload_employee_empty_template.xlsx"
                uploadLabel="Upload employees"
                uploadingLabel="Uploading..."
                isUploading={isImportingEmployees}
                onFileChange={(file) => {
                  setEmployeeImportFile(file);
                  setEmployeeImportMessage('');
                  setEmployeeImportErrors([]);
                }}
                onUpload={handleImportEmployees}
              />
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
          className="modal group-modal"
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
                  ? 'Create a new group in your organization.'
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
                Manual entry
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
                <div className="form-grid group-form-grid">
                  <div className="form-field field full">
                    <label className="form-label">Group name <span aria-hidden="true">*</span></label>
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
                    <label className="form-label">Description <span className="optional-label">optional</span></label>
                    <textarea
                      className="form-control"
                      id="groupDescriptionInput"
                      placeholder="Describe the purpose of this group..."
                      value={groupForm.description}
                      onChange={(event) =>
                        updateGroupForm('description', event.target.value)
                      }
                    />
                  </div>
                </div>
                {groupFormMessage !== '' && (
                  <div className="people-form-message" aria-live="polite">{groupFormMessage}</div>
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
                        ? 'Create group'
                        : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
            {editingGroupId === null && <div
              className={`panel${groupTab === 'groupExcelPanel' ? ' active' : ''}`}
              id="groupExcelPanel"
            >
              <ImportPanel
                title="Import groups from Excel"
                description="Use the provided .xlsx template with Group Name and Group Description columns."
                file={groupImportFile}
                message={groupImportMessage}
                errors={groupImportErrors}
                templateUrl={groupTemplateUrl}
                templateName="upload_group_empty_template.xlsx"
                uploadLabel="Import groups"
                uploadingLabel="Importing..."
                isUploading={isImportingGroups}
                onFileChange={(file) => {
                  setGroupImportFile(file);
                  setGroupImportMessage('');
                  setGroupImportErrors([]);
                }}
                onUpload={handleImportGroups}
              />
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
