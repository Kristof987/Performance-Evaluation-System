import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronDown } from 'lucide-react';
import CampaignPage from './components/CampaignPage';
import CampaignStats from './components/CampaignStats';
import CampaignModal from './components/CampaignModal';
import CampaignForm from './components/CampaignForm';
import CampaignStatusBadge from './components/CampaignStatusBadge';
import { useCampaignDetails } from './hooks/useCampaignDetails';
import { countLabel, previewRuleCopy, type RuleCopyRequest } from './rule-copy';
import { matrixGroupWithSelfLocks, matrixSelectedCount } from './matrix.utils';
import EvaluationMatrixModal from './components/EvaluationMatrixModal';
import { previewSelfCopy } from './self-evaluations';
export function CampaignDetails() {
  const { id } = useParams();
  const [activeMatrixGroupId, setActiveMatrixGroupId] = useState<number | null>(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [copyRequest, setCopyRequest] = useState<RuleCopyRequest | null>(null);
  const [selfCopySourceId, setSelfCopySourceId] = useState<number | null>(null);
  const [expandedRuleGroups, setExpandedRuleGroups] = useState<Set<number>>(() => new Set());
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
    selfEvaluations,
    selectedSelfForms,
    selfMessage,
    isSavingSelf,
    hasSelfChanges,
    updateSelfForm,
    copySelfForm,
    discardSelfForms,
    handleUpdateSelfForms,
    selectedGroupIds,
    selectedRuleFormIds,
    selectedMatrixAssignments,
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
    formProgress,
    matrixReadiness,
    openEdit,
    closeEdit,
    updateForm,
    toggleGroup,
    updateRuleForm,
    toggleMatrixAssignment,
    applyMatrixSelectAll,
    applyMatrixSelfEvaluations,
    applyMatrixMinimumReviewers,
    applyMatrixDeleteAll,
    discardMatrix,
    applyRuleCopy,
    discardRules,
    handleUpdateGroups,
    handleUpdateRules,
    handleUpdateMatrix,
    handleUpdateCampaign,
  } = useCampaignDetails(id);
  const activeMatrixGroup = evaluationMatrix.groups.find(
    (group) => group.groupId === activeMatrixGroupId,
  );
  const copyPreview = copyRequest ? previewRuleCopy(evaluationRules, selectedRuleFormIds, copyRequest) : null;
  const validFormIds = new Set(evaluationRules.forms.map((form) => form.id));
  const selfCopyPreview = selfCopySourceId === null ? null : previewSelfCopy(selfEvaluations, selectedSelfForms, selfCopySourceId);

  function reviewMissingAssignments() {
    const missing = formProgress.groups.find((group) => group.firstMissing);
    if (missing) setExpandedRuleGroups((current) => new Set([...current, missing.groupId]));
    requestAnimationFrame(() => {
      const target = missing?.firstMissing
        ? document.getElementById(`campaign-rule-${missing.groupId}-${missing.firstMissing.evaluatorRoleId}-${missing.firstMissing.evaluateeRoleId}`)
        : document.getElementById('campaign-form-assignment-rules');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    });
  }

  function getSelectedMatrixCount(groupId: number) {
    return matrixSelectedCount(selectedMatrixAssignments, groupId);
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
              <CampaignStatusBadge status={campaign.status} />
              {campaign.start} - {campaign.end}
            </p>
          </div>
          <div className="campaign-heading-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={openEdit}
            >
              Edit campaign
            </button>
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
            <>
            {campaignGroups.availableGroups.length > 8 && (
              <input className="form-control campaign-group-search" aria-label="Search campaign groups" placeholder="Search groups..." value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} />
            )}
            <div className="campaign-groups-grid">
              {campaignGroups.availableGroups.filter((group) => group.name.toLowerCase().includes(groupSearch.trim().toLowerCase())).map((group) => (
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
            </>
          )}

          <div className="campaign-groups-footer">
            <span>{countLabel(selectedGroupIds.length, 'group')} selected</span>
            {groupsMessage !== '' && <strong>{groupsMessage}</strong>}
          </div>
        </section>

        <section className="campaign-rules-card" id="campaign-form-assignment-rules" tabIndex={-1}>
          <div className="campaign-groups-heading">
            <div>
              <h2>Form assignment rules</h2>
              <p>Choose which questionnaire is used for each evaluator–evaluatee role relationship.</p>
            </div>
            {hasRuleChanges && <span className="campaign-rules-unsaved" role="status">Unsaved changes</span>}
            {hasRuleChanges && <button className="btn btn-secondary" type="button" onClick={discardRules}>Discard changes</button>}
            <button
              className={hasRuleChanges ? 'btn btn-primary' : 'btn btn-secondary'}
              type="button"
              disabled={isSavingRules || !hasRuleChanges}
              onClick={handleUpdateRules}
            >
              {isSavingRules ? 'Saving...' : 'Save form rules'}
            </button>
          </div>

          {evaluationRules.groups.length === 0 ? (
            <div className="campaign-groups-empty">
              Select and save at least one campaign group before assigning forms to role relationships.
            </div>
          ) : (
            <div className="campaign-rule-groups">
              {evaluationRules.groups.map((group) => {
                const progress = formProgress.groups.find((item) => item.groupId === group.groupId);
                return (
                <div className="campaign-rule-group" key={group.groupId}>
                  <div className="campaign-rule-group-title">
                    <div>
                      <strong>{group.groupName}</strong>
                      <span>{progress?.required === 0 ? 'No role relationships' : `${progress?.configured ?? 0} / ${progress?.required ?? 0} forms configured ${progress?.missing ? ` · ${countLabel(progress.missing, 'missing assignment')}` : ''}`}</span>
                    </div>
                    <div className="campaign-rule-group-actions">
                      <button className="campaign-rule-copy-btn" type="button" onClick={() => setCopyRequest({ sourceGroupId: group.groupId })}>
                        Copy group rules to other groups
                      </button>
                      <button
                        className="campaign-rule-expand-btn"
                        type="button"
                        aria-label={`${expandedRuleGroups.has(group.groupId) ? 'Collapse' : 'Expand'} ${group.groupName} form rules`}
                        aria-expanded={expandedRuleGroups.has(group.groupId)}
                        aria-controls={`campaign-rules-${group.groupId}`}
                        onClick={() => setExpandedRuleGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.groupId)) next.delete(group.groupId);
                          else next.add(group.groupId);
                          return next;
                        })}
                      >
                        <ChevronDown className={expandedRuleGroups.has(group.groupId) ? 'campaign-rule-chevron expanded' : 'campaign-rule-chevron'} size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div id={`campaign-rules-${group.groupId}`} hidden={!expandedRuleGroups.has(group.groupId)}>
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
                            <th>Assigned form</th>
                            <th>Actions</th>
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
                                       id={`campaign-rule-${group.groupId}-${pair.evaluatorRoleId}-${pair.evaluateeRoleId}`}
                                       className="form-control"
                                       aria-label={`${group.groupName}: ${pair.evaluatorRoleName} evaluates ${pair.evaluateeRoleName} form`}
                                      value={selectedRuleFormIds[ruleKey] ?? ''}
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
                                    {!validFormIds.has(selectedRuleFormIds[ruleKey] ?? -1) && <small className="campaign-rule-missing">Form required</small>}
                                  </div>
                                </td>
                                <td>
                                  <button
                                    className="campaign-rule-copy-btn campaign-rule-copy-inline"
                                    type="button"
                                    title="Copy this role pair's form assignment to matching role pairs in other campaign groups."
                                    aria-label={`Copy ${pair.evaluatorRoleName} to ${pair.evaluateeRoleName} form assignment to matching groups`}
                                    onClick={() => setCopyRequest({ sourceGroupId: group.groupId, evaluatorRoleId: pair.evaluatorRoleId, evaluateeRoleId: pair.evaluateeRoleId })}
                                  >
                                    Copy to groups
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  </div>
                </div>
              ); })}
            </div>
          )}

          <div className="campaign-groups-footer">
            <span>
              {formProgress.configured} of {formProgress.required} role relationships configured{formProgress.missing > 0 && ` · ${countLabel(formProgress.missing, 'missing assignment')}`}
            </span>
            {rulesMessage !== '' && <strong>{rulesMessage}</strong>}
          </div>
        </section>

        <section className="campaign-rules-card" id="campaign-self-evaluations">
          <div className="campaign-groups-heading">
            <div>
              <h2>Self-evaluations</h2>
              <p>Assign a self-evaluation questionnaire to each employee in this campaign.</p>
            </div>
            {hasSelfChanges && <span className="campaign-rules-unsaved" role="status">Unsaved changes</span>}
            {hasSelfChanges && <button className="btn btn-secondary" type="button" disabled={isSavingSelf} onClick={discardSelfForms}>Discard changes</button>}
            <button className={hasSelfChanges ? 'btn btn-primary' : 'btn btn-secondary'} type="button" disabled={isSavingSelf || !hasSelfChanges || hasMatrixChanges} onClick={handleUpdateSelfForms}>
              {isSavingSelf ? 'Saving...' : 'Save self-evaluations'}
            </button>
          </div>
          {hasMatrixChanges && hasSelfChanges && <p role="status">Save or discard matrix selections before changing self-evaluation forms.</p>}
          {selfEvaluations.participants.length === 0 ? (
            <div className="campaign-groups-empty">Select and save campaign groups with active participants to configure self-evaluations.</div>
          ) : (
            <div className="campaign-rule-table-wrap">
              <table className="campaign-rule-table campaign-self-table">
                <thead><tr><th scope="col">Participant</th><th scope="col">Groups</th><th scope="col">Self-evaluation form</th><th scope="col">Actions</th></tr></thead>
                <tbody>{selfEvaluations.participants.map((person) => (
                  <tr key={person.employeeId}>
                    <th scope="row"><strong>{person.name}</strong><small>{person.roleName}</small></th>
                    <td>{person.groupNames.join(', ')}</td>
                    <td>
                      <select className="form-control" aria-label={`Self-evaluation form for ${person.name}`} value={selectedSelfForms[person.employeeId] ?? ''} disabled={person.locked || isSavingSelf} onChange={(event) => updateSelfForm(person.employeeId, event.target.value === '' ? null : Number(event.target.value))}>
                        <option value="">No form</option>
                        {selfEvaluations.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                      </select>
                      {person.locked && <small>Issued self-evaluation is protected</small>}
                    </td>
                    <td><button className="campaign-rule-copy-btn" type="button" aria-label={`Copy ${person.name}'s self-evaluation questionnaire to all other employees in the campaign`} title="Copy this employee's self-evaluation questionnaire to all other employees in the campaign." disabled={isSavingSelf || !selfEvaluations.forms.some((form) => form.id === selectedSelfForms[person.employeeId])} onClick={() => setSelfCopySourceId(person.employeeId)}>Copy to all</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="campaign-groups-footer"><span>{countLabel(selfEvaluations.participants.length, 'participant')}</span>{selfMessage && <strong role="status">{selfMessage}</strong>}</div>
        </section>

        <section className="campaign-rules-card">
          <div className="campaign-groups-heading">
            <div>
              <h2>Evaluation Matrix</h2>
              <p>Select which employees should evaluate each other in every selected group.</p>
            </div>
            {hasMatrixChanges && <span className="campaign-rules-unsaved" role="status">Unsaved changes</span>}
            {hasMatrixChanges && <button className="btn btn-secondary" type="button" disabled={isSavingMatrix} onClick={discardMatrix}>Discard changes</button>}
            <button
              className={hasMatrixChanges ? 'btn btn-primary' : 'btn btn-secondary'}
              type="button"
              disabled={isSavingMatrix || !hasMatrixChanges || matrixReadiness !== 'ready'}
              onClick={handleUpdateMatrix}
            >
              {isSavingMatrix ? 'Saving...' : 'Save matrix'}
            </button>
          </div>

          {matrixReadiness !== 'ready' && (
            <div className="campaign-matrix-prerequisite" role="status">
              <strong>{matrixReadiness === 'rules' ? 'Save form rules first' : matrixReadiness === 'missing' ? 'Complete form assignments first' : matrixReadiness === 'empty' ? 'No role relationships available' : 'Save campaign groups first'}</strong>
              <p>{matrixReadiness === 'rules'
                ? 'Save your Form assignment rule changes before editing the Evaluation Matrix.'
                : matrixReadiness === 'missing'
                   ? `${countLabel(formProgress.missing, 'role relationship')} ${formProgress.missing === 1 ? 'still needs' : 'still need'} questionnaires before the Evaluation Matrix can be edited.`
                  : matrixReadiness === 'empty'
                    ? 'Selected groups have no active role relationships to configure.'
                    : 'Select and save at least one campaign group to configure evaluation assignments.'}</p>
              {matrixReadiness === 'missing' && <button className="campaign-link" type="button" onClick={reviewMissingAssignments}>Review missing assignments</button>}
            </div>
          )}

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
                      {countLabel(group.employees.length, 'employee')} · {countLabel(getSelectedMatrixCount(group.groupId), 'pair')} selected
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={group.employees.length === 0 || matrixReadiness !== 'ready'}
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
              {countLabel(matrixSelectedCount(selectedMatrixAssignments), 'evaluation pair')} selected
            </span>
            {matrixMessage !== '' && <strong>{matrixMessage}</strong>}
          </div>
        </section>

      </div>

      {copyRequest && copyPreview && (
        <CampaignModal mode={copyRequest.evaluatorRoleId === undefined ? 'copy-group' : 'copy-role'} onClose={() => setCopyRequest(null)}>
          <div className="campaign-copy-preview">
            <p className="campaign-copy-source">Source group: <strong>{copyPreview.source?.groupName}</strong></p>
            {copyRequest.evaluatorRoleId !== undefined && (
              <div className="campaign-copy-context">
                <span>Evaluator role <strong>{copyPreview.sourcePairs[0]?.evaluatorRoleName}</strong></span>
                <span>Evaluatee role <strong>{copyPreview.sourcePairs[0]?.evaluateeRoleName}</strong></span>
                <span>Selected form <strong>{evaluationRules.forms.find((form) => form.id === selectedRuleFormIds[`${copyRequest.sourceGroupId}:${copyRequest.evaluatorRoleId}:${copyRequest.evaluateeRoleId}`])?.name ?? 'No form'}</strong></span>
              </div>
            )}
            <dl className="campaign-copy-counts">
              {copyRequest.evaluatorRoleId === undefined && <div><dt>Source role relationships</dt><dd>{copyPreview.sourcePairs.length}</dd></div>}
              <div><dt>Destination groups affected</dt><dd>{copyPreview.affectedGroups}</dd></div>
              <div><dt>Assignments to change</dt><dd>{Object.keys(copyPreview.changes).length}</dd></div>
              <div><dt>New assignments</dt><dd>{copyPreview.assigned}</dd></div>
              <div><dt>Existing assignments replaced</dt><dd>{copyPreview.replaced}</dd></div>
              <div><dt>Assignments cleared</dt><dd>{copyPreview.cleared}</dd></div>
            </dl>
            {Object.keys(copyPreview.changes).length === 0 ? <p>All matching assignments are already up to date.</p> : <p>Only matching directed role pairs will be updated. Changes remain local until Save form rules is clicked.</p>}
            <div className="campaign-modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setCopyRequest(null)}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={Object.keys(copyPreview.changes).length === 0} onClick={() => { applyRuleCopy(copyRequest); setCopyRequest(null); }}>Apply changes</button>
            </div>
          </div>
        </CampaignModal>
      )}

      {selfCopyPreview && (
        <CampaignModal mode="copy-self" onClose={() => setSelfCopySourceId(null)}>
          <div className="campaign-copy-preview">
            <p>From <strong>{selfCopyPreview.source?.name}</strong>: <strong>{selfEvaluations.forms.find((form) => form.id === selfCopyPreview.formId)?.name ?? 'No form'}</strong></p>
            <dl className="campaign-copy-counts">
              <div><dt>Participants to change</dt><dd>{Object.keys(selfCopyPreview.changes).length}</dd></div>
              <div><dt>New assignments</dt><dd>{selfCopyPreview.newCount}</dd></div>
              <div><dt>Existing assignments replaced</dt><dd>{selfCopyPreview.replacedCount}</dd></div>
              <div><dt>Protected issued evaluations skipped</dt><dd>{selfCopyPreview.protectedCount}</dd></div>
              <div><dt>Already matching skipped</dt><dd>{selfCopyPreview.unchangedCount}</dd></div>
            </dl>
            <p>{Object.keys(selfCopyPreview.changes).length ? 'Changes remain local until Save self-evaluations is clicked.' : 'There are no changes to apply.'}</p>
            <div className="campaign-modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setSelfCopySourceId(null)}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={isSavingSelf || !Object.keys(selfCopyPreview.changes).length} onClick={() => { copySelfForm(selfCopySourceId!); setSelfCopySourceId(null); }}>Apply changes</button>
            </div>
          </div>
        </CampaignModal>
      )}

      {isEditOpen && (
        <CampaignModal
          mode="edit"
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

       {activeMatrixGroup !== undefined && matrixReadiness === 'ready' && (
         <EvaluationMatrixModal
            group={matrixGroupWithSelfLocks(evaluationMatrix, activeMatrixGroup)}
            rules={evaluationRules}
            selfForms={selectedSelfForms}
            selfFormsDirty={hasSelfChanges}
           selection={selectedMatrixAssignments}
           dirty={hasMatrixChanges}
           rulesDirty={hasRuleChanges}
           saving={isSavingMatrix}
           message={matrixMessage}
           onClose={() => setActiveMatrixGroupId(null)}
           onToggle={toggleMatrixAssignment}
           onAddAll={applyMatrixSelectAll}
           onAddSelf={applyMatrixSelfEvaluations}
           onGenerate={applyMatrixMinimumReviewers}
           onClear={applyMatrixDeleteAll}
            onDiscard={discardMatrix}
            onReviewSelf={() => {
              setActiveMatrixGroupId(null);
              requestAnimationFrame(() => document.getElementById('campaign-self-evaluations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            }}
         />
       )}
    </CampaignPage>
  );
}

export default CampaignDetails;
