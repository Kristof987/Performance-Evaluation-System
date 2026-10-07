import CampaignFormsTable from './components/CampaignFormsTable';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import CampaignPage from './components/CampaignPage';
import CampaignStats from './components/CampaignStats';
import CampaignModal from './components/CampaignModal';
import CampaignForm from './components/CampaignForm';
import { useCampaignDetails } from './hooks/useCampaignDetails';
export function CampaignDetails() {
  const { id } = useParams();
  const [activeMatrixGroupId, setActiveMatrixGroupId] = useState<number | null>(null);
  const [minimumReviewers, setMinimumReviewers] = useState('1');
  const {
    campaign,
    form,
    isEditOpen,
    isCampaignLoading,
    isSavingCampaign,
    campaignError,
    saveMessage,
    successMessage,
    campaignGroups,
    evaluationRules,
    evaluationMatrix,
    selectedGroupIds,
    selectedRuleFormIds,
    selectedMatrixAssignments,
    activeRuleKey,
    groupsMessage,
    rulesMessage,
    matrixMessage,
    isSavingGroups,
    isSavingRules,
    isSavingMatrix,
    hasEditChanges,
    hasGroupChanges,
    hasRuleChanges,
    hasMatrixChanges,
    openEdit,
    closeEdit,
    updateForm,
    toggleGroup,
    updateRuleForm,
    toggleMatrixAssignment,
    getMatrixRuleFormId,
    applyMatrixSelectAll,
    applyMatrixSelfEvaluations,
    applyMatrixMinimumReviewers,
    applyMatrixDeleteAll,
    activateRuleForm,
    applyRuleToMatchingGroups,
    applyGroupRulesToMatchingGroups,
    handleUpdateGroups,
    handleUpdateRules,
    handleUpdateMatrix,
    handleUpdateCampaign,
  } = useCampaignDetails(id);
  const activeMatrixGroup = evaluationMatrix.groups.find(
    (group) => group.groupId === activeMatrixGroupId,
  );

  function getSelectedMatrixCount(groupId: number) {
    return Object.entries(selectedMatrixAssignments).filter(
      ([key, isSelected]) => isSelected && key.startsWith(`${groupId}:`),
    ).length;
  }

  function getMinimumReviewerValue() {
    const parsed = Number.parseInt(minimumReviewers, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  if (isCampaignLoading) {
    return (
      <CampaignPage>
        <div className="campaign-view">
          <p>Loading campaign...</p>
        </div>
      </CampaignPage>
    );
  }

  if (campaign === null) {
    return (
      <CampaignPage>
        <div className="campaign-view">
          <p>{campaignError || 'Campaign not found.'}</p>
        </div>
      </CampaignPage>
    );
  }

  return (
    <CampaignPage>
      <div className="campaign-view">
        <div className="campaign-heading">
          <div>
            <Link to="/campaigns">{'<- All campaigns'}</Link>
            <h1>{campaign.name}</h1>
            <p>
              <span
                className={`badge ${
                  campaign.status === 'Active'
                    ? 'badge-success'
                    : 'badge-neutral'
                }`}
              >
                {campaign.status}
              </span>
              {campaign.start} - {campaign.end}
            </p>
          </div>
          <div className="campaign-heading-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={openEdit}
            >
              Edit Campaign
            </button>
            <Link to="/hr-home">Back to dashboard</Link>
          </div>
        </div>

        {successMessage !== '' && (
          <div className="campaign-success-message">{successMessage}</div>
        )}

        <CampaignStats campaign={campaign} />

        <section className="campaign-groups-card">
          <div className="campaign-groups-heading">
            <div>
              <h2>Campaign groups</h2>
              <p>Select which company groups are included in this campaign.</p>
            </div>
            <button
              className={hasGroupChanges ? 'btn btn-primary' : 'btn btn-secondary'}
              type="button"
              disabled={isSavingGroups || !hasGroupChanges}
              onClick={handleUpdateGroups}
            >
              {isSavingGroups ? 'Saving...' : 'Save groups'}
            </button>
          </div>

          {campaignGroups.availableGroups.length === 0 ? (
            <div className="campaign-groups-empty">
              No groups have been created yet. Add groups from the People page first.
            </div>
          ) : (
            <div className="campaign-groups-grid">
              {campaignGroups.availableGroups.map((group) => (
                <label className="campaign-group-option" key={group.id}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                  />
                  <span>
                    <strong>{group.name}</strong>
                    {group.description && <small>{group.description}</small>}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="campaign-groups-footer">
            <span>{selectedGroupIds.length} selected</span>
            {groupsMessage !== '' && <strong>{groupsMessage}</strong>}
          </div>
        </section>

        <section className="campaign-rules-card">
          <div className="campaign-groups-heading">
            <div>
              <h2>Forms by group role relationship</h2>
              <p>For each selected group, choose which form should be filled for every role relationship in that group.</p>
            </div>
            <button
              className={hasRuleChanges ? 'btn btn-primary' : 'btn btn-secondary'}
              type="button"
              disabled={isSavingRules || !hasRuleChanges}
              onClick={handleUpdateRules}
            >
              {isSavingRules ? 'Saving...' : 'Save form rules'}
            </button>
          </div>

          {evaluationRules.forms.length === 0 ? (
            <div className="campaign-groups-empty">
              No forms have been created yet. Add forms from the Forms page first.
            </div>
          ) : evaluationRules.groups.length === 0 ? (
            <div className="campaign-groups-empty">
              Select and save at least one campaign group before assigning forms to role relationships.
            </div>
          ) : (
            <div className="campaign-rule-groups">
              {evaluationRules.groups.map((group) => (
                <div className="campaign-rule-group" key={group.groupId}>
                  <div className="campaign-rule-group-title">
                    <div>
                      <strong>{group.groupName}</strong>
                      <span>{group.rolePairs.length} role relationships</span>
                    </div>
                    <button
                      className="campaign-rule-copy-btn"
                      type="button"
                      onClick={() => applyGroupRulesToMatchingGroups(group.groupId)}
                    >
                      Apply to matching groups
                    </button>
                  </div>
                  {group.rolePairs.length === 0 ? (
                    <div className="campaign-groups-empty">
                      This group has no active members with roles yet.
                    </div>
                  ) : (
                    <div className="campaign-rule-table-wrap">
                      <table className="campaign-rule-table">
                        <thead>
                          <tr>
                            <th>Evaluator role</th>
                            <th>Evaluatee role</th>
                            <th>Form to fill</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rolePairs.map((pair) => {
                            const ruleKey = `${group.groupId}:${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`;
                            return (
                              <tr key={ruleKey}>
                                <td>{pair.evaluatorRoleName}</td>
                                <td>{pair.evaluateeRoleName}</td>
                                <td>
                                  <div className="campaign-rule-form-cell">
                                    <select
                                      className="form-control"
                                      value={selectedRuleFormIds[ruleKey] ?? ''}
                                      onFocus={() =>
                                        activateRuleForm(
                                          group.groupId,
                                          pair.evaluatorRoleId,
                                          pair.evaluateeRoleId,
                                        )
                                      }
                                      onChange={(event) =>
                                        updateRuleForm(
                                          group.groupId,
                                          pair.evaluatorRoleId,
                                          pair.evaluateeRoleId,
                                          event.target.value === '' ? null : Number(event.target.value),
                                        )
                                      }
                                    >
                                      <option value="">No form</option>
                                      {evaluationRules.forms.map((form) => (
                                        <option key={form.id} value={form.id}>
                                          {form.name}
                                        </option>
                                      ))}
                                    </select>
                                    {activeRuleKey === ruleKey && (
                                      <button
                                        className="campaign-rule-copy-btn campaign-rule-copy-inline"
                                        type="button"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() =>
                                          applyRuleToMatchingGroups(
                                            group.groupId,
                                            pair.evaluatorRoleId,
                                            pair.evaluateeRoleId,
                                          )
                                        }
                                      >
                                        Apply this pair
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="campaign-groups-footer">
            <span>
              {Object.values(selectedRuleFormIds).filter((formId) => formId !== null).length} form rules selected
            </span>
            {rulesMessage !== '' && <strong>{rulesMessage}</strong>}
          </div>
        </section>

        <section className="campaign-rules-card">
          <div className="campaign-groups-heading">
            <div>
              <h2>Evaluation Matrix</h2>
              <p>Select which employees should evaluate each other in every selected group.</p>
            </div>
            <button
              className={hasMatrixChanges ? 'btn btn-primary' : 'btn btn-secondary'}
              type="button"
              disabled={isSavingMatrix || !hasMatrixChanges || hasRuleChanges}
              onClick={handleUpdateMatrix}
            >
              {isSavingMatrix ? 'Saving...' : 'Save matrix'}
            </button>
          </div>

          {evaluationMatrix.groups.length === 0 ? (
            <div className="campaign-groups-empty">
              Select and save at least one campaign group before setting up evaluations.
            </div>
          ) : (
            <div className="campaign-matrix-group-grid">
              {evaluationMatrix.groups.map((group) => (
                <article className="campaign-matrix-group-card" key={group.groupId}>
                  <div>
                    <strong>{group.groupName}</strong>
                    <p>
                      {group.employees.length} employees · {getSelectedMatrixCount(group.groupId)} evaluations selected
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={group.employees.length === 0}
                    onClick={() => setActiveMatrixGroupId(group.groupId)}
                  >
                    Open matrix
                  </button>
                </article>
              ))}
            </div>
          )}

          <div className="campaign-groups-footer">
            <span>
              {Object.values(selectedMatrixAssignments).filter(Boolean).length} evaluations selected
            </span>
            {hasRuleChanges && <strong>Save form rules before editing the matrix.</strong>}
            {matrixMessage !== '' && <strong>{matrixMessage}</strong>}
          </div>
        </section>

        <h2>Forms & assigned groups</h2>

        <CampaignFormsTable campaign={campaign} />

        <p className="campaign-sample-note">
          Campaign data loaded from the database.
          {campaign.status === 'Closed'
            ? ' This campaign is closed and read-only.'
            : ' Review assignments and deadlines within each form.'}
        </p>
      </div>

      {isEditOpen && (
        <CampaignModal
          mode="edit"
          issuedFormsCount={campaign.issuedFormsCount}
          onClose={closeEdit}
        >
          <CampaignForm
            form={form}
            campaign={campaign}
            message={saveMessage}
            isSaving={isSavingCampaign}
            hasChanges={hasEditChanges}
            updateForm={updateForm}
            onSubmit={handleUpdateCampaign}
            onCancel={closeEdit}
          />
        </CampaignModal>
      )}

      {activeMatrixGroup !== undefined && (
        <div className="campaign-modal-backdrop" role="presentation">
          <section
            className="campaign-modal campaign-matrix-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-matrix-title"
          >
            <div className="campaign-modal-header campaign-matrix-modal-header">
              <div>
                <span className="campaign-modal-eyebrow">Evaluation Matrix</span>
                <h2 id="campaign-matrix-title">{activeMatrixGroup.groupName}</h2>
                <p>
                  {activeMatrixGroup.employees.length} employees · {getSelectedMatrixCount(activeMatrixGroup.groupId)} evaluations selected
                </p>
              </div>
              <div className="campaign-matrix-modal-actions">
                <button
                  className={hasMatrixChanges ? 'btn btn-primary' : 'btn btn-secondary'}
                  type="button"
                  disabled={isSavingMatrix || !hasMatrixChanges || hasRuleChanges}
                  onClick={handleUpdateMatrix}
                >
                  {isSavingMatrix ? 'Saving...' : 'Save matrix'}
                </button>
                <button
                  className="campaign-modal-close"
                  type="button"
                  aria-label="Close evaluation matrix"
                  onClick={() => setActiveMatrixGroupId(null)}
                >
                  ×
                </button>
              </div>
            </div>

            {hasRuleChanges && (
              <div className="campaign-matrix-warning">
                Save form rules before editing the evaluation matrix.
              </div>
            )}

            <div className="campaign-matrix-table-wrap campaign-matrix-modal-table-wrap">
              <table className="campaign-matrix-table">
                <thead>
                  <tr>
                    <th>Evaluator</th>
                    {activeMatrixGroup.employees.map((evaluatee) => (
                      <th key={evaluatee.id}>
                        <span>{evaluatee.name}</span>
                        <small>{evaluatee.roleName}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeMatrixGroup.employees.map((evaluator) => (
                    <tr key={evaluator.id}>
                      <th>
                        <span>{evaluator.name}</span>
                        <small>{evaluator.roleName}</small>
                      </th>
                      {activeMatrixGroup.employees.map((evaluatee) => {
                        const matrixKey = `${activeMatrixGroup.groupId}:${evaluator.id}:${evaluatee.id}`;
                        const formId = getMatrixRuleFormId(
                          activeMatrixGroup.groupId,
                          evaluator.roleId,
                          evaluatee.roleId,
                        );
                        const assignment = activeMatrixGroup.assignments.find(
                          (item) =>
                            item.evaluatorId === evaluator.id &&
                            item.evaluateeId === evaluatee.id,
                        );
                        const isDisabled =
                          hasRuleChanges || formId === null || assignment?.isCompleted === true;
                        const title =
                          hasRuleChanges
                            ? 'Save form rules before editing the evaluation matrix.'
                            : formId === null
                              ? 'No form rule is selected for these roles.'
                              : assignment?.isCompleted === true
                                ? 'Completed evaluations cannot be removed from the matrix.'
                                : `${evaluator.name} evaluates ${evaluatee.name}`;
                        return (
                          <td key={evaluatee.id} title={title}>
                            <input
                              type="checkbox"
                              checked={selectedMatrixAssignments[matrixKey] ?? false}
                              disabled={isDisabled}
                              onChange={() =>
                                toggleMatrixAssignment(
                                  activeMatrixGroup.groupId,
                                  evaluator.id,
                                  evaluatee.id,
                                )
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="campaign-matrix-bulk-actions" aria-label="Matrix quick actions">
              <button
                className="campaign-rule-copy-btn"
                type="button"
                disabled={hasRuleChanges}
                onClick={() => applyMatrixSelectAll(activeMatrixGroup.groupId)}
              >
                Add All
              </button>
              <button
                className="campaign-rule-copy-btn"
                type="button"
                disabled={hasRuleChanges}
                onClick={() => applyMatrixSelfEvaluations(activeMatrixGroup.groupId)}
              >
                Add Self-evaluations
              </button>
              <div className="campaign-matrix-minimum-action">
                <label htmlFor="minimum-reviewers-input">Minimum reviews per Employee</label>
                <input
                  id="minimum-reviewers-input"
                  className="form-control"
                  type="number"
                  min="0"
                  value={minimumReviewers}
                  disabled={hasRuleChanges}
                  onChange={(event) => setMinimumReviewers(event.target.value)}
                />
                <button
                  className="campaign-rule-copy-btn"
                  type="button"
                  disabled={hasRuleChanges}
                  onClick={() =>
                    applyMatrixMinimumReviewers(
                      activeMatrixGroup.groupId,
                      getMinimumReviewerValue(),
                    )
                  }
                >
                  Generate
                </button>
              </div>
              <button
                className="campaign-rule-copy-btn campaign-matrix-danger-btn"
                type="button"
                disabled={hasRuleChanges}
                onClick={() => applyMatrixDeleteAll(activeMatrixGroup.groupId)}
              >
                Delete All
              </button>
            </div>

            <div className="campaign-matrix-modal-footer">
              <span>{Object.values(selectedMatrixAssignments).filter(Boolean).length} total evaluations selected</span>
              {matrixMessage !== '' && <strong>{matrixMessage}</strong>}
            </div>
          </section>
        </div>
      )}
    </CampaignPage>
  );
}

export default CampaignDetails;
