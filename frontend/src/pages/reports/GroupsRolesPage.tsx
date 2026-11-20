import { Navigate, useLocation, useParams } from 'react-router';

/**
 * Groups and roles are compared on the Overview, for HR and group leaders alike.
 * Old Groups, Roles and detail links open the matching Overview view.
 */
export function GroupsRolesPage() {
  const { campaignId } = useParams();
  const location = useLocation();
  return <Navigate to={`/reports/campaigns/${campaignId}${location.pathname.includes('/roles') ? '?by=roles' : ''}`} replace />;
}

export function GroupDetailPage() {
  const { campaignId, groupId } = useParams();
  const id = Number(groupId);
  return <Navigate to={`/reports/campaigns/${campaignId}${Number.isSafeInteger(id) && id > 0 ? `?groups=${id}` : ''}`} replace />;
}

export function RoleDetailPage() {
  const { campaignId, roleId } = useParams();
  const id = Number(roleId);
  return <Navigate to={`/reports/campaigns/${campaignId}?by=roles${Number.isSafeInteger(id) && id > 0 ? `&roles=${id}` : ''}`} replace />;
}
