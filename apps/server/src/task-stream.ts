import { EventEmitter } from 'events';

/**
 * Task lifecycle event bus for SSE consumers.
 *
 * The server agent-manager publishes TaskStreamEvents into the bus keyed by
 * `taskId`; the SSE route subscribes, forwards each event as a `data:` frame,
 * and times itself out cleanly when the client disconnects.
 *
 * We keep a small ring buffer per task so clients that connect *after* a task
 * started still get the backlog (common case: user opens the task page after
 * clicking "run").
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskStreamEvent {
  /** Monotonic sequence per task; clients can use `Last-Event-ID` to resume. */
  id: number;
  taskId: string;
  timestamp: number;
  status: TaskStatus;
  /** Optional free-form log line. */
  message?: string;
  /** Optional structured payload (e.g. final result). */
  data?: unknown;
}

interface TaskBuffer {
  /** Ring buffer of past events so late subscribers can catch up. */
  history: TaskStreamEvent[];
  /** Sequence counter. */
  nextId: number;
  /** Current status snapshot. */
  status: TaskStatus;
}

export interface TaskStreamOptions {
  /** Max events retained per task. Default 200. */
  historyLimit?: number;
}

export class TaskStreamBus extends EventEmitter {
  private readonly buffers: Map<string, TaskBuffer> = new Map();
  private readonly historyLimit: number;

  constructor(opts: TaskStreamOptions = {}) {
    super();
    this.historyLimit = opts.historyLimit ?? 200;
    // Lots of SSE clients may listen; bump the cap.
    this.setMaxListeners(0);
  }

  /**
   * Publish a new event. Returns the fully-stamped event object (with `id`).
   */
  publish(input: Omit<TaskStreamEvent, 'id' | 'timestamp'>): TaskStreamEvent {
    const buf = this.buffers.get(input.taskId) ?? this.createBuffer();
    this.buffers.set(input.taskId, buf);

    const evt: TaskStreamEvent = {
      ...input,
      id: buf.nextId++,
      timestamp: Date.now(),
    };
    buf.status = input.status;
    buf.history.push(evt);
    if (buf.history.length > this.historyLimit) {
      buf.history.splice(0, buf.history.length - this.historyLimit);
    }

    this.emit('event', evt);
    this.emit(`task:${input.taskId}`, evt);
    return evt;
  }

  /** Snapshot of history for a task. Used by late subscribers. */
  history(taskId: string, sinceId?: number): TaskStreamEvent[] {
    const buf = this.buffers.get(taskId);
    if (!buf) return [];
    if (sinceId === undefined) return buf.history.slice();
    return buf.history.filter(e => e.id > sinceId);
  }

  /** Current status (if a task has published any event). */
  statusOf(taskId: string): TaskStatus | undefined {
    return this.buffers.get(taskId)?.status;
  }

  /**
   * Subscribe to future events for one task. Returns an unsubscribe function.
   * Does NOT replay history — callers should pull history explicitly and
   * then subscribe, to avoid double-delivery.
   */
  subscribe(taskId: string, handler: (evt: TaskStreamEvent) => void): () => void {
    const event = `task:${taskId}`;
    this.on(event, handler);
    return () => this.off(event, handler);
  }

  /** Drop all state for a task (e.g. when cleaning up). */
  forget(taskId: string): void {
    this.buffers.delete(taskId);
  }

  private createBuffer(): TaskBuffer {
    return { history: [], nextId: 0, status: 'pending' };
  }
}

/**
 * Serialize an event as an SSE frame. Each frame includes:
 *
 *   id:   numeric sequence so clients can resume via Last-Event-ID
 *   event: literal `task`
 *   data:  JSON payload (single line)
 *
 * Kept as a free function so the route handler AND tests can share it.
 */
export function formatSseFrame(evt: TaskStreamEvent): string {
  return (
    `id: ${evt.id}\n` +
    `event: task\n` +
    `data: ${JSON.stringify(evt)}\n` +
    `\n`
  );
}

/** Shared singleton so both routes and agent-manager see the same state. */
export const globalTaskStream = new TaskStreamBus();
