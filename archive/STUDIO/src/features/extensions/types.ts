/** Shared types for the extensions (Apps) feature. */

export interface AddFormState {
  name:        string;
  displayName: string;
  type:        "local" | "remote";
  command:     string;
  args:        string;
  envVars:     string;
  endpointUrl: string;
  authToken:   string;
}
