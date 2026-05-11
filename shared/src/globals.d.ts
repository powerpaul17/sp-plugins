declare const PluginAPI: {
  registerIssueProvider(definition: import('./plugin-api-types').IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};
