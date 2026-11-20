import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useNavigate } from 'react-router';
import { mediaUrl } from '../../config';
import { useProfilePhoto } from '../settings/profile-photo-store';
import {
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardPen,
  ClipboardCheck,
  Compass,
  Files,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
} from 'lucide-react';
import {
  getUserDisplayName,
  getDashboardPath,
  getAuthenticatedDashboardPath,
  getSidebarUser,
  getUserInitials,
} from './sidebar-user';
import { useAppAuth } from '../../auth/AppAuth';
import { ACCESS, hasAccess, hasTeamReportsOnly, type AccessRule } from '../../app/access';

export type SidebarPage =
  | 'hr-home'
  | 'my-evaluations'
  | 'employee-home'
  | 'people'
  | 'campaigns'
  | 'forms'
  | 'reports'
  | 'settings';

type SidebarProps = {
  activePage: SidebarPage;
  isSidebarCollapsed: boolean;
  onToggle: () => void;
};

const MIN_WIDTH = 74;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 234;
const COLLAPSE_THRESHOLD = 140;
const DRAG_START_DISTANCE = 6;

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

export default function Sidebar({
  activePage,
  isSidebarCollapsed,
  onToggle,
}: SidebarProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [expandedWidth, setExpandedWidth] = useState(DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef(DEFAULT_WIDTH);
  const hasDragged = useRef(false);
  const suppressNextClick = useRef(false);

  const { state, signOut } = useAppAuth();
  const auth0User = state.status === 'authenticated' ? state.user : null;
  const sidebarUser = auth0User ? null : getSidebarUser();
  const navigate = useNavigate();
  const location = useLocation();
  const reportCampaignId = /^\/reports\/campaigns\/(\d+)/.exec(location.pathname)?.[1];
  const reportBase = reportCampaignId ? `/reports/campaigns/${reportCampaignId}` : '/reports';
  const teamReportsOnly = hasTeamReportsOnly(auth0User?.permissions ?? []);
  const sidebarPhoto = mediaUrl(useProfilePhoto(auth0User?.employee.id,
    auth0User ? auth0User.employee.profile_image_url : sidebarUser?.profile_image_url));
  const sidebarUserName = auth0User?.employee.full_name ?? (
    sidebarUser === null ? 'User' : getUserDisplayName(sidebarUser));
  const dashboardPath = auth0User
    ? getAuthenticatedDashboardPath(auth0User.permissions)
    : getDashboardPath();
  const isDashboardActive =
    activePage === 'hr-home' || activePage === 'employee-home';
  const can = (rule: AccessRule) => hasAccess(auth0User?.permissions ?? [], rule);

  const currentWidth =
    dragWidth ?? (isSidebarCollapsed ? MIN_WIDTH : expandedWidth);

  function handleLogout() {
    signOut();
    if (!auth0User) navigate('/', { replace: true });
  }

  function handleTogglePointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragStartX.current = event.clientX;
    dragStartWidth.current = isSidebarCollapsed ? MIN_WIDTH : expandedWidth;
    hasDragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTogglePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartX.current === null) return;
    const deltaX = event.clientX - dragStartX.current;

    if (!hasDragged.current && Math.abs(deltaX) > DRAG_START_DISTANCE) {
      hasDragged.current = true;
    }
    if (hasDragged.current) {
      setDragWidth(clampWidth(dragStartWidth.current + deltaX));
    }
  }

  function handleTogglePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartX.current === null) return;
    const finalWidth = clampWidth(
      dragStartWidth.current + (event.clientX - dragStartX.current),
    );
    dragStartX.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragWidth(null);

    if (!hasDragged.current) return;
    suppressNextClick.current = true;

    if (finalWidth < COLLAPSE_THRESHOLD) {
      if (!isSidebarCollapsed) onToggle();
    } else {
      setExpandedWidth(finalWidth);
      if (isSidebarCollapsed) onToggle();
    }
  }

  function handleTogglePointerCancel() {
    dragStartX.current = null;
    hasDragged.current = false;
    setDragWidth(null);
  }

  return (
    <div
      className={dragWidth !== null ? 'sidebar-slot is-dragging' : 'sidebar-slot'}
      style={{ '--sidebar-width': `${currentWidth}px` } as CSSProperties}
    >
    <aside
      className={dragWidth !== null ? 'sidebar is-dragging' : 'sidebar'}
    >
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={isSidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
        aria-expanded={!isSidebarCollapsed}
        title="Drag or click to resize sidebar"
        onClick={(event) => {
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            event.preventDefault();
            return;
          }
          onToggle();
        }}
        onPointerDown={handleTogglePointerDown}
        onPointerMove={handleTogglePointerMove}
        onPointerUp={handleTogglePointerUp}
        onPointerCancel={handleTogglePointerCancel}
      >
        <span />
      </button>

      <div className="company">
        <div className="logo">
          <Compass size={17} />
        </div>
        <div className="company-name">Compass</div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <Link
          className={isDashboardActive ? 'nav-item active' : 'nav-item'}
          aria-current={isDashboardActive ? 'page' : undefined}
          to={dashboardPath}
          style={{ textDecoration: 'none' }}
        >
          <LayoutDashboard size={17} />
          <span className="nav-item-label">Dashboard</span>
        </Link>
        {can(ACCESS.evaluations) && <Link
          className={activePage === 'my-evaluations' ? 'nav-item active' : 'nav-item'}
          aria-current={activePage === 'my-evaluations' ? 'page' : undefined}
          to="/my-evaluations"
          style={{ textDecoration: 'none' }}
        >
          <ClipboardCheck size={17} />
          <span className="nav-item-label">My Evaluations</span>
        </Link>}
        {can(ACCESS.people) && <Link
          className={activePage === 'people' ? 'nav-item active' : 'nav-item'}
          aria-current={activePage === 'people' ? 'page' : undefined}
          to="/people"
          style={{ textDecoration: 'none' }}
        >
          <Users size={17} />
          <span className="nav-item-label">People</span>
        </Link>}
        {can(ACCESS.campaigns) && <Link
          className={
            activePage === 'campaigns' ? 'nav-item active' : 'nav-item'
          }
          aria-current={activePage === 'campaigns' ? 'page' : undefined}
          to="/campaigns"
          style={{ textDecoration: 'none' }}
        >
          <ClipboardPen size={17} />
          <span className="nav-item-label">Campaigns</span>
        </Link>}
        {can(ACCESS.forms) && <Link
          className={activePage === 'forms' ? 'nav-item active' : 'nav-item'}
          aria-current={activePage === 'forms' ? 'page' : undefined}
          to="/forms"
          style={{ textDecoration: 'none' }}
        >
          <Files size={17} />
          <span className="nav-item-label">Forms</span>
        </Link>}
        {can(ACCESS.reports) && <Link
          className={activePage === 'reports' ? 'nav-item active' : 'nav-item'}
          aria-current={activePage === 'reports' ? 'page' : undefined}
          to="/reports"
          style={{ textDecoration: 'none' }}
        >
          <ChartNoAxesCombined size={17} />
          <span className="nav-item-label">Reports</span>
        </Link>}
        {activePage === 'reports' && reportCampaignId && !isSidebarCollapsed && teamReportsOnly && <div className="sidebar-report-links" aria-label="Reports pages">
          <NavLink end to={reportBase}>Overview</NavLink>
          <NavLink to={`${reportBase}/employees`}>Employees</NavLink>
        </div>}
        {activePage === 'reports' && reportCampaignId && !isSidebarCollapsed && !teamReportsOnly && <div className="sidebar-report-links" aria-label="Reports pages">
          <NavLink end to={reportBase}>Overview</NavLink>
          <NavLink to={`${reportBase}/employees`}>Employees</NavLink>
          {(auth0User?.permissions ?? []).includes('campaigns.manage') && <NavLink to={`${reportBase}/answers`}>All Answers</NavLink>}
          <NavLink to={`${reportBase}/ai-analysis`}>AI Analysis</NavLink>
        </div>}
        {can(ACCESS.settings) && <Link
          className={activePage === 'settings' ? 'nav-item active' : 'nav-item'}
          aria-current={activePage === 'settings' ? 'page' : undefined}
          to="/settings/profile"
          style={{ textDecoration: 'none' }}
        >
          <Settings size={17} />
          <span className="nav-item-label">Settings</span>
        </Link>}
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item sidebar-logout" type="button" onClick={handleLogout}>
          <LogOut size={17} />
          <span className="nav-item-label">Log out</span>
        </button>

        <div className="user-menu">
          <div className="user-avatar">
            {sidebarPhoto ? (
              <img src={sidebarPhoto} alt={sidebarUserName} />
            ) : (
              <div className="user-initials">
                {getUserInitials(sidebarUserName)}
              </div>
            )}
          </div>
          <div className="user-info">
            <div className="user-name">{sidebarUserName}</div>
            <div className="user-role">{auth0User?.system_role_name ?? sidebarUser?.role_name ?? 'Employee'}</div>
          </div>
          <button
            className="user-menu-toggle"
            type="button"
            aria-label="Open user menu"
            aria-expanded={isUserMenuOpen}
            onClick={() => setIsUserMenuOpen((current) => !current)}
          >
            <ChevronDown size={15} color="#8B91A8" />
          </button>
          {isUserMenuOpen && (
            <div className="user-settings-menu open">
              <Link to="/settings/profile">Settings</Link>
            </div>
          )}
        </div>
      </div>
    </aside>
    </div>
  );
}
