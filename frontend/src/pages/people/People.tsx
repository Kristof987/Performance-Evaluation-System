import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import AppLayout from '../layout/AppLayout';
import Pagination from '../../components/Pagination';
import {
  useEffect,
  useId,
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
import { parsePositiveInt, parseText, useUrlState } from '../../app/useUrlState';
import Avatar from '../../components/Avatar';
import InlineMessage from '../../components/feedback/InlineMessage';
import { useConfirm, useToast } from '../../components/feedback/feedback-context';
import {
  addGroupMember,
  createEmployee,
  createGroup,
  fetchPeople,
  importEmployees,
  importGroups,
  invitationErrorMessage,
  removeGroupMember,
  resendInvitation,
  updateEmployee,
  updateEmployeeSystemRole,
  deleteCompanyRole,
  fetchCompanyRoles,
  type CompanyRoleUsage,
  updateGroup,
  type Employee,
  type NamedOption,
  type EmployeeFormValues,
  type Group,
  type GroupFormValues,
} from './people.api';
import '../hr-home/hr-home.css';
import '../hr-home/components/MetricsGrid.css';
import './people.css';

type SortKey = 'name' | 'role' | 'groups' | 'status' | 'signIn';

const SORT_KEYS: SortKey[] = ['name', 'role', 'groups', 'status', 'signIn'];

function parseSort(raw: string): { key: SortKey; direction: 'asc' | 'desc' } | null {
  const [key, direction] = raw.split('-');
  return SORT_KEYS.includes(key as SortKey) && (direction === 'asc' || direction === 'desc')
    ? { key: key as SortKey, direction } : null;
}

const SIGN_IN_BADGES: Record<Employee['signIn'], string> = {
  'Signed in': 'badge-success', Invited: 'badge-primary', 'Invitation failed': 'badge-danger', 'Not invited': 'badge-neutral',
};

function SignInBadge({ employee }: { employee: Employee }) {
  return <span className={`badge ${SIGN_IN_BADGES[employee.signIn]} people-status`}>{employee.signIn}</span>;
}
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

const emptyEmployeeForm: EmployeeFormValues = {
  name: '',
  role: '',
  email: '',
  groupIds: [],
};
const emptyGroupForm: GroupFormValues = {
  name: '',
  description: '',
  leaderIds: [],
};
const NEW_ROLE = '__new__';
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

function PeopleHeader({
  activeTab,
  onAddEmployee,
  onAddGroup,
  canAddEmployee,
  canAddGroup,
  onManageRoles,
}: {
  activeTab: PeopleTab;
  onAddEmployee: () => void;
  onAddGroup: () => void;
  canAddEmployee: boolean;
  canAddGroup: boolean;
  onManageRoles?: () => void;
}) {
  return (
    <section className="people-header">
      <div>
        <h1>People</h1>
        <p>Manage employees and groups in your organization.</p>
      </div>
      <div className="people-header-actions">
        {activeTab === 'employees' && onManageRoles && <button
          className="btn btn-secondary people-button"
          type="button"
          onClick={onManageRoles}
        >
          Company roles
        </button>}
        {(activeTab === 'employees' ? canAddEmployee : canAddGroup) && <button
          className="btn btn-primary people-button"
          type="button"
          onClick={activeTab === 'employees' ? onAddEmployee : onAddGroup}
        >
          {activeTab === 'employees' ? 'Add employee' : 'Add group'}
        </button>}
      </div>
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
  children,
}: {
  isOpen: boolean;
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

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
  }, [isOpen]);

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

/** Searchable multi-select of named items; used for group membership and for group leaders. */
function GroupMultiSelect({
  groups,
  selectedGroupIds,
  onChange,
  noun = 'groups',
}: {
  groups: Array<{ id: number; name: string }>;
  selectedGroupIds: number[];
  onChange: (groupIds: number[]) => void;
  noun?: string;
}) {
  const optionsId = useId();
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
      <div className="group-selected-list" aria-label={`Selected ${noun}`}>
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
          <span className="group-empty-selection">No {noun} selected</span>
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
          placeholder={`Search and add ${noun}...`}
          aria-label={`Search ${noun}`}
          aria-expanded={isOpen}
          aria-controls={optionsId}
        />
        <button
          className="group-dropdown-toggle"
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-label={isOpen ? `Close ${noun} options` : `Open ${noun} options`}
          aria-expanded={isOpen}
        >
          ▾
        </button>
      </div>
      {isOpen && createPortal(
        <div
          className="group-option-list"
          id={optionsId}
          role="group"
          aria-label={`Available ${noun}`}
          ref={dropdownRef}
          style={dropdownStyle}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          {groups.length === 0 && <span>No {noun} available.</span>}
          {groups.length > 0 && filteredGroups.length === 0 && (
            <span>No {noun} match your search.</span>
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
        {file !== null && !isValidExcelFile(file) && message === '' && (
          <InlineMessage tone="error">Upload an .xlsx file.</InlineMessage>
        )}
      </div>
      {(message !== '' || errors.length > 0) && (
        <InlineMessage tone="error">
          {message !== '' && <p>{message}</p>}
          {errors.length > 0 && (
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </InlineMessage>
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
  const { state, retryAuth0, getAccessToken: getAccessTokenSilently } = useAppAuth();
  const auth0User = state.status === 'authenticated' ? state.user : null;
  const permissions = auth0User?.permissions ?? [];
  const canManageGroups = permissions.includes('groups.manage');
  const canManageEmployees = permissions.includes('employees.manage') && canManageGroups;
  const canAssignRoles = permissions.includes('roles.assign');
  const canImportEmployees = canManageEmployees && canAssignRoles;
  const currentUser = auth0User;
  const confirm = useConfirm();
  const toast = useToast();

  function handleAccessError(error: unknown) {
    if (error instanceof ApiAccessError) retryAuth0();
  }
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [companyRoles, setCompanyRoles] = useState<NamedOption[]>([]);
  const [systemRoles, setSystemRoles] = useState<NamedOption[]>([]);
  const [isNewCompanyRole, setIsNewCompanyRole] = useState(false);
  const [systemRoleDraft, setSystemRoleDraft] = useState<{ employeeId: number; roleId: number } | null>(null);
  const [systemRoleMessage, setSystemRoleMessage] = useState<{ employeeId: number; text: string } | null>(null);
  const [isSavingSystemRole, setIsSavingSystemRole] = useState(false);
  const [companyRoleUsage, setCompanyRoleUsage] = useState<CompanyRoleUsage[] | null>(null);
  const [isCompanyRolesOpen, setIsCompanyRolesOpen] = useState(false);
  const [companyRoleMessage, setCompanyRoleMessage] = useState('');
  const [removingCompanyRoleId, setRemovingCompanyRoleId] = useState<number | null>(null);
  const [isPeopleLoading, setIsPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState('');
  // Tab, filters, sorting, pages and the open drawer live in the URL, so links and refreshes keep the view.
  const urlState = useUrlState();
  const [activePeopleTab, setActivePeopleTab] = urlState.field<PeopleTab>({
    key: 'tab', defaultValue: 'employees', parse: (raw) => (raw === 'groups' ? 'groups' : null), push: true,
  });
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
  const [groupImportFile, setGroupImportFile] = useState<File | null>(null);
  const [groupImportMessage, setGroupImportMessage] = useState('');
  const [groupImportErrors, setGroupImportErrors] = useState<string[]>([]);
  const [isImportingGroups, setIsImportingGroups] = useState(false);
  const [sort, setSort] = urlState.field<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'sort', defaultValue: { key: 'name', direction: 'asc' }, parse: parseSort,
    serialize: (value) => `${value.key}-${value.direction}`,
  });
  const [employeePage, setEmployeePage] = urlState.field({ key: 'page', defaultValue: 1, parse: parsePositiveInt });
  const [groupPage, setGroupPage] = urlState.field({ key: 'group_page', defaultValue: 1, parse: parsePositiveInt });
  const [employeeSearch, setEmployeeSearch] = urlState.field({ key: 'q', defaultValue: '', parse: parseText });
  const [groupFilter, setGroupFilter] = urlState.field({ key: 'group', defaultValue: 'All groups', parse: parseText });
  const [statusFilter, setStatusFilter] = urlState.field({ key: 'status', defaultValue: 'All statuses', parse: parseText });
  const [groupSearch, setGroupSearch] = urlState.field({ key: 'group_q', defaultValue: '', parse: parseText });
  const [selectedGroupId, setSelectedGroupId] = urlState.field<number | null>({
    key: 'open_group', defaultValue: null, parse: parsePositiveInt,
    serialize: (value) => (value === null ? '' : String(value)), push: true,
  });
  const [selectedEmployeeId, setSelectedEmployeeId] = urlState.field<number | null>({
    key: 'open_employee', defaultValue: null, parse: parsePositiveInt,
    serialize: (value) => (value === null ? '' : String(value)), push: true,
  });
  const [invitationMessage, setInvitationMessage] = useState<{ employeeId: number; text: string } | null>(null);
  const [isSendingInvitation, setIsSendingInvitation] = useState(false);
  const editingEmployeeLinked = editingEmployeeId !== null
    && (employees.find((employee) => employee.id === editingEmployeeId)?.signInLinked ?? false);
  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedEmployee =
    employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedGroupLeaders = selectedGroup
    ? employees.filter((employee) => selectedGroup.leaderIds.includes(employee.id))
    : [];
  const leaderOptions = employees
    .filter((employee) => employee.status === 'Active' || groupForm.leaderIds.includes(employee.id))
    .map((employee) => ({ id: employee.id, name: employee.name }));
  const memberManagementGroup =
    selectedGroup ??
    (editingGroupId !== null
      ? groups.find((group) => group.id === editingGroupId) ?? null
      : null);

  /** Reloads the lists after a change that already succeeded; a failed reload must not look like a failed change. */
  async function refreshPeopleAfterChange(done: string) {
    try {
      applyPeopleData(await fetchPeople(getAccessTokenSilently, new AbortController().signal));
      return true;
    } catch (error) {
      handleAccessError(error);
      toast.warning(`${done}, but the list couldn’t refresh. Reload the page to see the latest data.`);
      return false;
    }
  }

  function applyPeopleData(people: { employees: Employee[]; groups: Group[]; companyRoles: NamedOption[]; systemRoles: NamedOption[] }) {
    setEmployees(people.employees);
    setGroups(people.groups);
    setCompanyRoles(people.companyRoles);
    setSystemRoles(people.systemRoles);
    setSelectedEmployeeId((current) =>
      current !== null && people.employees.some((employee) => employee.id === current)
        ? current
        : null,
    { replace: true });
    setSelectedGroupId((current) =>
      current !== null && people.groups.some((group) => group.id === current)
        ? current
        : null,
    { replace: true });
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchPeople(getAccessTokenSilently, controller.signal)
      .then((people) => {
        if (controller.signal.aborted) return;
        applyPeopleData(people);
      })
      .catch((error: unknown) => {
        handleAccessError(error);
        if (!controller.signal.aborted)
          setPeopleError(error instanceof ApiAccessError ? error.message : 'People data could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsPeopleLoading(false);
      });
    return () => controller.abort();
  }, [getAccessTokenSilently]);

  const filteredEmployees = employees.filter((employee) => {
    const search = employeeSearch.trim().toLowerCase();
    const matchesSearch = `${employee.name} ${employee.email} ${employee.role}`
      .toLowerCase()
      .includes(search);
    const matchesGroup =
      groupFilter === 'All groups' || employee.groups.includes(groupFilter);
    const matchesStatus =
      statusFilter === 'All statuses' || employee.status === statusFilter || employee.signIn === statusFilter;
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
    setGroupForm({
      name: group.name,
      description: isEmptyDescription(group.description) ? '' : group.description,
      leaderIds: group.leaderIds,
    });
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
    if (isSavingGroup || !canManageGroups) return;
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
        leaderIds: groupForm.leaderIds,
      };
      if (editingGroupId === null) {
        await createGroup(getAccessTokenSilently, payload);
      } else {
        await updateGroup(getAccessTokenSilently, editingGroupId, payload);
      }
      const done = `“${payload.name}” ${editingGroupId === null ? 'created' : 'saved'}`;
      if (await refreshPeopleAfterChange(done)) toast.success(done);
      setGroupPage(1);
      setIsGroupsModalOpen(false);
      if (!shouldRestoreGroupDrawer) setSelectedGroupId(null);
      setShouldRestoreGroupDrawer(false);
      setEditingGroupId(null);
      setGroupForm(emptyGroupForm);
    } catch (error) {
      handleAccessError(error);
      setGroupFormMessage(
        error instanceof Error ? error.message : 'Group could not be saved.',
      );
    } finally {
      setIsSavingGroup(false);
    }
  }

  async function handleAddGroupMember(groupId: number, employeeId: string) {
    if (isAddingGroupMember || !canManageGroups) return;
    if (employeeId === '') {
      setGroupMemberMessage('Select an employee first.');
      return;
    }

    setIsAddingGroupMember(true);
    setGroupMemberMessage('');
    try {
      await addGroupMember(getAccessTokenSilently, groupId, Number(employeeId));
      const employeeName = employees.find((item) => item.id === Number(employeeId))?.name ?? 'Employee';
      const groupName = groups.find((item) => item.id === groupId)?.name ?? 'the group';
      const done = `${employeeName} added to ${groupName}`;
      if (await refreshPeopleAfterChange(done)) toast.success(done);
      setSidePanelEmployeeId('');
      setGroupMemberSearch('');
    } catch (error) {
      handleAccessError(error);
      setGroupMemberMessage(
        error instanceof Error ? error.message : 'Employee could not be added to the group.',
      );
    } finally {
      setIsAddingGroupMember(false);
    }
  }

  async function requestRemoveGroupMember(groupId: number, employeeId: number) {
    if (removingGroupMemberId !== null || !canManageGroups) return;
    const group = groups.find((item) => item.id === groupId);
    const employee = employees.find((item) => item.id === employeeId);
    if (!group || !employee) return;
    const confirmed = await confirm({
      title: `Remove ${employee.name} from ${group.name}?`,
      message: 'They will no longer belong to this group. Campaigns that were already issued are not affected.',
      confirmLabel: 'Remove member',
      tone: 'danger',
    });
    if (!confirmed) return;

    setRemovingGroupMemberId(employeeId);
    setGroupMemberMessage('');
    try {
      await removeGroupMember(getAccessTokenSilently, groupId, employeeId);
      const done = `${employee.name} removed from ${group.name}`;
      if (await refreshPeopleAfterChange(done)) toast.success(done);
      setSidePanelEmployeeId('');
      setGroupMemberSearch('');
    } catch (error) {
      handleAccessError(error);
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
    if (isImportingGroups || !canManageGroups) return;
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
      const result = await importGroups(getAccessTokenSilently, groupImportFile);
      if (result.errors.length > 0) {
        setGroupImportErrors(result.errors);
        setGroupImportMessage('Groups were not imported. Fix the errors below and upload again.');
        return;
      }
      const done = `${result.createdCount} group${result.createdCount === 1 ? '' : 's'} imported`;
      if (await refreshPeopleAfterChange(done)) toast.success(done);
      setGroupImportFile(null);
      setGroupPage(1);
      setIsGroupsModalOpen(false);
      if (!shouldRestoreGroupDrawer) setSelectedGroupId(null);
      setShouldRestoreGroupDrawer(false);
      setEditingGroupId(null);
    } catch (error) {
      handleAccessError(error);
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
    setIsNewCompanyRole(false);
    setEmployeeFormErrors({});
    setEmployeeFormMessage('');
    setEmployeeImportFile(null);
    setEmployeeImportMessage('');
    setEmployeeImportErrors([]);
  }

  function openAddEmployeeModal() {
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployeeForm);
    setIsNewCompanyRole(false);
    setEmployeeFormErrors({});
    setEmployeeFormMessage('');
    setEmployeeTab('manualPanel');
    setIsEmployeeModalOpen(true);
  }

  function openEditEmployeeModal(employee: Employee) {
    setEditingEmployeeId(employee.id);
    setIsNewCompanyRole(false);
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
    if (isSavingEmployee || !canManageEmployees) return;
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
      let done = `${payload.name} saved`;
      let warning = '';
      if (editingEmployeeId === null) {
        const created = await createEmployee(getAccessTokenSilently, payload);
        done = `${created.name} created and invited to sign in`;
        if (created.signIn === 'Invitation failed') {
          warning = `${created.name} was created, but the invitation wasn’t sent: ${invitationErrorMessage(created.invitationError)} You can resend it from their details.`;
        } else if (created.signIn !== 'Invited') {
          warning = `${created.name} was created. Sign-in invitations aren’t configured, so no email was sent.`;
        }
      } else {
        await updateEmployee(getAccessTokenSilently, editingEmployeeId, payload);
      }
      const refreshed = await refreshPeopleAfterChange(warning ? `${payload.name} created` : done);
      if (warning) toast.warning(warning);
      else if (refreshed) toast.success(done);
      setEmployeePage(1);
      setEditingEmployeeId(null);
      setEmployeeForm(emptyEmployeeForm);
      setIsNewCompanyRole(false);
      setEmployeeFormErrors({});
      setIsEmployeeModalOpen(false);
    } catch (error) {
      handleAccessError(error);
      setEmployeeFormMessage(
        error instanceof Error ? error.message : 'Employee could not be saved.',
      );
    } finally {
      setIsSavingEmployee(false);
    }
  }

  function applyCompanyRoleUsage(usage: CompanyRoleUsage[]) {
    setCompanyRoleUsage(usage);
    setCompanyRoles(usage.filter((role) => !role.archived).map((role) => ({ id: role.id, name: role.name })));
  }

  async function openCompanyRoles() {
    setIsCompanyRolesOpen(true);
    setCompanyRoleMessage('');
    setCompanyRoleUsage(null);
    try {
      applyCompanyRoleUsage(await fetchCompanyRoles(getAccessTokenSilently));
    } catch (error) {
      handleAccessError(error);
      setCompanyRoleMessage(error instanceof Error ? error.message : 'Company roles could not be loaded.');
    }
  }

  async function handleRemoveCompanyRole(role: CompanyRoleUsage) {
    if (removingCompanyRoleId !== null) return;
    const archive = role.used_in_campaigns;
    const confirmed = await confirm(archive ? {
      title: `Archive “${role.name}”?`,
      message: 'Past campaigns refer to this role, so it is archived instead of deleted: it disappears from the role list, but earlier reports keep showing it.',
      confirmLabel: 'Archive role',
    } : {
      title: `Delete “${role.name}”?`,
      message: 'No employee or campaign uses this role. It will be deleted permanently.',
      confirmLabel: 'Delete role',
      tone: 'danger',
    });
    if (!confirmed) return;
    setRemovingCompanyRoleId(role.id);
    setCompanyRoleMessage('');
    try {
      applyCompanyRoleUsage(await deleteCompanyRole(getAccessTokenSilently, role.id));
      toast.success(archive ? `“${role.name}” archived` : `“${role.name}” deleted`);
    } catch (error) {
      handleAccessError(error);
      setCompanyRoleMessage(error instanceof Error ? error.message : 'The company role could not be removed.');
    } finally {
      setRemovingCompanyRoleId(null);
    }
  }

  async function handleSaveSystemRole(employee: Employee, roleId: number) {
    if (isSavingSystemRole || !canAssignRoles) return;
    const nextRole = systemRoles.find((role) => role.id === roleId)?.name ?? 'the selected role';
    const confirmed = await confirm({
      title: `Change ${employee.name}’s system role to ${nextRole}?`,
      message: `This changes what ${employee.name} can see and do in PerfEval, from ${employee.systemRole ?? 'their current role'} to ${nextRole}. It applies the next time they load a page.`,
      confirmLabel: 'Change role',
    });
    if (!confirmed) return;
    setIsSavingSystemRole(true);
    setSystemRoleMessage(null);
    try {
      const role = await updateEmployeeSystemRole(getAccessTokenSilently, employee.id, roleId);
      setEmployees((current) => current.map((item) => item.id === employee.id
        ? { ...item, systemRoleId: role.id, systemRole: role.name } : item));
      setSystemRoleDraft(null);
      toast.success(`${employee.name}’s system role changed to ${role.name}`);
    } catch (error) {
      handleAccessError(error);
      setSystemRoleMessage({ employeeId: employee.id,
        text: error instanceof Error ? error.message : 'The system role could not be changed.' });
    } finally {
      setIsSavingSystemRole(false);
    }
  }

  async function handleSendInvitation(employee: Employee) {
    if (isSendingInvitation || !canManageEmployees) return;
    setIsSendingInvitation(true);
    setInvitationMessage(null);
    try {
      const updated = await resendInvitation(getAccessTokenSilently, employee.id);
      setEmployees((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (updated.signIn === 'Invited') toast.success(`Invitation sent to ${updated.email}`);
      else setInvitationMessage({ employeeId: employee.id, text: invitationErrorMessage(updated.invitationError) });
    } catch (error) {
      handleAccessError(error);
      setInvitationMessage({ employeeId: employee.id,
        text: error instanceof Error ? error.message : 'The invitation could not be sent.' });
    } finally {
      setIsSendingInvitation(false);
    }
  }

  async function handleImportEmployees() {
    if (isImportingEmployees || !canImportEmployees) return;
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
      const result = await importEmployees(getAccessTokenSilently, employeeImportFile);
      if (result.errors.length > 0) {
        setEmployeeImportErrors(result.errors);
        setEmployeeImportMessage('Employees were not imported. Fix the errors below and upload again.');
        return;
      }
      const failed = result.invitationErrors.length;
      const done = `${result.createdCount} employee${result.createdCount === 1 ? '' : 's'} imported`;
      const refreshed = await refreshPeopleAfterChange(done);
      if (failed) {
        toast.warning(`${done}, but ${failed} invitation${failed === 1 ? '' : 's'} couldn’t be sent. You can resend them from each employee’s details.`);
      } else if (refreshed) {
        toast.success(`${done}, ${result.invitationsSent} invitation${result.invitationsSent === 1 ? '' : 's'} sent`);
      }
      setEmployeeImportFile(null);
      setEmployeePage(1);
      setIsEmployeeModalOpen(false);
      setEditingEmployeeId(null);
    } catch (error) {
      handleAccessError(error);
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
            canAddEmployee={canManageEmployees}
            canAddGroup={canManageGroups}
            onManageRoles={canManageEmployees ? () => void openCompanyRoles() : undefined}
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
                  <optgroup label="Employment">
                    <option>Active</option>
                    <option>Inactive</option>
                  </optgroup>
                  <optgroup label="Sign-in">
                    <option>Signed in</option>
                    <option>Invited</option>
                    <option>Invitation failed</option>
                    <option>Not invited</option>
                  </optgroup>
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
                      <th>
                        <button
                          className={
                            sort.key === 'signIn'
                              ? `active${sort.direction === 'asc' ? ' asc' : ''}`
                              : ''
                          }
                          type="button"
                          onClick={() => handleSort('signIn')}
                        >
                          Sign-in
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
                              <Avatar className="mini" name={employee.name} photo={employee.photo} />
                              <div>
                                <div className="people-person-name"><strong>{employee.name}</strong>{currentUser !== null && ((employee.id === currentUser.employee.id) || (employee.userId !== null && employee.userId === currentUser.id)) && <span className="badge badge-neutral people-you-badge">You</span>}</div>
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
                            <SignInBadge employee={employee} />
                          </td>
                          <td>
                            {canManageEmployees &&
                            <button
                              className="link people-link-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditEmployeeModal(employee);
                              }}
                            >
                              Edit
                            </button>}
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
                            {canManageGroups && <button
                              className="link people-link-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditGroupModal(group);
                              }}
                            >
                              Edit
                            </button>}
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
              <Avatar className="mini" name={selectedEmployee.name} photo={selectedEmployee.photo} />
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
                <dt>System role</dt>
                <dd>
                  {canAssignRoles && selectedEmployee.userId !== null && selectedEmployee.systemRoleId !== null
                    && selectedEmployee.id !== auth0User?.employee.id ? (
                    <div className="people-system-role">
                      <select
                        className="form-control"
                        aria-label={`System role of ${selectedEmployee.name}`}
                        value={systemRoleDraft?.employeeId === selectedEmployee.id ? systemRoleDraft.roleId : selectedEmployee.systemRoleId}
                        disabled={isSavingSystemRole}
                        onChange={(event) => {
                          setSystemRoleMessage(null);
                          setSystemRoleDraft({ employeeId: selectedEmployee.id, roleId: Number(event.target.value) });
                        }}
                      >
                        {systemRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                      </select>
                      {systemRoleDraft?.employeeId === selectedEmployee.id && systemRoleDraft.roleId !== selectedEmployee.systemRoleId && (
                        <button
                          className="btn btn-primary people-button"
                          type="button"
                          disabled={isSavingSystemRole}
                          onClick={() => void handleSaveSystemRole(selectedEmployee, systemRoleDraft.roleId)}
                        >
                          {isSavingSystemRole ? 'Saving...' : 'Save'}
                        </button>
                      )}
                    </div>
                  ) : (
                    selectedEmployee.systemRole ?? '—'
                  )}
                  {systemRoleMessage?.employeeId === selectedEmployee.id && (
                    <InlineMessage tone="error" className="people-inline-message" onDismiss={() => setSystemRoleMessage(null)}>{systemRoleMessage.text}</InlineMessage>
                  )}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selectedEmployee.status}</dd>
              </div>
              <div>
                <dt>Sign-in</dt>
                <dd>
                  <SignInBadge employee={selectedEmployee} />
                  {selectedEmployee.signIn === 'Invited' && selectedEmployee.invitationSentAt && (
                    <small className="people-signin-detail">
                      Invitation sent {new Date(selectedEmployee.invitationSentAt).toLocaleString()}
                    </small>
                  )}
                  {selectedEmployee.signIn === 'Invitation failed' && (
                    <small className="people-signin-detail">{invitationErrorMessage(selectedEmployee.invitationError)}</small>
                  )}
                </dd>
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

            {canManageEmployees && <button
              className="btn btn-secondary people-button people-drawer-action"
              type="button"
              onClick={() => openEditEmployeeModal(selectedEmployee)}
            >
              Edit employee
            </button>}
            {canManageEmployees && selectedEmployee.status === 'Active' && selectedEmployee.signIn !== 'Signed in' && <button
              className="btn btn-secondary people-button people-drawer-action"
              type="button"
              disabled={isSendingInvitation}
              onClick={() => void handleSendInvitation(selectedEmployee)}
            >
              {isSendingInvitation ? 'Sending...' : selectedEmployee.signIn === 'Not invited' ? 'Send invitation' : 'Resend invitation'}
            </button>}
            {invitationMessage?.employeeId === selectedEmployee.id && (
              <InlineMessage tone="error" className="people-inline-message" onDismiss={() => setInvitationMessage(null)}>{invitationMessage.text}</InlineMessage>
            )}
          </div>
        )}
      </DetailDrawer>

      <DetailDrawer
        isOpen={activePeopleTab === 'groups' && selectedGroup !== null}
        title={selectedGroup?.name ?? 'Group details'}
        titleId="groupDetailsTitle"
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
                <h3>Leaders</h3>
                <span>See this group's reports</span>
              </div>
              {selectedGroupLeaders.length > 0 ? (
                <div className="people-member-list">
                  {selectedGroupLeaders.map((employee) => (
                    <div className="people-member-row" key={employee.id}>
                      <div className="person">
                        <Avatar className="mini" name={employee.name} photo={employee.photo} />
                        <div>
                          <strong>{employee.name}</strong>
                          <span>{employee.role}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="people-empty-inline">No leader assigned.</div>
              )}
            </section>

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
                        <Avatar className="mini" name={employee.name} photo={employee.photo} />
                        <div>
                          <strong>{employee.name}</strong>
                          <span>{employee.role}</span>
                        </div>
                      </div>
                      {canManageGroups && <button
                        className="link people-link-button people-remove-button"
                        type="button"
                        onClick={() => requestRemoveGroupMember(selectedGroup.id, employee.id)}
                        disabled={removingGroupMemberId === employee.id}
                        aria-label={`Remove ${employee.name} from ${selectedGroup.name}`}
                      >
                        {removingGroupMemberId === employee.id ? 'Removing...' : 'Remove'}
                      </button>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="people-empty-inline">No employees in this group yet.</div>
              )}
            </section>

            {canManageGroups && <section className="people-drawer-section people-member-add">
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
                <InlineMessage tone="error">{groupMemberMessage}</InlineMessage>
              )}
            </section>}

            {canManageGroups && <button
              className="btn btn-secondary people-button people-drawer-action"
              type="button"
              onClick={() => openEditGroupModal(selectedGroup)}
            >
              Edit group details
            </button>}
          </div>
        )}
      </DetailDrawer>

      {isCompanyRolesOpen && (
        <div className="modal-backdrop open" role="presentation"
          onClick={(event) => { if (event.target === event.currentTarget) setIsCompanyRolesOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="companyRolesTitle">
            <div className="modal-head">
              <div>
                <h2 id="companyRolesTitle">Company roles</h2>
                <p>A role in use by employees cannot be removed. Roles that past campaigns refer to are archived, so their reports keep the name.</p>
              </div>
              <button className="close" type="button" onClick={() => setIsCompanyRolesOpen(false)} aria-label="Close company roles">×</button>
            </div>
            <div className="modal-body">
              {companyRoleMessage !== '' && <InlineMessage tone="error" className="people-inline-message">{companyRoleMessage}</InlineMessage>}
              {companyRoleUsage === null && companyRoleMessage === '' && <p className="people-empty-inline">Loading…</p>}
              {companyRoleUsage !== null && companyRoleUsage.filter((role) => !role.archived).length === 0 && <p className="people-empty-inline">No company roles yet.</p>}
              {companyRoleUsage !== null && <ul className="people-role-list">
                {companyRoleUsage.filter((role) => !role.archived).map((role) => (
                  <li key={role.id}>
                    <div>
                      <strong>{role.name}</strong>
                      <span>{role.employee_count} {role.employee_count === 1 ? 'employee' : 'employees'}{role.used_in_campaigns ? ' · used in campaigns' : ''}</span>
                    </div>
                    <button className="btn btn-secondary people-button danger-action" type="button"
                      disabled={role.employee_count > 0 || removingCompanyRoleId !== null}
                      title={role.employee_count > 0 ? 'Move its employees to another role first.' : undefined}
                      onClick={() => void handleRemoveCompanyRole(role)}>
                      {removingCompanyRoleId === role.id ? 'Removing...' : role.used_in_campaigns ? 'Archive' : 'Delete'}
                    </button>
                  </li>
                ))}
              </ul>}
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
                {canImportEmployees && <button
                  className={`add-tab${employeeTab === 'excelPanel' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setEmployeeTab('excelPanel')}
                >
                  Excel upload
                </button>}
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
                  <label className="form-label" htmlFor="employeeRoleSelect">Role <span aria-hidden="true">*</span></label>
                  {companyRoles.length > 0 && (
                    <select
                      className="form-control"
                      id="employeeRoleSelect"
                      value={isNewCompanyRole ? NEW_ROLE : employeeForm.role}
                      onChange={(event) => {
                        const creating = event.target.value === NEW_ROLE;
                        setIsNewCompanyRole(creating);
                        updateEmployeeForm('role', creating ? '' : event.target.value);
                      }}
                      aria-invalid={employeeFormErrors.role && !isNewCompanyRole ? true : undefined}
                    >
                      <option value="" disabled>Choose a role…</option>
                      {employeeForm.role !== '' && !isNewCompanyRole
                        && !companyRoles.some((role) => role.name === employeeForm.role)
                        && <option value={employeeForm.role}>{employeeForm.role}</option>}
                      {companyRoles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
                      <option value={NEW_ROLE}>+ New role…</option>
                    </select>
                  )}
                  {(isNewCompanyRole || companyRoles.length === 0) && (
                    <input
                      className="form-control people-new-role-input"
                      id={companyRoles.length === 0 ? 'employeeRoleSelect' : undefined}
                      placeholder="e.g. Engineering Manager"
                      aria-label="New role name"
                      autoFocus={isNewCompanyRole}
                      value={employeeForm.role}
                      onChange={(event) =>
                        updateEmployeeForm('role', event.target.value)
                      }
                      aria-invalid={employeeFormErrors.role ? true : undefined}
                    />
                  )}
                  <FieldError message={employeeFormErrors.role} />
                </div>
                <div className="form-field field full">
                  <label className="form-label">Email address <span aria-hidden="true">*</span></label>
                  <input
                    className="form-control"
                    type="email"
                    placeholder="anna.molnar@company.com"
                    value={employeeForm.email}
                    disabled={editingEmployeeLinked}
                    aria-describedby={editingEmployeeLinked ? 'employee-email-locked' : undefined}
                    onChange={(event) =>
                      updateEmployeeForm('email', event.target.value)
                    }
                    aria-invalid={employeeFormErrors.email ? true : undefined}
                  />
                  {editingEmployeeLinked && <small id="employee-email-locked" className="people-field-note">
                    The email cannot be changed after the sign-in account is created.</small>}
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
                <InlineMessage tone="error">{employeeFormMessage}</InlineMessage>
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
            {editingEmployeeId === null && canImportEmployees && <div
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
                  <div className="form-field field full">
                    <label className="form-label">Leaders <span className="optional-label">optional</span></label>
                    <GroupMultiSelect
                      groups={leaderOptions}
                      selectedGroupIds={groupForm.leaderIds}
                      onChange={(leaderIds) => updateGroupForm('leaderIds', leaderIds)}
                      noun="leaders"
                    />
                    <small className="people-field-note">Leaders see this group's reports, even if they are not members.</small>
                  </div>
                </div>
                {groupFormMessage !== '' && (
                  <InlineMessage tone="error">{groupFormMessage}</InlineMessage>
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
