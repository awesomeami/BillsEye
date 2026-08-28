export interface SessionScope {
  readonly uid: string;
  readonly generation: number;
}

export interface ClientSessionScope {
  readonly uid: string;
  readonly epoch: number;
  readonly generation: number;
}

/** Tracks async UI actions across UID changes, same-UID re-logins, and unmounts. */
export class ClientSessionActionGuard {
  private uid: string | null = null;
  private epoch = -1;
  private generation = 0;
  private disposed = false;

  update(uid: string | null, epoch: number): void {
    if (this.uid === uid && this.epoch === epoch) return;
    this.uid = uid;
    this.epoch = epoch;
    this.generation += 1;
  }

  capture(): ClientSessionScope | null {
    if (this.disposed || !this.uid) return null;
    return { uid: this.uid, epoch: this.epoch, generation: this.generation };
  }

  isActive(scope: ClientSessionScope): boolean {
    return !this.disposed && this.uid === scope.uid && this.epoch === scope.epoch && this.generation === scope.generation;
  }

  resume(): void {
    this.disposed = false;
  }

  dispose(): void {
    this.disposed = true;
    this.uid = null;
    this.generation += 1;
  }
}

/** Invalidates callbacks as soon as an auth transition or subscription replacement begins. */
export class ActiveSessionGuard {
  private uid: string | null = null;
  private generation = 0;

  activate(uid: string): SessionScope {
    this.uid = uid;
    this.generation += 1;
    return { uid, generation: this.generation };
  }

  isActive(scope: SessionScope): boolean {
    return this.uid === scope.uid && this.generation === scope.generation;
  }

  invalidate(scope?: SessionScope): void {
    if (scope && !this.isActive(scope)) return;
    this.uid = null;
    this.generation += 1;
  }
}

interface SequencedAsyncSubscriptionOptions<TSnapshot, TValue> {
  hydrate: (snapshot: TSnapshot) => Promise<TValue>;
  onUpdate: (value: TValue) => void;
  onError: (error: unknown) => void;
}

/** Suppresses async hydration that finishes after a newer snapshot or unsubscription. */
export class SequencedAsyncSubscription<TSnapshot, TValue> {
  private active = true;
  private sequence = 0;

  constructor(private readonly options: SequencedAsyncSubscriptionOptions<TSnapshot, TValue>) {}

  next(snapshot: TSnapshot): void {
    const sequence = ++this.sequence;
    void this.options.hydrate(snapshot).then(
      value => {
        if (this.active && sequence === this.sequence) this.options.onUpdate(value);
      },
      error => {
        if (this.active && sequence === this.sequence) this.options.onError(error);
      },
    );
  }

  fail(error: unknown): void {
    if (!this.active) return;
    this.active = false;
    this.sequence += 1;
    this.options.onError(error);
  }

  deactivate(): void {
    this.active = false;
    this.sequence += 1;
  }
}
