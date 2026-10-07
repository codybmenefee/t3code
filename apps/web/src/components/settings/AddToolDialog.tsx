import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, ToolIntegrationId } from "@t3tools/contracts";
import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { toolIntegrationsEnvironment } from "../../state/toolIntegrations";
import { useAtomCommand } from "../../state/use-atom-command";
import { TOOL_INTEGRATIONS } from "../toolIntegrations";
import { Button, InlineButton } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "../ui/wizard";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./settingsLayout";

const STEPS = ["Tool", "Connect"] as const;

/**
 * The Tools page's add flow, shaped like Add provider: pick a tool, then give
 * it the credential it needs. The tool joins the list once it is added.
 */
export function AddToolDialog({
  environmentId,
  environmentLabel,
  addable,
  open,
  onOpenChange,
  onAdded,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly addable: ReadonlyArray<ToolIntegrationId>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdded: (id: ToolIntegrationId) => void;
}) {
  const run = useAtomCommand(toolIntegrationsEnvironment.run, { reportFailure: false });
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<ToolIntegrationId | null>(null);
  // The list shrinks as tools are added, so a stale pick falls back to the first one left.
  const choice = picked !== null && addable.includes(picked) ? picked : (addable[0] ?? null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const tool = choice === null ? null : TOOL_INTEGRATIONS[choice];
  // A tool that runs keyless or signs in can be added now and connected from its page.
  const keyRequired = tool !== null && tool.keylessNote === null && !tool.signIn;

  const close = (next: boolean) => {
    if (saving) return;
    onOpenChange(next);
    if (!next) {
      setStep(0);
      setKey("");
    }
  };

  const add = async () => {
    if (choice === null || tool === null) return;
    const trimmed = key.trim();
    if (trimmed !== "") {
      setSaving(true);
      const result = await run({
        environmentId,
        input: { id: choice, action: { _tag: "SaveApiKey", key: trimmed } },
      });
      setSaving(false);
      if (result._tag !== "Success") {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: `Could not save the ${tool.label} API key`,
          description: failure instanceof Error ? failure.message : "Try again.",
        });
        return;
      }
    }
    onAdded(choice);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <WizardPopup>
        <WizardHeader
          title="Add tool"
          description={<>Add a web tool to sessions on {environmentLabel}.</>}
        >
          <WizardSteps
            steps={STEPS}
            currentStep={step}
            summaries={[tool?.label ?? null, null]}
            isStepDisabled={(index) => saving || (index > 0 && choice === null)}
            onStepChange={setStep}
          />
        </WizardHeader>
        <WizardPanel>
          {step === 0 ? (
            addable.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every available tool is added.</p>
            ) : (
              <div className="grid gap-2">
                <div id="add-tool-label" className="text-sm font-medium text-foreground">
                  Tool
                </div>
                <RadioGroup
                  value={choice}
                  onValueChange={(value) =>
                    setPicked(ToolIntegrationId.literals.find((id) => id === value) ?? null)
                  }
                  aria-labelledby="add-tool-label"
                  className="grid grid-cols-1 sm:grid-cols-2"
                >
                  {addable.map((id) => {
                    const { label, icon: ToolIcon, description } = TOOL_INTEGRATIONS[id];
                    return (
                      <RadioPrimitive.Root
                        key={id}
                        value={id}
                        className="relative flex cursor-pointer items-start gap-3 rounded-lg bg-card px-3 py-3 text-left text-muted-foreground outline-none ring-1 ring-black/5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary/8 data-checked:text-foreground data-checked:ring-2 data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15"
                      >
                        <ToolIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {label}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {description}
                          </span>
                        </span>
                        <RadioPrimitive.Indicator
                          className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                          aria-hidden
                        >
                          <CheckIcon className="size-3.5 shrink-0" />
                        </RadioPrimitive.Indicator>
                      </RadioPrimitive.Root>
                    );
                  })}
                </RadioGroup>
              </div>
            )
          ) : tool === null ? null : (
            <SettingsGroup variant="plain">
              <SettingsRow
                title={<label htmlFor="add-tool-api-key">{tool.label} API key</label>}
                description={
                  <>
                    {tool.keylessNote !== null
                      ? "Optional. Unlocks every tool."
                      : tool.signIn
                        ? "Optional. You can sign in after adding instead."
                        : "Required."}{" "}
                    <InlineButton
                      render={
                        <a href={tool.apiKeyLink} target="_blank" rel="noreferrer noopener" />
                      }
                    >
                      Get an API key
                      <ExternalLinkIcon aria-hidden className="size-3" />
                    </InlineButton>
                  </>
                }
              >
                <form
                  className="pb-3.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!keyRequired || key.trim() !== "") void add();
                  }}
                >
                  <Input
                    id="add-tool-api-key"
                    type="password"
                    autoComplete="off"
                    size="sm"
                    placeholder="Paste API key"
                    value={key}
                    disabled={saving}
                    onChange={(event) => setKey(event.target.value)}
                  />
                </form>
              </SettingsRow>
            </SettingsGroup>
          )}
        </WizardPanel>
        <WizardFooter>
          <Button
            variant={step === 0 ? "ghost-muted" : "outline"}
            size="sm"
            disabled={saving}
            onClick={() => (step === 0 ? close(false) : setStep(0))}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step === 0 ? (
            <Button size="sm" disabled={choice === null} onClick={() => setStep(1)}>
              Next
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={saving || (keyRequired && key.trim() === "")}
              onClick={() => void add()}
            >
              {saving ? <Spinner className="size-3" /> : null}
              Add {tool?.label}
            </Button>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
