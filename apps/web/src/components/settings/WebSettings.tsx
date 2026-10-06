import {
  DEFAULT_WEB_TOOL_PROVIDER,
  WebToolProvider,
  type EnvironmentId,
  type WebSettings,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useUpdateScopedSettings } from "./useScopedSettings";

type ApiProvider = Exclude<WebToolProvider, "builtin">;

const PROVIDER_LABELS: Record<WebToolProvider, string> = {
  firecrawl: "Firecrawl",
  exa: "Exa",
  tavily: "Tavily",
  builtin: "Built-in",
};

const API_KEYS: Record<
  ApiProvider,
  {
    readonly field: "firecrawlApiKey" | "exaApiKey" | "tavilyApiKey";
    readonly description: string;
    readonly link: string;
  }
> = {
  firecrawl: {
    field: "firecrawlApiKey",
    description:
      "Optional. Without a key, Firecrawl's keyless tier is used on eligible networks; a key raises the rate limits.",
    link: "https://www.firecrawl.dev/app/api-keys",
  },
  exa: {
    field: "exaApiKey",
    description: "Required for Exa.",
    link: "https://dashboard.exa.ai/api-keys",
  },
  tavily: {
    field: "tavilyApiKey",
    description: "Required for Tavily.",
    link: "https://app.tavily.com/home",
  },
};

function WebProviderRow() {
  const { targets } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const providers = new Set(targets.map((target) => target.settings.web.provider));
  const provider = providers.size === 1 ? [...providers][0]! : null;

  return (
    <SettingsRow
      serverScoped
      settingKeys={["web"]}
      {...searchableSetting("web-provider")}
      description="The service behind the web_search and web_fetch tools T3 Code gives every agent. Built-in leaves each CLI on its own web tools."
      resetAction={
        provider !== DEFAULT_WEB_TOOL_PROVIDER ? (
          <SettingResetButton
            label="web provider"
            onClick={() => updateSettings({ web: { provider: DEFAULT_WEB_TOOL_PROVIDER } })}
          />
        ) : null
      }
      control={
        <Select
          value={provider}
          onValueChange={(value) => {
            if (WebToolProvider.literals.includes(value as WebToolProvider)) {
              updateSettings({ web: { provider: value as WebToolProvider } });
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Web provider">
            <SelectValue>
              {(value: WebToolProvider | null) =>
                value === null ? "Mixed" : PROVIDER_LABELS[value]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WebToolProvider.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {value === DEFAULT_WEB_TOOL_PROVIDER
                  ? `${PROVIDER_LABELS[value]} (default)`
                  : PROVIDER_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/**
 * The selected provider's API key on one environment. Keys are write-only: the
 * server keeps them in its secret store and only reports whether one is set.
 */
function WebApiKeyRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const saved = useEnvironmentSettings(environmentId, (settings) => settings.web);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save web provider API key",
  });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  if (saved.provider === "builtin") return null;
  const info = API_KEYS[saved.provider];
  const isSaved = saved[info.field].length > 0;
  const label = PROVIDER_LABELS[saved.provider];

  const save = async (key: string) => {
    setSaving(true);
    try {
      const patch: Partial<WebSettings> = { [info.field]: key };
      const result = await updateSettings({ environmentId, input: { patch: { web: patch } } });
      if (result._tag === "Success") setDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("web-provider-api-key")}
      title={`${label} API key`}
      description={
        <>
          {info.description}{" "}
          <InlineButton render={<a href={info.link} target="_blank" rel="noreferrer noopener" />}>
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
          if (draft.trim()) void save(draft.trim());
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          size="sm"
          aria-label={`${label} API key`}
          placeholder={isSaved ? "Stored secret, enter a new value to replace" : "Not set"}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
        {isSaved ? (
          <Button size="xs" variant="outline" disabled={saving} onClick={() => void save("")}>
            Remove
          </Button>
        ) : null}
        <Button type="submit" size="xs" disabled={saving || draft.trim() === ""}>
          Save
        </Button>
      </form>
    </SettingsRow>
  );
}

export function WebSettingsPanel() {
  const { environment } = useSettingsScope();
  const environmentId =
    environment?.connection.phase === "connected" ? environment.environmentId : null;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Web provider">
        <WebProviderRow />
        {environmentId === null ? null : (
          // Drafts belong to one environment; switching must not carry them over.
          <WebApiKeyRow key={environmentId} environmentId={environmentId} />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
