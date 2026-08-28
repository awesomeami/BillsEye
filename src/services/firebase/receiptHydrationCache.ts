export interface ReceiptHydrationSource<TReference, TData extends Record<string, unknown>> {
  id: string;
  ref: TReference;
  data: TData;
}

interface CachedHydration<TValue> {
  version: string;
  value: TValue;
}

function timestampVersion(value: unknown): string {
  if (value == null) return 'pending';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const timestamp = value as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof timestamp.toMillis === 'function') return String(timestamp.toMillis());
    if (typeof timestamp.seconds === 'number') {
      return `${timestamp.seconds}:${timestamp.nanoseconds ?? 0}`;
    }
  }
  return 'unknown';
}

/**
 * Returns the authoritative parent-document version used to decide whether an
 * item subcollection can be reused. Receipt writes increment `revision` and
 * update `updatedAt` in the same atomic operation as item writes.
 */
export function getReceiptHydrationVersion(data: Record<string, unknown>): string | null {
  const revision = data.revision;
  if (typeof revision !== 'number' || !Number.isFinite(revision)) return null;
  return `storage:${String(data.itemStorageVersion ?? 1)}|revision:${revision}|updated:${timestampVersion(data.updatedAt)}`;
}

/**
 * A subscription-local, generation-aware cache. Instances must not be shared
 * between queries or users; clearing invalidates any hydration still in flight.
 */
export class ReceiptHydrationCache<TReference, TData extends Record<string, unknown>, TValue> {
  private entries = new Map<string, CachedHydration<TValue>>();
  private inFlight = new Map<string, Promise<TValue>>();
  private lastValues: TValue[] | null = null;
  private generation = 0;

  get size(): number {
    return this.entries.size;
  }

  async hydrate(
    sources: readonly ReceiptHydrationSource<TReference, TData>[],
    load: (source: ReceiptHydrationSource<TReference, TData>) => Promise<TValue>,
  ): Promise<TValue[]> {
    const generation = ++this.generation;
    const hydrated = await Promise.all(sources.map(async source => {
      const version = getReceiptHydrationVersion(source.data);
      const cached = this.entries.get(source.id);
      if (version !== null && cached?.version === version) {
        return { id: source.id, version, value: cached.value };
      }

      const inFlightKey = version === null ? null : `${source.id}\u0000${version}`;
      let hydration = inFlightKey ? this.inFlight.get(inFlightKey) : undefined;
      if (!hydration) {
        hydration = load(source);
        if (inFlightKey) {
          this.inFlight.set(inFlightKey, hydration);
          const clearInFlight = () => {
            if (this.inFlight.get(inFlightKey) === hydration) this.inFlight.delete(inFlightKey);
          };
          void hydration.then(clearInFlight, clearInFlight);
        }
      }
      return { id: source.id, version, value: await hydration };
    }));

    // Only the newest snapshot may replace the cache. Rebuilding the map also
    // removes receipts that disappeared from the authoritative query result.
    let values = hydrated.map(entry => entry.value);
    if (generation === this.generation) {
      this.entries = new Map(hydrated.flatMap(entry => entry.version === null
        ? []
        : [[entry.id, { version: entry.version, value: entry.value }] as const]));
      if (this.lastValues?.length === values.length && this.lastValues.every((value, index) => value === values[index])) {
        values = this.lastValues;
      } else {
        this.lastValues = values;
      }
    }

    return values;
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
    this.lastValues = null;
  }
}
