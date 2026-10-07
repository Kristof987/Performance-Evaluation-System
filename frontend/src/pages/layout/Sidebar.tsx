import { useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import {
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardPen,
  Compass,
  Files,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react';
import {
  formatUserName,
  getDashboardPath,
  getSidebarUser,
  getUserInitials,
  isHrOrManagerRole,
} from './sidebar-user';
export type SidebarPage = 'hr-home' | 'employee-home' | 'employee-review-preview' | 'people' | 'campaigns' | 'forms' | 'results';
type SidebarProps = {
  activePage: SidebarPage;
  isSidebarCollapsed: boolean;
  onToggle: () => void;
};
export default function Sidebar({
  activePage,
  isSidebarCollapsed,
  onToggle,
}: SidebarProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const hasDragged = useRef(false);
  const suppressNextClick = useRef(false);
  const sidebarUser = getSidebarUser();
  const sidebarUserName =
    sidebarUser === null ? 'User' : formatUserName(sidebarUser.username);
  const dashboardPath = getDashboardPath();
  const isDashboardActive = activePage === 'hr-home' || activePage === 'employee-home';
  const isHrOrManager = isHrOrManagerRole(sidebarUser?.role_name ?? null);

  function handleTogglePointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragStartX.current = event.clientX;
    hasDragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTogglePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartX.current === null) return;
    if (Math.abs(event.clientX - dragStartX.current) > 6) {
      hasDragged.current = true;
    }
  }

  function handleTogglePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartX.current === null) return;
    const deltaX = event.clientX - dragStartX.current;
    dragStartX.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!hasDragged.current) return;
    suppressNextClick.current = true;
    if (!isSidebarCollapsed && deltaX < -28) onToggle();
    if (isSidebarCollapsed && deltaX > 28) onToggle();
  }

  return (
    <aside className="sidebar">
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
        onPointerCancel={() => {
          dragStartX.current = null;
        }}
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
        {isHrOrManager ? (
          <>
            <Link
              className={activePage === 'people' ? 'nav-item active' : 'nav-item'}
              aria-current={activePage === 'people' ? 'page' : undefined}
              to="/people"
              style={{ textDecoration: 'none' }}
            >
              <Users size={17} />
              <span className="nav-item-label">People</span>
            </Link>
            <Link
              className={
                activePage === 'campaigns' ? 'nav-item active' : 'nav-item'
              }
              aria-current={activePage === 'campaigns' ? 'page' : undefined}
              to="/campaigns"
              style={{ textDecoration: 'none' }}
            >
              <ClipboardPen size={17} />
              <span className="nav-item-label">Campaigns</span>
            </Link>
            <Link
              className={activePage === 'forms' ? 'nav-item active' : 'nav-item'}
              aria-current={activePage === 'forms' ? 'page' : undefined}
              to="/forms"
              style={{ textDecoration: 'none' }}
            >
              <Files size={17} />
              <span className="nav-item-label">Forms</span>
            </Link>
            <div className="nav-item">
              <ChartNoAxesCombined size={17} />
              <span className="nav-item-label">Reports</span>
            </div>
            <div className="nav-item">
              <Settings size={17} />
              <span className="nav-item-label">Settings</span>
            </div>
          </>
        ) : (
          <Link
            className={activePage === 'results' ? 'nav-item active' : 'nav-item'}
            aria-current={activePage === 'results' ? 'page' : undefined}
            to="/results"
            style={{ textDecoration: 'none' }}
          >
            <ChartNoAxesCombined size={17} />
            <span className="nav-item-label">Results</span>
          </Link>
        )}
      </nav>

      <div className="sidebar-spacer" />

      <div className="user-menu">
        <div className="user-avatar">
          {sidebarUser?.profile_image_url ? (
            <img src={sidebarUser.profile_image_url} alt={sidebarUserName} />
          ) : (
            <div className="user-initials">
              {getUserInitials(sidebarUserName)}
            </div>
          )}
        </div>
        <div className="user-info">
          <div className="user-name">{sidebarUserName}</div>
          <div className="user-role">{sidebarUser?.role_name ?? 'Employee'}</div>
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
            <button type="button">Settings</button>
          </div>
        )}
      </div>
    </aside>
  );
}
