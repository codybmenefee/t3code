import { createToolIntegrationEnvironmentAtoms } from "@t3tools/client-runtime/state/tool-integrations";

import { connectionAtomRuntime } from "../connection/runtime";

export const toolIntegrationsEnvironment =
  createToolIntegrationEnvironmentAtoms(connectionAtomRuntime);
