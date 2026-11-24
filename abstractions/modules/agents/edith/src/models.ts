import type { CredentialStore, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { providers as aiMopProviders } from "./ai-mop/providers.ts";

export function edithModels(credentials: CredentialStore): MutableModels {
  const models = builtinModels({ credentials });
  for (const provider of aiMopProviders()) models.setProvider(provider);
  return models;
}
