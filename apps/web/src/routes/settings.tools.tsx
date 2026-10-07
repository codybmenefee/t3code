import { createFileRoute } from "@tanstack/react-router";

import { ToolsSettingsPanel } from "../components/settings/ToolsSettings";

export const Route = createFileRoute("/settings/tools")({
  component: ToolsSettingsPanel,
});
