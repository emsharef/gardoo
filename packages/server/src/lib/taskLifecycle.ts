const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  today: 1,
  upcoming: 2,
  informational: 3,
};

const STALENESS_DAYS = 7;

interface TaskLike {
  id: string;
  suggestedDate: string;
  priority: string;
}

/**
 * Returns tasks whose suggestedDate is more than 7 days before currentDate.
 */
export function findStaleTasks<T extends TaskLike>(
  tasks: T[],
  currentDate: string,
): T[] {
  const now = new Date(currentDate + "T00:00:00Z");
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - STALENESS_DAYS);

  return tasks.filter((t) => {
    const suggested = new Date(t.suggestedDate + "T00:00:00Z");
    return suggested < cutoff;
  });
}

/**
 * Given all pending tasks and a budget, returns the tasks that should be
 * cancelled (lowest priority, furthest date) to bring count to maxTasks.
 */
export function enforceBudget<T extends TaskLike>(
  pendingTasks: T[],
  maxTasks: number,
): T[] {
  if (pendingTasks.length <= maxTasks) return [];

  // Sort: highest priority first, then earliest date first (these we keep)
  const sorted = [...pendingTasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.suggestedDate.localeCompare(b.suggestedDate);
  });

  // Keep the first maxTasks, cancel the rest
  const toCancel = sorted.slice(maxTasks);
  return toCancel;
}
