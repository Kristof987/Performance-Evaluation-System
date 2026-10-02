import type { Campaign } from '../campaign.types';
export default function CampaignFormsTable({
  campaign,
}: {
  campaign: Campaign;
}) {
  return (
    <div className="campaign-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Form</th>
            <th>Groups</th>
            <th>Completion</th>
            <th>Due date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {campaign.forms.length === 0 && (
            <tr>
              <td className="campaign-state-cell" colSpan={5}>
                No forms have been assigned to this campaign yet.
              </td>
            </tr>
          )}
          {campaign.forms.map((form) => (
            <tr key={form[0]}>
              <td>
                <strong>{form[0]}</strong>
              </td>
              <td>{form[1]}</td>
              <td>
                {form[2]} / {form[3]}
                <progress value={form[2]} max={form[3]} />
              </td>
              <td>{form[4]}</td>
              <td>
                <button type="button" className="campaign-link">
                  {'View groups ->'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
