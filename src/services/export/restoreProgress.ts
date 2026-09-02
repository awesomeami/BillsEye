export type RestoreSection = 'receipts' | 'categories' | 'aliases' | 'settings' | 'profile';

export interface RestoreTask {
  section: RestoreSection;
  run: () => Promise<void>;
}

export interface RestoreProgress {
  completed: number;
  total: number;
  currentSection: RestoreSection | null;
  completedBySection: Record<RestoreSection, number>;
}

const emptySectionCounts = (): Record<RestoreSection, number> => ({
  receipts: 0,
  categories: 0,
  aliases: 0,
  settings: 0,
  profile: 0,
});

export class RestoreInterruptedError extends Error {
  readonly progress: RestoreProgress;
  readonly originalError: unknown;

  constructor(progress: RestoreProgress, originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : 'A restore write failed.');
    this.name = 'RestoreInterruptedError';
    this.progress = progress;
    this.originalError = originalError;
  }
}

export async function runRestoreTasks(
  tasks: readonly RestoreTask[],
  onProgress: (progress: RestoreProgress) => void,
): Promise<RestoreProgress> {
  const progress: RestoreProgress = {
    completed: 0,
    total: tasks.length,
    currentSection: tasks[0]?.section ?? null,
    completedBySection: emptySectionCounts(),
  };
  onProgress({ ...progress, completedBySection: { ...progress.completedBySection } });

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    progress.currentSection = task.section;
    try {
      await task.run();
    } catch (error) {
      const snapshot = { ...progress, completedBySection: { ...progress.completedBySection } };
      onProgress(snapshot);
      throw new RestoreInterruptedError(snapshot, error);
    }

    progress.completed += 1;
    progress.completedBySection[task.section] += 1;
    progress.currentSection = tasks[index + 1]?.section ?? null;
    onProgress({ ...progress, completedBySection: { ...progress.completedBySection } });
  }

  return { ...progress, completedBySection: { ...progress.completedBySection } };
}
