import { useEffect, useState } from 'react';
import { fetchAssignedEvaluations, type AssignedEvaluation } from '../../employee-home/employee-home.api';
import { useAppAuth } from '../../../auth/AppAuth';
import { ApiAccessError } from '../../../auth/authenticated-api';

export function useMyEvaluations() {
  const { state, getAccessToken, retryAuth0 } = useAppAuth();
  const userId = state.status === 'authenticated' && state.mode === 'auth0' ? state.user.id : undefined;
  const [evaluations, setEvaluations] = useState<AssignedEvaluation[]>([]);
  const [loading, setLoading] = useState(userId !== undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (userId === undefined || !getAccessToken) return;
    const controller = new AbortController();
    fetchAssignedEvaluations(getAccessToken, userId, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setEvaluations(items); })
      .catch((cause) => {
        if (cause instanceof ApiAccessError && cause.status === 401) retryAuth0();
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your evaluations could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, getAccessToken]);

  return { evaluations, loading, error: userId === undefined ? 'Sign in to view your evaluations.' : error };
}
