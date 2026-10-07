import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ToolIntegrationAction,
  ToolIntegrationId,
  type ToolIntegrationSettingsPatch,
  type ToolIntegrationStatus,
} from "@t3tools/contracts";
import { ExternalLinkIcon, GlobeIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { toolIntegrationsEnvironment } from "../../state/toolIntegrations";
import { useAtomCommand } from "../../state/use-atom-command";
import { type ToolGroupView, toolGroupViews, TOOL_INTEGRATIONS } from "../toolIntegrations";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { AddToolDialog } from "./AddToolDialog";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

const TOOL_IDS = ToolIntegrationId.literals;
/** How often the page re-checks while a browser sign-in is out. */
const SIGN_IN_POLL_MS = 2_000;

export function ToolsSettingsPanel() {
  const { environment, scope } = useSettingsScope();
  const environmentId =
    environment?.connection.phase === "connected" ? environment.environmentId : null;
  // Tools attach per machine; a project scope shows them without changing them.
  const readOnly = scope.kind === "project" || scope.kind === "checkout";

  return (
    <SettingsPageContainer width="wide" className="@container/tools gap-8">
      {environment === null || environmentId === null ? (
        <SettingsSection title="Tools">
          <SettingsRow
            title="No environment connected"
            description="Connect an environment to manage its tools."
          />
        </SettingsSection>
      ) : (
        <Tools
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment.label}
          readOnly={readOnly}
        />
      )}
    </SettingsPageContainer>
  );
}

/** The Providers page card height, so the two pages read as one. */
const TOOL_CARD_HEIGHT =
  "@min-[48rem]/tools:h-[min(44rem,calc(100dvh-11rem))] @min-[48rem]/tools:min-h-[32rem]";

function Tools({
  environmentId,
  environmentLabel,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly readOnly: boolean;
}) {
  const tools = useEnvironmentSettings(environmentId, (settings) => settings.toolIntegrations);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update tools",
  });
  const [picked, setPicked] = useState<ToolIntegrationId | "builtin">(TOOL_IDS[0]);
  const [adding, setAdding] = useState(false);
  const patchTools = (patch: ToolIntegrationSettingsPatch) =>
    updateSettings({ environmentId, input: { patch: { toolIntegrations: patch } } });
  const setEnabled = (id: ToolIntegrationId, enabled: boolean) =>
    patchTools({
      [id]: { enabled },
      // A removed tool cannot stay the default; Built-in takes over.
      ...(!enabled && tools.defaultWebTool === id ? { defaultWebTool: null } : {}),
    });
  const addable = TOOL_IDS.filter((id) => !tools[id].enabled);
  // First-party tools always show; others show once added and leave when removed.
  const listed = TOOL_IDS.filter((id) => TOOL_INTEGRATIONS[id].firstParty || tools[id].enabled);
  const selected = picked === "builtin" || listed.includes(picked) ? picked : TOOL_IDS[0];
  const setSelected = setPicked;
  // A default only counts while its tool is enabled; otherwise Built-in is the default.
  const defaultTool =
    tools.defaultWebTool !== null && tools[tools.defaultWebTool].enabled
      ? tools.defaultWebTool
      : null;

  return (
    <SettingsSection
      {...searchableSetting("web-tools")}
      variant="plain"
      headerAction={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={readOnly || addable.length === 0}
                onClick={() => setAdding(true)}
                aria-label="Add tool"
              >
                <PlusIcon />
              </Button>
            }
          />
          <TooltipPopup side="top">
            {addable.length === 0 ? "Every available tool is added" : "Add tool"}
          </TooltipPopup>
        </Tooltip>
      }
    >
      {readOnly ? (
        <p className="px-1 text-xs text-muted-foreground/80">
          Tools apply per environment. Select the environment to make changes.
        </p>
      ) : null}
      <SettingsGroup
        divided={false}
        inert={readOnly}
        className={cn(
          TOOL_CARD_HEIGHT,
          "overflow-hidden @min-[48rem]/tools:grid @min-[48rem]/tools:grid-cols-[17rem_minmax(0,1fr)]",
        )}
      >
        <div className="border-b border-border/60 bg-muted/10 @min-[48rem]/tools:flex @min-[48rem]/tools:min-h-0 @min-[48rem]/tools:flex-col @min-[48rem]/tools:border-r @min-[48rem]/tools:border-b-0">
          <ScrollArea
            scrollFade
            chainVerticalScroll
            className="@min-[48rem]/tools:min-h-0 @min-[48rem]/tools:flex-1"
          >
            <ul aria-label="Tools" className="divide-y divide-border/50">
              {listed.map((id) => (
                <ToolRow
                  key={id}
                  environmentId={environmentId}
                  id={id}
                  added={tools[id].enabled}
                  isDefault={defaultTool === id}
                  selected={selected === id}
                  onSelect={() => setSelected(id)}
                  onAdd={() => {
                    void setEnabled(id, true);
                    setSelected(id);
                  }}
                />
              ))}
              <BuiltinRow
                isDefault={defaultTool === null}
                selected={selected === "builtin"}
                onSelect={() => setSelected("builtin")}
              />
            </ul>
          </ScrollArea>
        </div>
        <div className="min-w-0 @min-[48rem]/tools:min-h-0">
          <ScrollArea scrollFade chainVerticalScroll className="@min-[48rem]/tools:h-full">
            <div className="space-y-6 p-4">
              {selected === "builtin" ? (
                <BuiltinPane
                  isDefault={defaultTool === null}
                  onMakeDefault={() => void patchTools({ defaultWebTool: null })}
                />
              ) : tools[selected].enabled ? (
                <ToolPane
                  key={selected}
                  environmentId={environmentId}
                  id={selected}
                  isDefault={defaultTool === selected}
                  enabledToolGroups={tools[selected].enabledToolGroups}
                  onToggleGroups={(groups) =>
                    void patchTools({ [selected]: { enabledToolGroups: [...groups] } })
                  }
                  onSetDefault={() => void patchTools({ defaultWebTool: selected })}
                  onRemove={() => void setEnabled(selected, false)}
                />
              ) : (
                <NotAddedPane id={selected} onAdd={() => void setEnabled(selected, true)} />
              )}
            </div>
          </ScrollArea>
        </div>
      </SettingsGroup>
      <AddToolDialog
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        addable={addable}
        open={adding}
        onOpenChange={setAdding}
        onAdded={(id) => {
          void setEnabled(id, true);
          setSelected(id);
        }}
      />
    </SettingsSection>
  );
}

function useToolStatus(environmentId: EnvironmentId, id: ToolIntegrationId, added: boolean) {
  return useEnvironmentQuery(
    added ? toolIntegrationsEnvironment.status({ environmentId, input: { id } }) : null,
  );
}

const AUTH_LABELS: Record<ToolIntegrationStatus["auth"], string> = {
  keyless: "Keyless",
  apiKey: "API key",
  oauth: "Authenticated",
  none: "Needs an API key",
};

function connectionSummary(status: ToolIntegrationStatus | null): string {
  if (status === null) return "Checking…";
  const auth = AUTH_LABELS[status.auth];
  switch (status.connection.state) {
    case "connected":
      return auth;
    case "unauthorized":
      if (status.auth === "none") return auth;
      return status.auth === "keyless" ? "Needs a key or sign-in" : "Needs sign-in";
    case "unreachable":
    case "error":
      return "Not connecting";
  }
}

function ToolRow({
  environmentId,
  id,
  added,
  isDefault,
  selected,
  onSelect,
  onAdd,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: ToolIntegrationId;
  readonly added: boolean;
  readonly isDefault: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onAdd: () => void;
}) {
  const { label, icon: ToolIcon } = TOOL_INTEGRATIONS[id];
  const status = useToolStatus(environmentId, id, added);
  const needsAttention = status.data !== null && status.data.connection.state !== "connected";

  return (
    <li
      className={cn(
        "group relative flex min-h-18 items-center gap-3 px-3 py-3 transition-colors sm:px-4",
        selected ? "bg-muted/45" : "hover:bg-muted/25",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onSelect}
        aria-label={`Select ${label}`}
        aria-pressed={selected}
      />
      {added ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onAdd}
                aria-label={`Add ${label}`}
                className="relative grid size-5 shrink-0 place-items-center rounded-md bg-primary/15 text-primary outline-none hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PlusIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">Add {label}</TooltipPopup>
        </Tooltip>
      )}
      <span
        className={cn(
          "pointer-events-none flex min-w-0 flex-1 items-start gap-3",
          !added && !selected && "opacity-60 group-hover:opacity-100",
        )}
      >
        <ToolIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{label}</span>
            {added && status.data?.connection.serverVersion ? (
              <code className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                v{status.data.connection.serverVersion}
              </code>
            ) : null}
            {isDefault ? <DefaultBadge /> : null}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-xs",
              needsAttention ? "text-warning" : "text-muted-foreground/80",
            )}
          >
            {added ? connectionSummary(status.data) : "Not added"}
          </span>
        </span>
      </span>
    </li>
  );
}

function ToolGroups({
  label,
  groups,
  onToggle,
}: {
  readonly label: string;
  readonly groups: ReadonlyArray<ToolGroupView>;
  readonly onToggle: (group: string, on: boolean) => void;
}) {
  const on = groups.filter((group) => group.enabled).map((group) => group.label);
  return (
    <FoldedSettingsSection
      id="web-tools-groups"
      title="Tools"
      summary={on.length === 0 ? "None on" : on.join(", ")}
    >
      <ul aria-label={`${label} tool groups`} className="divide-y divide-border/50">
        {groups.map((group) => (
          <li key={group.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{group.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {group.available
                  ? group.description
                  : `${group.description} Needs an API key or sign-in.`}
              </p>
            </div>
            {group.id === "other" ? null : (
              <Switch
                className="mt-0.5"
                checked={group.enabled}
                onCheckedChange={(on) => onToggle(group.id, on)}
                aria-label={`${group.label} tools`}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground/80">
        Cursor sessions get every tool.
      </p>
    </FoldedSettingsSection>
  );
}

function DefaultBadge() {
  return (
    <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-px text-2xs font-semibold text-primary">
      Default
    </span>
  );
}

/** The agents' own web tools: always on, so the fallback, and the default when no tool is. */
function BuiltinRow({
  isDefault,
  selected,
  onSelect,
}: {
  readonly isDefault: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <li
      className={cn(
        "group relative flex min-h-18 items-center gap-3 px-3 py-3 transition-colors sm:px-4",
        selected ? "bg-muted/45" : "hover:bg-muted/25",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onSelect}
        aria-label="Select Built-in"
        aria-pressed={selected}
      />
      <span className="pointer-events-none flex min-w-0 flex-1 items-start gap-3">
        <GlobeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">Built-in</span>
            {isDefault ? <DefaultBadge /> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
            {isDefault ? "Agents' own web tools" : "Fallback"}
          </span>
        </span>
      </span>
    </li>
  );
}

function BuiltinPane({
  isDefault,
  onMakeDefault,
}: {
  readonly isDefault: boolean;
  readonly onMakeDefault: () => void;
}) {
  return (
    <SettingsSection
      title="Built-in"
      icon={<GlobeIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      headerAction={
        isDefault ? (
          <DefaultBadge />
        ) : (
          <Button size="xs" variant="outline" onClick={onMakeDefault}>
            Make default
          </Button>
        )
      }
    >
      <SettingsRow
        title="Agents' own web tools"
        description={
          isDefault
            ? "Agents use their own web search and fetch."
            : "Used when the default tool is unavailable."
        }
      />
    </SettingsSection>
  );
}

/** The pane's first section, headed like a provider's editor: icon, name, state, actions. */
function PaneSection({
  id,
  state,
  action,
  children,
}: {
  readonly id: ToolIntegrationId;
  readonly state: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const { label, icon: ToolIcon, docs } = TOOL_INTEGRATIONS[id];
  return (
    <SettingsSection
      title={label}
      icon={<ToolIcon aria-hidden className="size-4 shrink-0" />}
      headerAction={
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-primary/12 px-2 py-0.5 text-2xs font-semibold text-primary">
            {state}
          </span>
          {action}
          <InlineButton
            className="text-xs"
            render={<a href={docs} target="_blank" rel="noreferrer noopener" />}
          >
            Docs
            <ExternalLinkIcon aria-hidden className="size-3" />
          </InlineButton>
        </div>
      }
    >
      {children}
    </SettingsSection>
  );
}

function NotAddedPane({
  id,
  onAdd,
}: {
  readonly id: ToolIntegrationId;
  readonly onAdd: () => void;
}) {
  const { label, description, keylessNote } = TOOL_INTEGRATIONS[id];
  return (
    <PaneSection id={id} state="Not added">
      <SettingsRow
        title={`Add ${label}`}
        description={keylessNote === null ? description : `${description} ${keylessNote}`}
        control={
          <Button size="xs" onClick={onAdd}>
            <PlusIcon className="size-3" />
            Add
          </Button>
        }
      />
    </PaneSection>
  );
}

const openExternally = async (url: string) => {
  const localApi = readLocalApi();
  if (localApi) await localApi.shell.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
};

function ToolPane({
  environmentId,
  id,
  isDefault,
  enabledToolGroups,
  onToggleGroups,
  onSetDefault,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: ToolIntegrationId;
  readonly isDefault: boolean;
  readonly enabledToolGroups: ReadonlyArray<string> | null;
  readonly onToggleGroups: (groups: ReadonlyArray<string>) => void;
  readonly onSetDefault: () => void;
  readonly onRemove: () => void;
}) {
  const { label, apiKeyLink, keylessNote, signIn, firstParty } = TOOL_INTEGRATIONS[id];
  const status = useToolStatus(environmentId, id, true);
  const run = useAtomCommand(toolIntegrationsEnvironment.run, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Only a check the user asked for shows as busy; background re-checks stay quiet.
  const [checkRequestedAt, setCheckRequestedAt] = useState<number | null>(null);
  const data = status.data;
  const { refresh } = status;
  const checking = checkRequestedAt !== null && status.dataUpdatedAt < checkRequestedAt;

  // Re-check while a browser sign-in is out, so the page flips when it lands.
  const signInPending = data?.signInPending ?? false;
  useEffect(() => {
    if (!signInPending) return;
    const timer = window.setInterval(refresh, SIGN_IN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, signInPending]);

  const act = async (key: string, action: ToolIntegrationAction) => {
    setPending(key);
    try {
      const result = await run({ environmentId, input: { id, action } });
      if (result._tag === "Success") {
        if (result.value.authorizationUrl !== null) {
          await openExternally(result.value.authorizationUrl);
        }
        refresh();
        return true;
      }
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `${label} could not finish that`,
        description: failure instanceof Error ? failure.message : "Try again.",
      });
      return false;
    } finally {
      setPending(null);
    }
  };
  const busy = pending !== null;

  if (data === null) {
    return (
      <PaneSection id={id} state="Checking">
        <SettingsRow
          title="Connection"
          description={status.error ?? `Connecting to ${label}'s server…`}
        />
      </PaneSection>
    );
  }

  const connected = data.connection.state === "connected";
  const groups = toolGroupViews(id, data.connection.tools, enabledToolGroups);
  return (
    <>
      <PaneSection
        id={id}
        state={connected ? "Connected" : data.auth === "none" ? "Not set up" : "Not connecting"}
        action={
          isDefault ? (
            <DefaultBadge />
          ) : (
            <Button size="xs" onClick={onSetDefault}>
              Set as default
            </Button>
          )
        }
      >
        <SettingsRow
          title="Connection"
          description={
            connected
              ? `${connectionSummary(data)}. Applies to new sessions.`
              : (data.connection.message ?? `${label}'s server is not answering.`)
          }
          control={
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={checking}
              onClick={() => {
                setCheckRequestedAt(Date.now());
                refresh();
              }}
            >
              <RefreshCwIcon className={cn("size-3", checking && "animate-spin")} />
              Check again
            </Button>
          }
        />
      </PaneSection>
      {connected ? (
        <ToolGroups
          label={label}
          groups={groups}
          onToggle={(group, on) =>
            onToggleGroups(
              groups
                .filter((view) => view.id !== "other" && (view.id === group ? on : view.enabled))
                .map((view) => view.id),
            )
          }
        />
      ) : null}
      <SettingsSection title="Account">
        {signIn ? (
          <SettingsRow
            title={`Sign in with ${label}`}
            description={
              data.auth === "oauth"
                ? `Using your ${label} account.`
                : data.signInPending
                  ? "Finish signing in in your browser."
                  : "Optional. Overrides the API key."
            }
            control={
              data.auth === "oauth" ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act("signOut", { _tag: "SignOut" })}
                >
                  Sign out
                </Button>
              ) : (
                <Button
                  size="xs"
                  // A closed browser tab must not strand the user: signing in again starts over.
                  disabled={busy}
                  onClick={() => void act("signIn", { _tag: "StartSignIn" })}
                >
                  {pending === "signIn" ? <Spinner className="size-3" /> : null}
                  {data.signInPending ? "Restart sign-in" : "Sign in"}
                </Button>
              )
            }
          />
        ) : null}
        <SettingsRow
          title="API key"
          description={
            <>
              {data.apiKeySaved
                ? data.auth === "oauth"
                  ? "Stored. Used when signed out."
                  : "Stored."
                : keylessNote !== null
                  ? "Optional. Unlocks every tool."
                  : signIn
                    ? "Required unless signed in."
                    : "Required."}{" "}
              <InlineButton
                render={<a href={apiKeyLink} target="_blank" rel="noreferrer noopener" />}
              >
                Get an API key
                <ExternalLinkIcon aria-hidden className="size-3" />
              </InlineButton>
            </>
          }
        >
          <form
            className="flex max-w-2xl items-center gap-2 pb-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              const key = draft.trim();
              if (key === "") return;
              void act("apiKey", { _tag: "SaveApiKey", key }).then((saved) => {
                if (saved) setDraft("");
              });
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              size="sm"
              aria-label={`${label} API key`}
              placeholder={data.apiKeySaved ? "Paste a new key to replace" : "Paste API key"}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
            {data.apiKeySaved ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void act("apiKey", { _tag: "SaveApiKey", key: "" })}
              >
                Remove
              </Button>
            ) : null}
            <Button type="submit" size="xs" disabled={busy || draft.trim() === ""}>
              Save
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>
      <SettingsGroup>
        <SettingsRow
          title={`Remove ${label}`}
          description={
            firstParty
              ? "New sessions stop using it. Its key and sign-in stay stored."
              : `New sessions stop using it, and its key${signIn ? " and sign-in are" : " is"} deleted.`
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  // Only first-party tools keep their credential after removal.
                  if (!firstParty) {
                    if (!(await act("remove", { _tag: "SaveApiKey", key: "" }))) return;
                    if (signIn && !(await act("remove", { _tag: "SignOut" }))) return;
                  }
                  onRemove();
                })()
              }
            >
              Remove
            </Button>
          }
        />
      </SettingsGroup>
    </>
  );
}
