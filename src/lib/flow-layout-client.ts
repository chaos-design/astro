import type { ExecutionTopology } from "../types/trace";
import type { FlowLayout } from "./flow-layout";

export type FlowLayoutWorkerRequest = {
  id: number;
  topology: ExecutionTopology;
};

export type FlowLayoutWorkerResponse =
  | { id: number; layout: FlowLayout }
  | { id: number; error: string };

type PendingLayout = {
  reject: (error: Error) => void;
  resolve: (layout: FlowLayout) => void;
};

let fallbackLayout:
  | Promise<(topology: ExecutionTopology) => FlowLayout>
  | undefined;

export class FlowLayoutClient {
  private nextRequestId = 0;
  private readonly pending = new Map<number, PendingLayout>();
  private worker: Worker | undefined;
  private workerUnavailable = false;

  public layout(topology: ExecutionTopology): Promise<FlowLayout> {
    const worker = this.ensureWorker();
    if (worker === undefined) {
      fallbackLayout ??= import("./flow-layout").then(
        ({ createFlowLayout }) => createFlowLayout,
      );
      return fallbackLayout.then((layout) => layout(topology));
    }

    const id = this.nextRequestId + 1;
    this.nextRequestId = id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      try {
        worker.postMessage({ id, topology } satisfies FlowLayoutWorkerRequest);
      } catch (cause) {
        this.pending.delete(id);
        reject(toError(cause));
      }
    });
  }

  private readonly handleError = (event: ErrorEvent) => {
    const error = new Error(event.message || "Flow layout worker failed.");
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.workerUnavailable = true;
  };

  private readonly handleMessage = (event: MessageEvent<FlowLayoutWorkerResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(response.id);
    if ("layout" in response) {
      pending.resolve(response.layout);
    } else {
      pending.reject(new Error(response.error));
    }
  };

  private ensureWorker(): Worker | undefined {
    if (this.worker !== undefined || this.workerUnavailable) {
      return this.worker;
    }
    if (typeof Worker === "undefined") {
      this.workerUnavailable = true;
      return undefined;
    }
    try {
      this.worker = new Worker(new URL("./flow-layout-worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.addEventListener("error", this.handleError);
      this.worker.addEventListener("message", this.handleMessage);
      return this.worker;
    } catch {
      this.workerUnavailable = true;
      return undefined;
    }
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
