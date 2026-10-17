import { useEffect, useState } from 'react';
import { fetchAssignedEvaluations, type AssignedEvaluation } from '../../employee-home/employee-home.api';
import { getSidebarUser } from '../../layout/sidebar-user';

export function useMyEvaluations() {
  const userId = getSidebarUser()?.id;
  const [evaluations, setEvaluations] = useState<AssignedEvaluation[]>([]);
  const [loading, setLoading] = useState(userId !== undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (userId === undefined) return;
    const controller = new AbortController();
    fetchAssignedEvaluations(userId, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setEvaluations(items); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your evaluations could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId]);

  return { evaluations, loading, error: userId === undefined ? 'Sign in to view your evaluations.' : error };
}
