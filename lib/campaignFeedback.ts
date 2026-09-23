/** Display-only guidance. Validation and spending authority stay on the server. */
export function campaignValidationMessage(error: { code?: string; field?: string }): string {
  if (error.code === "missing_credentials") {
    if (error.field === "accounts.meta") {
      return "Meta advertising credentials were not found for the account used to validate this draft. Check Meta Ads Manager in Settings & Integrations, or ask an administrator for help. Fixture research does not establish this connection. You can still preview the saved draft; adding AI credits will not resolve this error.";
    }
    return "Advertising credentials could not be verified for this draft. Check the connected advertising account in Settings & Integrations, or ask an administrator for help. You can still preview the saved draft.";
  }
  return `${(error.code || "Validation issue").replaceAll("_", " ")}${error.field ? ` (${error.field})` : ""}`;
}
