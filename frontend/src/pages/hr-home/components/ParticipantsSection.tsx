import './ParticipantsSection.css';
import { getUserInitials } from '../../layout/sidebar-user';
import type { DashboardParticipant } from '../hrHome.types';

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

type ParticipantsSectionProps = {
  participants: DashboardParticipant[];
};

function ParticipantsSection({ participants }: ParticipantsSectionProps) {
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

        {participants.map((participant) => (
          <ParticipantRow key={participant.user_id} participant={participant} />
        ))}
      </div>
    </div>
  );
}

export default ParticipantsSection;
