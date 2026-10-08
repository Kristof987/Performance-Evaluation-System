import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
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

export type SidebarPage =
  | 'hr-home'
  | 'employee-home'
  | 'employee-review-preview'
  | 'people'
  | 'campaigns'
  | 'forms'
  | 'results';

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

  const sidebarUser = getSidebarUser();
  const sidebarUserName =
    sidebarUser === null ? 'User' : formatUserName(sidebarUser.username);
  const dashboardPath = getDashboardPath();
  const isDashboardActive =
    activePage === 'hr-home' || activePage === 'employee-home';
  const isHrOrManager = isHrOrManagerRole(sidebarUser?.role_name ?? null);

  const currentWidth =
    dragWidth ?? (isSidebarCollapsed ? MIN_WIDTH : expandedWidth);

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
    <aside
      className={dragWidth !== null ? 'sidebar is-dragging' : 'sidebar'}
      style={{ '--sidebar-width': `${currentWidth}px` } as CSSProperties}
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