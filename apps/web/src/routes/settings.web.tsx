import { createFileRoute } from "@tanstack/react-router";

import { WebSettingsPanel } from "../components/settings/WebSettings";

export const Route = createFileRoute("/settings/web")({
  component: WebSettingsPanel,
});
