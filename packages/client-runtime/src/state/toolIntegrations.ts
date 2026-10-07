import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";

/** Status and actions for the vendor CLIs and skills T3 Code manages on an environment. */
export function createToolIntegrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:tool-integrations:status",
      tag: WS_METHODS.toolIntegrationStatus,
    }),
    // The server runs one vendor command at a time; the client queues to match.
    run: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tool-integrations:run",
      tag: WS_METHODS.toolIntegrationRun,
      scheduler: createAtomCommandScheduler(),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
  };
}
