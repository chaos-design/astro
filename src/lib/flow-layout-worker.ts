import { createFlowLayout } from "./flow-layout";
import type {
  FlowLayoutWorkerRequest,
  FlowLayoutWorkerResponse,
} from "./flow-layout-client";

const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<FlowLayoutWorkerRequest>) => void,
  ): void;
  postMessage(message: FlowLayoutWorkerResponse): void;
};

workerScope.addEventListener("message", (event) => {
  try {
    workerScope.postMessage({
      id: event.data.id,
      layout: createFlowLayout(event.data.topology),
    });
  } catch (cause) {
    workerScope.postMessage({
      error: cause instanceof Error ? cause.message : String(cause),
      id: event.data.id,
    });
  }
});
