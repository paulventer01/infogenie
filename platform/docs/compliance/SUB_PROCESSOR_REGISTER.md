# Sub-Processor Register (Template)

> Maintained per architecture reference §7.5 / §9.6. **Every model provider is a
> sub-processor.** Notice is given before additions; the register is reviewed
> quarterly and generated from system state where possible. Rows below are
> placeholders showing the required columns — populate per actual deployment.

| Sub-processor | Purpose | Data categories | Region(s) | Security basis | Added |
|---|---|---|---|---|---|
| `[Cloud/Hosting Provider]` | Compute, managed Postgres, object storage | All platform data (encrypted) | `[region]` | SOC 2 / ISO 27001; DPA on file | `[date]` |
| `[LLM Provider A]` | Frontier-model reasoning via the LLM gateway | Prompt context (tenant-scoped, PII-redacted at the gateway) | `[region]` | DPA on file; no-training commitment | `[date]` |
| `[LLM Provider B]` | Small-model routing/classification | Prompt context (redacted) | `[region]` | DPA on file; no-training commitment | `[date]` |
| `[Transactional Email Provider]` | Email delivery | Recipient address, message content | `[region]` | DPA on file | `[date]` |
| `[SMS/WhatsApp Provider]` | Messaging delivery | Phone number, message content | `[region]` | DPA on file | `[date]` |
| `[Enrichment/Data Provider]` | Identity and firmographic enrichment | Identifiers | `[region]` | DPA on file | `[date]` |

## Change control
- Additions: notice to affected Controllers before the sub-processor begins
  processing; objection window per contract.
- Each addition passes a vendor/model-provider security assessment (§9.6) before
  go-live.
- Removal or replacement is recorded with date and reason.

## AI-provider specifics
Model providers must contractually commit that customer prompt/response data is
**not** used to train their models, consistent with the platform's own
cross-tenant training boundary (§7.5). A provider unable to make that commitment
is not eligible as a sub-processor for tenant-scoped generation paths.
