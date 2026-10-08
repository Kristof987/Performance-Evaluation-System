import './ParticipantsSection.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

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
};

function ParticipantsSection({ participants }: ParticipantsSectionProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(
    1,
    Math.ceil(participants.length / PARTICIPANTS_PER_PAGE),
  );
  const pageStart = currentPage * PARTICIPANTS_PER_PAGE;
  const visibleParticipants = participants.slice(
    pageStart,
    pageStart + PARTICIPANTS_PER_PAGE,
  );
  const emptyRowsCount = PARTICIPANTS_PER_PAGE - visibleParticipants.length;
  const hasPagination = totalPages > 1;

  useEffect(() => {
    setCurrentPage(0);
  }, [participants]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages - 1));
  }, [totalPages]);

  const previousPageHandler = () => {
    setCurrentPage((page) => Math.max(0, page - 1));
  };

  const nextPageHandler = () => {
    setCurrentPage((page) => Math.min(totalPages - 1, page + 1));
  };

  return (
    <div className="forms-section">
      <div className="section-header">
        <div className="section-title">Participants</div>
        <button className="campaign-details-link" type="button">
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
            <ParticipantRow key={participant.user_id} participant={participant} />
          ))}

          {Array.from({ length: emptyRowsCount }, (_, index) => (
            <EmptyParticipantRow key={`empty-participant-${index}`} />
          ))}
        </div>

        {hasPagination && (
          <div className="participants-pagination">
            <span className="participants-page-label">
              {currentPage + 1} / {totalPages}
            </span>
            <div className="participants-page-actions">
              <button
                className="participants-page-button"
                type="button"
                onClick={previousPageHandler}
                disabled={currentPage === 0}
                aria-label="Previous participants page"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="participants-page-button"
                type="button"
                onClick={nextPageHandler}
                disabled={currentPage === totalPages - 1}
                aria-label="Next participants page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ParticipantsSection;
