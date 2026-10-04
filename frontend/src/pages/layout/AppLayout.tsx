import { useState, type ReactNode } from 'react';
import Sidebar, { type SidebarPage } from './Sidebar';
import './app-layout.css';
type AppLayoutProps = {
  activePage: SidebarPage;
  pageClassName: string;
  children: ReactNode;
};
export default function AppLayout({
  activePage,
  pageClassName,
  children,
}: AppLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const content = (
    <div
      className={`${activePage === 'people' ? 'page ' : ''}layout${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}
    >
      <Sidebar
        activePage={activePage}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed((current) => !current)}
      />
      {children}
    </div>
  );
  return activePage === 'people' ? (
    pageClassName ? (
      <div className={pageClassName}>{content}</div>
    ) : (
      content
    )
  ) : (
    <main className={`page ${pageClassName}`}>{content}</main>
  );
}
