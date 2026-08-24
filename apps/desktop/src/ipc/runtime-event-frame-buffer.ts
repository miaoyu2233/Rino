import type { RuntimeEvent } from "./runtime-contract";

export interface RuntimeEventFrameScheduler {
  request: (callback: () => void) => number;
  cancel: (requestId: number) => void;
}

export class RuntimeEventFrameBuffer {
  private pending: RuntimeEvent[] = [];
  private scheduledRequestId: number | undefined;
  private disposed = false;

  constructor(
    private readonly commit: (events: readonly RuntimeEvent[]) => void,
    private readonly scheduler: RuntimeEventFrameScheduler,
  ) {}

  enqueue(event: RuntimeEvent, flushImmediately = false): void {
    if (this.disposed) {
      return;
    }
    this.pending.push(event);
    if (flushImmediately) {
      this.flush();
      return;
    }
    this.scheduledRequestId ??= this.scheduler.request(() => {
      this.scheduledRequestId = undefined;
      this.commitPending();
    });
  }

  clear(): void {
    this.cancelScheduledRequest();
    this.pending = [];
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private flush(): void {
    this.cancelScheduledRequest();
    this.commitPending();
  }

  private cancelScheduledRequest(): void {
    if (this.scheduledRequestId === undefined) {
      return;
    }
    this.scheduler.cancel(this.scheduledRequestId);
    this.scheduledRequestId = undefined;
  }

  private commitPending(): void {
    if (this.pending.length === 0) {
      return;
    }
    const events = this.pending;
    this.pending = [];
    this.commit(events);
  }
}
