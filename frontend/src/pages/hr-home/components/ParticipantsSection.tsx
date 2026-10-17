import './ParticipantsSection.css';
import { useState } from 'react';

import Pagination from '../../../components/Pagination';
import { getUserInitials } from '../../layout/sidebar-user';
import type { DashboardParticipant } from '../hrHome.types';

const PARTICIPANTS_PER_PAGE = 4;

type ParticipantRowProps = {
  participant: DashboardParticipant;
};

function ParticipantRow({ participant }: ParticipantRowProps) {
  return (
    <div className="participant-row">
      <div className="user-avatar participant-avatar">
        {participant.profile_image_url ? (
          <img src={participant.profile_image_url} alt={participant.name} />
        ) : (
          <div className="user-initials">
            {getUserInitials(participant.name)}
          </div>
        )}
      </div>
      <div className="participant-info">
        <div className="participant-name">{participant.name}</div>
        <div className="participant-email">{participant.email}</div>
      </div>
      <div className="participant-role">{participant.role_name}</div>
      <div className="participant-groups">{participant.groups.join(', ')}</div>
      <div className="participant-evaluations-left">
        {participant.evaluations_left}
      </div>
    </div>
  );
}

function EmptyParticipantRow() {
  return <div className="participant-row participant-row-empty" />;
}

type ParticipantsSectionProps = {
  participants: DashboardParticipant[];
  onViewCompletionStatus: () => void;
};

function ParticipantsSection({ participants, onViewCompletionStatus }: ParticipantsSectionProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(
    1,
    Math.ceil(participants.length / PARTICIPANTS_PER_PAGE),
  );
  const boundedPage = Math.min(currentPage, totalPages - 1);
  const pageStart = boundedPage * PARTICIPANTS_PER_PAGE;
  const visibleParticipants = participants.slice(
    pageStart,
    pageStart + PARTICIPANTS_PER_PAGE,
  );
  const emptyRowsCount = PARTICIPANTS_PER_PAGE - visibleParticipants.length;
  const hasPagination = totalPages > 1;

  return (
    <div className="forms-section">
      <div className="section-header">
        <div className="section-title">Participants</div>
        <button className="campaign-details-link" type="button" onClick={onViewCompletionStatus}>
          View full completion status →
        </button>
      </div>

      <div className="card participants-table">
        <div className="participants-table-header">
          <div className="participants-table-heading col-participant">
            Employee
          </div>
          <div className="participants-table-heading col-role">Role</div>
          <div className="participants-table-heading col-groups">Groups</div>
          <div className="participants-table-heading col-evaluations-left">
            Evaluations left
          </div>
        </div>

        {participants.length === 0 && (
          <div className="forms-empty-state">
            No participants are assigned to this campaign.
          </div>
        )}

        <div className="participants-table-body">
          {visibleParticipants.map((participant) => (
            <ParticipantRow key={participant.employee_id} participant={participant} />
          ))}

          {Array.from({ length: emptyRowsCount }, (_, index) => (
            <EmptyParticipantRow key={`empty-participant-${index}`} />
          ))}
        </div>

        {hasPagination && (
          <Pagination
            pagination={{ page: boundedPage + 1, pages: totalPages, from: pageStart + 1, to: Math.min(pageStart + PARTICIPANTS_PER_PAGE, participants.length) }}
            total={participants.length}
            noun="participants"
            onPageChange={(page) => setCurrentPage(page - 1)}
          />
        )}
      </div>
    </div>
  );
}

export default ParticipantsSection;
