import { type EnvironmentId, ToolIntegrationId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GlobeIcon, Settings2Icon } from "lucide-react";
import { memo } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { TOOL_INTEGRATIONS } from "../toolIntegrations";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  ComposerControl,
  ComposerControlIcon,
  type ComposerControlSize,
  ComposerControlSeparator,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

const BUILT_IN = "builtin";

/**
 * The environment's web tools as the composer offers them: each added tool,
 * then Built-in. Picking one sets the default web tool for new sessions.
 */
export function useComposerWebTools(environmentId: EnvironmentId) {
  const tools = useEnvironmentSettings(environmentId, (settings) => settings.toolIntegrations);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "set web tool",
  });
  const added = ToolIntegrationId.literals.filter((id) => tools[id].enabled);
  const current =
    tools.defaultWebTool !== null && tools[tools.defaultWebTool].enabled
      ? tools.defaultWebTool
      : null;
  const select = (value: string) => {
    const next = added.find((id) => id === value) ?? null;
    if (next === current) return;
    void updateSettings({
      environmentId,
      input: { patch: { toolIntegrations: { defaultWebTool: next } } },
    });
  };
  return { added, current, select };
}

/** The web tool choices, shared by the picker and the composer's overflow menu. */
export function ComposerWebToolMenuItems({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { added, current, select } = useComposerWebTools(environmentId);
  const navigate = useNavigate();
  return (
    <>
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Web provider</div>
      <MenuRadioGroup value={current ?? BUILT_IN} onValueChange={(value) => select(String(value))}>
        {added.map((id) => {
          const { label, icon: ToolIcon } = TOOL_INTEGRATIONS[id];
          return (
            <MenuRadioItem key={id} value={id} closeOnClick>
              <span className="flex items-center gap-2">
                <ToolIcon aria-hidden className="size-3.5 shrink-0" />
                {label}
              </span>
            </MenuRadioItem>
          );
        })}
        <MenuRadioItem value={BUILT_IN} closeOnClick>
          <span className="flex items-center gap-2">
            <GlobeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            Built-in
          </span>
        </MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem onClick={() => void navigate({ to: "/settings/tools" })}>
        <span className="flex items-center gap-2">
          <Settings2Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          Manage tools
        </span>
      </MenuItem>
    </>
  );
}

/**
 * Shows which web tool new sessions use first, as its logo alone, and switches
 * it. Renders nothing until a web tool is added, so composers without one stay
 * unchanged.
 */
export const ComposerWebToolPicker = memo(function ComposerWebToolPicker({
  environmentId,
  size = "sm",
  hidden = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly size?: ComposerControlSize;
  readonly hidden?: boolean;
}) {
  const { added, current } = useComposerWebTools(environmentId);
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(hidden);
  if (added.length === 0) return null;
  const tool = current === null ? null : TOOL_INTEGRATIONS[current];
  const label = tool?.label ?? "Built-in";

  return (
    <>
      <ComposerControlSeparator size={size} />
      <Menu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <ComposerControl
                    size={size}
                    className="shrink-0"
                    aria-label={`Web: ${label}`}
                    data-chat-web-tool-picker="true"
                  />
                }
              />
            }
          >
            <ComposerControlIcon icon={tool?.icon ?? GlobeIcon} size={size} />
          </TooltipTrigger>
          <TooltipPopup side="top">Web: {label}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="start" {...composerFloatingLayerProps}>
          <ComposerWebToolMenuItems environmentId={environmentId} />
        </MenuPopup>
      </Menu>
    </>
  );
});
