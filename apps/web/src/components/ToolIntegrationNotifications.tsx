import { type EnvironmentId, ToolIntegrationId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useEnvironmentSettings } from "../hooks/useSettings";
import { useDismissedProviderUpdateNotificationKeys } from "../providerUpdateDismissal";
import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { toolIntegrationsEnvironment } from "../state/toolIntegrations";
import { TOOL_INTEGRATIONS, toolIntegrationNotice } from "./toolIntegrations";
import { stackedThreadToast, toastManager } from "./ui/toast";

// Once per notice per session, like provider updates; closing it dismisses it for good.
const seenToolIntegrationNotices = new Set<string>();

/**
 * The top-right prompts for added tools whose MCP servers will not connect,
 * built the same way as the provider CLI update prompts.
 */
export function ToolIntegrationNotifications() {
  const primaryEnvironment = usePrimaryEnvironment();
  return primaryEnvironment === null ? null : (
    <EnvironmentToolIntegrationNotifications environmentId={primaryEnvironment.environmentId} />
  );
}

function EnvironmentToolIntegrationNotifications({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const tools = useEnvironmentSettings(environmentId, (settings) => settings.toolIntegrations);
  return ToolIntegrationId.literals
    .filter((id) => tools[id].enabled)
    .map((id) => <ToolIntegrationNotification key={id} environmentId={environmentId} id={id} />);
}

function ToolIntegrationNotification({
  environmentId,
  id,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: ToolIntegrationId;
}) {
  const navigate = useNavigate();
  const status = useEnvironmentQuery(
    toolIntegrationsEnvironment.status({ environmentId, input: { id } }),
  );
  const { dismissedNotificationKeys, dismissNotificationKey } =
    useDismissedProviderUpdateNotificationKeys();
  const notice = status.data === null ? null : toolIntegrationNotice(status.data);

  useEffect(() => {
    if (
      notice === null ||
      dismissedNotificationKeys.has(notice.key) ||
      seenToolIntegrationNotices.has(notice.key)
    ) {
      return;
    }
    seenToolIntegrationNotices.add(notice.key);
    const ToolIcon = TOOL_INTEGRATIONS[id].icon;
    let toastId!: ReturnType<typeof toastManager.add>;
    toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: notice.title,
        description: notice.description,
        timeout: 0,
        actionProps: {
          children: "Settings",
          onClick: () => {
            toastManager.close(toastId);
            void navigate({ to: "/settings/tools" });
          },
        },
        actionVariant: "outline",
        data: {
          leadingIcon: <ToolIcon aria-hidden className="size-4 shrink-0" />,
          hideCopyButton: true,
          onClose: () => dismissNotificationKey(notice.key),
        },
      }),
    );
  }, [dismissNotificationKey, dismissedNotificationKeys, id, navigate, notice]);

  return null;
}
