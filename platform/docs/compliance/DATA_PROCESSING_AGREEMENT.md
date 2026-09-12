# Data Processing Agreement (Template)

> **Design-input template, not legal advice.** Per architecture reference §9,
> jurisdictional applicability and wording must be confirmed with qualified
> counsel per market before use. Placeholders in `[brackets]`.

**Between** `[Provider Legal Entity]` ("Processor") **and** the customer named in
the Order Form ("Controller").

## 1. Roles
The Controller (typically an agency, acting for its own clients) determines the
purposes and means of processing personal data. The Processor processes personal
data only on documented instructions from the Controller, including the platform
configuration the Controller sets (consent, autonomy levels, retention).

## 2. Subject matter, duration, nature and purpose
Provision of the InfoGenie marketing-intelligence platform: ingestion, identity
resolution, segmentation, content generation, campaign execution and measurement,
for the term of the Order Form plus the retention window in §7.

## 3. Categories of data subject and personal data
Data subjects: the Controller's customers and prospects. Personal data:
identifiers (name, email, phone, device/platform ids), engagement and
behavioural events, and consent state. **Special-category data is out of scope**
unless a specific written instruction and lawful basis are recorded.

## 4. Controller instructions & obligations
The Controller warrants a lawful basis for all personal data it supplies or
directs to be processed (including imported lists — see the attested-lawful-basis
requirement enforced at import), and is responsible for the notices shown to its
data subjects.

## 5. Processor obligations
- Process only on documented instruction; notify if an instruction appears to
  infringe applicable law.
- Confidentiality commitments from all personnel with access.
- Security measures per §8 of the architecture reference (RLS tenant isolation,
  encryption in transit and at rest, tenant-derived key separation, audit rail,
  least privilege, JIT support access).
- Assist the Controller with data-subject requests, DPIAs, and breach
  notification, using platform tooling (DSAR/erasure, records of processing).
- **AI-specific:** client data is not used to train cross-tenant models without
  explicit, revocable consent (§7.5, §9.4); every model provider is a
  sub-processor (§7).

## 6. Sub-processing
The Processor may engage sub-processors listed in the Sub-Processor Register, with
prior notice of additions and a right to object. Each sub-processor is bound by
equivalent obligations.

## 7. Retention & deletion
Personal data is retained per the published retention schedule per data class and
deleted automatically on schedule. On a data-subject erasure or contract end,
deletion propagates to every store within the published window (operational,
warehouse, vector store, caches, logs, backups), evidenced in the audit rail.

## 8. International transfers
Transfer mechanisms are documented per data flow; data-residency options and
model-provider region selection are available where required.

## 9. Audit
The Controller may verify compliance via the Processor's certifications (SOC 2 /
ISO 27001 when available), penetration-test summaries, and the tenant-visible
audit rail and action history.
