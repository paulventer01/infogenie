        OR parent.capability_id IS DISTINCT FROM NEW.capability_id
        OR parent.account_fingerprint IS DISTINCT FROM NEW.account_fingerprint
      THEN RAISE EXCEPTION 'orchestrator_gapdobj_operation_lineage';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_gapdobj_guard ON orchestrator_google_ads_provider_draft_objects;
    CREATE TRIGGER orchestrator_gapdobj_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_provider_draft_objects FOR EACH ROW EXECUTE FUNCTION orchestrator_gapdobj_guard();
  `);

  // PR10C.1 — tenant-leading Google Ads reconciliation read-authorizations.
  // Consume-once GET-only observation grant bound to one PR10B operation and
  // its three PAUSED objects. First-issuance only; no review-closure columns,
  // no runs table, no secrets or raw account identifiers.
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_fp', 'tenant_id, id, account_fingerprint');
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_snap', 'tenant_id, id, snapshot_hash');
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_cap', 'tenant_id, id, capability_id');
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_cred',
    'tenant_id, id, credential_ref_id, credential_ref_version, account_fingerprint');
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_reconciliation_read_authorizations(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      nonce_hash TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      expected_object_kinds TEXT[] NOT NULL
        DEFAULT ARRAY['campaign_budget','campaign','ad_group']::TEXT[],
      status TEXT NOT NULL DEFAULT 'issued',
      invocation_id_hash TEXT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      reserved_at TIMESTAMPTZ NULL,
      consumed_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      audit_ref TEXT NOT NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_garr_tenant_unique_nonce UNIQUE(tenant_id,nonce_hash),
      CONSTRAINT orchestrator_garr_tenant_unique_audit UNIQUE(tenant_id,audit_ref),
      CONSTRAINT orchestrator_garr_tenant_unique_operation_ledger
        UNIQUE(tenant_id,operation_id,ledger_root_hash),
      CONSTRAINT orchestrator_garr_status_check
        CHECK(status IN ('issued','reserved','consumed','revoked','expired')),
      CONSTRAINT orchestrator_garr_kinds_check CHECK(
        expected_object_kinds = ARRAY['campaign_budget','campaign','ad_group']::TEXT[]),
      CONSTRAINT orchestrator_garr_hashes_check CHECK(
        nonce_hash~'^[0-9a-f]{64}$' AND session_id_hash~'^[0-9a-f]{64}$'
        AND snapshot_hash~'^[0-9a-f]{64}$' AND intent_hash~'^[0-9a-f]{64}$'
        AND account_fingerprint~'^[0-9a-f]{64}$' AND ledger_root_hash~'^[0-9a-f]{64}$'
        AND (invocation_id_hash IS NULL OR invocation_id_hash~'^[0-9a-f]{64}$')),
      CONSTRAINT orchestrator_garr_ids_check CHECK(
        char_length(id) BETWEEN 1 AND 128 AND id~'^garr_'
        AND char_length(workflow_id) BETWEEN 1 AND 128 AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128 AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(operation_id) BETWEEN 1 AND 128 AND char_length(capability_id) BETWEEN 1 AND 128
        AND char_length(credential_ref_id) BETWEEN 1 AND 128 AND char_length(audit_ref) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_garr_cred_ver_check CHECK(credential_ref_version>=1),
      CONSTRAINT orchestrator_garr_lifecycle_check CHECK(
        expires_at>issued_at
        AND ((status='issued' AND invocation_id_hash IS NULL
              AND reserved_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL)
          OR (status='reserved' AND invocation_id_hash~'^[0-9a-f]{64}$'
              AND reserved_at IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL)
          OR (status='consumed' AND invocation_id_hash~'^[0-9a-f]{64}$'
              AND reserved_at IS NOT NULL AND consumed_at IS NOT NULL AND revoked_at IS NULL)
          OR (status='revoked' AND consumed_at IS NULL AND revoked_at IS NOT NULL)
          OR (status='expired' AND consumed_at IS NULL AND revoked_at IS NULL))),
      CONSTRAINT orchestrator_garr_workflow_fkey
        FOREIGN KEY(tenant_id,workflow_id)
        REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_draft_fkey
        FOREIGN KEY(tenant_id,draft_id)
        REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_request_fkey
        FOREIGN KEY(tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_intent_fkey
        FOREIGN KEY(tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_fkey
        FOREIGN KEY(tenant_id,operation_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_capability_fkey
        FOREIGN KEY(tenant_id,capability_id)
        REFERENCES orchestrator_google_ads_provider_draft_capabilities(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_account_fkey
        FOREIGN KEY(tenant_id,operation_id,account_fingerprint)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id,account_fingerprint)
        ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_snapshot_fkey
        FOREIGN KEY(tenant_id,operation_id,snapshot_hash)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id,snapshot_hash)
        ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_capability_fkey
        FOREIGN KEY(tenant_id,operation_id,capability_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id,capability_id)
        ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_cred_fkey
        FOREIGN KEY(tenant_id,operation_id,credential_ref_id,credential_ref_version,account_fingerprint)
        REFERENCES orchestrator_google_ads_provider_draft_operations
          (tenant_id,id,credential_ref_id,credential_ref_version,account_fingerprint)
        ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_garr_unique_invocation
      ON orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,invocation_id_hash)
      WHERE invocation_id_hash IS NOT NULL;

    -- Existing installations may still have the PR10C.1 guard. Remove it only
    -- inside this migration transaction so the owner backfill can run, then
    -- recreate the hardened guard below before this statement commits.
    DROP TRIGGER IF EXISTS orchestrator_garr_guard
      ON orchestrator_google_ads_reconciliation_read_authorizations;
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations
      ADD COLUMN IF NOT EXISTS credential_owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;
    UPDATE orchestrator_google_ads_reconciliation_read_authorizations SET credential_owner_user_id=requested_by
      WHERE credential_owner_user_id IS NULL;
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations
      ALTER COLUMN credential_owner_user_id SET NOT NULL;

    CREATE OR REPLACE FUNCTION orchestrator_garr_guard() RETURNS trigger AS $fn$
    DECLARE n INTEGER; BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'issued' THEN RAISE EXCEPTION 'orchestrator_garr_invalid_insert'; END IF;
        IF NOT EXISTS(SELECT 1 FROM orchestrator_google_ads_provider_draft_operations
          WHERE tenant_id=NEW.tenant_id AND id=NEW.operation_id)
        THEN RAISE EXCEPTION 'orchestrator_garr_operation_lineage'; END IF;
        SELECT count(*) INTO n FROM orchestrator_google_ads_provider_draft_objects
          WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id
            AND object_kind=ANY(ARRAY['campaign_budget','campaign','ad_group']::TEXT[])
            AND provider_status='PAUSED' AND serving=FALSE
            AND published=FALSE AND activated=FALSE;
        IF n<>3 THEN RAISE EXCEPTION 'orchestrator_garr_object_lineage'; END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_garr_audit_evidence'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.credential_owner_user_id IS DISTINCT FROM OLD.credential_owner_user_id
        OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.review_case_id IS DISTINCT FROM OLD.review_case_id
        OR NEW.review_version IS DISTINCT FROM OLD.review_version OR NEW.closure_event_id IS DISTINCT FROM OLD.closure_event_id
        OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.capability_id IS DISTINCT FROM OLD.capability_id
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.expected_object_kinds IS DISTINCT FROM OLD.expected_object_kinds
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
      THEN RAISE EXCEPTION 'orchestrator_garr_immutable_binding'; END IF;
      IF OLD.status IN ('consumed','revoked','expired')
        OR NOT ((OLD.status='issued' AND NEW.status IN ('reserved','revoked','expired'))
          OR (OLD.status='reserved' AND NEW.status IN ('consumed','revoked','expired')))
      THEN RAISE EXCEPTION 'orchestrator_garr_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garr_guard
      ON orchestrator_google_ads_reconciliation_read_authorizations;
    CREATE TRIGGER orchestrator_garr_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_read_authorizations
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garr_guard();
  `);

  // PR10C.2 — immutable outcome of one consume-once Google Ads observation.
  // The run deliberately omits provider/customer identifiers, account/session
  // bindings and credential material. The insert guard binds every retained
  // lineage value to the still-locked PR10C.1 authorization.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_reconciliation_runs(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      authorization_id TEXT NOT NULL,
      invocation_id_hash TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      observations JSONB NOT NULL DEFAULT '[]'::jsonb,
      classifications TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      observing_at TIMESTAMPTZ NOT NULL,
      observation_deadline TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_garrun_unique_authorization UNIQUE(tenant_id,authorization_id),
      CONSTRAINT orchestrator_garrun_unique_invocation UNIQUE(tenant_id,invocation_id_hash),
      CONSTRAINT orchestrator_garrun_unique_audit UNIQUE(tenant_id,audit_ref),
      CONSTRAINT orchestrator_garrun_authorization_fkey FOREIGN KEY(tenant_id,authorization_id)
        REFERENCES orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_workflow_fkey FOREIGN KEY(tenant_id,workflow_id)
        REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_draft_workflow_fkey FOREIGN KEY(tenant_id,draft_id,workflow_id)
        REFERENCES orchestrator_campaign_drafts(tenant_id,id,workflow_id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_request_fkey FOREIGN KEY(tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_intent_fkey FOREIGN KEY(tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_operation_fkey FOREIGN KEY(tenant_id,operation_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_state_check
        CHECK(state IN ('observing','verified','discrepancy_detected','failed')),
      CONSTRAINT orchestrator_garrun_ids_check CHECK(
        char_length(id) BETWEEN 1 AND 128 AND id~'^garrun_'
        AND char_length(authorization_id) BETWEEN 1 AND 128
        AND char_length(workflow_id) BETWEEN 1 AND 128 AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128 AND char_length(operation_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128 AND char_length(credential_ref_id) BETWEEN 1 AND 128
        AND char_length(audit_ref) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_garrun_hashes_check CHECK(
        invocation_id_hash~'^[0-9a-f]{64}$' AND snapshot_hash~'^[0-9a-f]{64}$'
        AND intent_hash~'^[0-9a-f]{64}$' AND ledger_root_hash~'^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_garrun_cred_ver_check CHECK(credential_ref_version>=1),
      CONSTRAINT orchestrator_garrun_observations_check CHECK(
        jsonb_typeof(observations)='array' AND jsonb_array_length(observations)<=3
        AND NOT jsonb_path_exists(observations,
          '$[*].keyvalue() ? (@.key != "object_kind" && @.key != "outcome" && @.key != "status_classification" && @.key != "account_binding_matches" && @.key != "campaign_parent_matches" && @.key != "budget_parent_matches" && @.key != "error_classification" && @.key != "observed_at")')),
      CONSTRAINT orchestrator_garrun_classifications_check CHECK(
        cardinality(classifications)=0 OR (cardinality(classifications)<=12
          AND array_to_string(classifications,',')~'^[a-z0-9_]{1,96}(,[a-z0-9_]{1,96})*$')),
      CONSTRAINT orchestrator_garrun_lifecycle_check CHECK(
        observation_deadline>observing_at
        AND ((state='observing' AND observations='[]'::jsonb AND cardinality(classifications)=0 AND completed_at IS NULL)
          OR (state IN ('verified','discrepancy_detected','failed') AND completed_at IS NOT NULL)))
    );

    CREATE OR REPLACE FUNCTION orchestrator_garrun_guard() RETURNS trigger AS $fn$
    DECLARE a orchestrator_google_ads_reconciliation_read_authorizations%ROWTYPE; BEGIN
      IF TG_OP='INSERT' THEN
        SELECT * INTO a FROM orchestrator_google_ads_reconciliation_read_authorizations
          WHERE tenant_id=NEW.tenant_id AND id=NEW.authorization_id FOR UPDATE;
        IF NOT FOUND OR a.status<>'issued' OR a.invocation_id_hash IS NOT NULL
          OR NEW.state<>'observing'
          OR NEW.requested_by IS DISTINCT FROM a.requested_by
          OR NEW.workflow_id IS DISTINCT FROM a.workflow_id OR NEW.draft_id IS DISTINCT FROM a.draft_id
          OR NEW.publishing_request_id IS DISTINCT FROM a.publishing_request_id
          OR NEW.operation_id IS DISTINCT FROM a.operation_id OR NEW.snapshot_hash IS DISTINCT FROM a.snapshot_hash
          OR NEW.intent_id IS DISTINCT FROM a.intent_id OR NEW.intent_hash IS DISTINCT FROM a.intent_hash
          OR NEW.credential_ref_id IS DISTINCT FROM a.credential_ref_id
          OR NEW.credential_ref_version IS DISTINCT FROM a.credential_ref_version
          OR NEW.ledger_root_hash IS DISTINCT FROM a.ledger_root_hash
        THEN RAISE EXCEPTION 'orchestrator_garrun_authorization_lineage'; END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_garrun_audit_evidence'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
        OR NEW.invocation_id_hash IS DISTINCT FROM OLD.invocation_id_hash
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.observing_at IS DISTINCT FROM OLD.observing_at
        OR NEW.observation_deadline IS DISTINCT FROM OLD.observation_deadline
      THEN RAISE EXCEPTION 'orchestrator_garrun_immutable_lineage'; END IF;
      IF OLD.state<>'observing' OR NEW.state NOT IN ('verified','discrepancy_detected','failed')
      THEN RAISE EXCEPTION 'orchestrator_garrun_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garrun_guard ON orchestrator_google_ads_reconciliation_runs;
    CREATE TRIGGER orchestrator_garrun_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_runs FOR EACH ROW EXECUTE FUNCTION orchestrator_garrun_guard();
  `);

  // PR10C.3 — a Google-only, human decision ledger. The insert trigger copies
  // and binds the complete safe PR10C.2 lineage; Meta review tables are separate.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_reconciliation_review_cases(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL, reconciliation_run_id TEXT NOT NULL, authorization_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL, draft_id TEXT NOT NULL, publishing_request_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL, credential_ref_id TEXT NOT NULL, credential_ref_version INTEGER NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      original_object_kinds TEXT[] NOT NULL DEFAULT ARRAY['campaign_budget','campaign','ad_group']::TEXT[],
      original_state TEXT NOT NULL, original_classifications TEXT[] NOT NULL,
      original_requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      original_created_at TIMESTAMPTZ NOT NULL, original_completed_at TIMESTAMPTZ NOT NULL,
      state TEXT NOT NULL DEFAULT 'open', classification TEXT NULL,
      assigned_reviewer_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
      note TEXT NULL, note_digest TEXT NULL, created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ NULL,
      escalated_at TIMESTAMPTZ NULL, closed_at TIMESTAMPTZ NULL, audit_ref TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,reconciliation_run_id), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,reconciliation_run_id)
        REFERENCES orchestrator_google_ads_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garcase_id_check CHECK(char_length(id) BETWEEN 1 AND 128 AND id~'^garc_'),
      CONSTRAINT orchestrator_garcase_kinds_check CHECK(original_object_kinds=ARRAY['campaign_budget','campaign','ad_group']::TEXT[]),
      CONSTRAINT orchestrator_garcase_original_state_check CHECK(original_state IN ('discrepancy_detected','failed')),
      CONSTRAINT orchestrator_garcase_state_check CHECK(state IN ('open','acknowledged','escalated','closed')),
      CONSTRAINT orchestrator_garcase_classification_check CHECK(classification IS NULL OR classification IN
        ('provider_investigation_required','external_remediation_required','unexpected_activation','object_missing',
         'relationship_mismatch','account_mismatch','observation_failure','accepted_risk','false_positive','closed_unresolved')),
      CONSTRAINT orchestrator_garcase_original_classes_check CHECK(cardinality(original_classifications) BETWEEN 1 AND 12
        AND array_to_string(original_classifications,',')~'^[a-z0-9_]{1,96}(,[a-z0-9_]{1,96})*$'),
      CONSTRAINT orchestrator_garcase_note_check CHECK(note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
      CONSTRAINT orchestrator_garcase_digest_check CHECK(note_digest IS NULL OR note_digest~'^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_garcase_lifecycle_check CHECK(version>=0 AND
        ((state='open' AND acknowledged_at IS NULL AND escalated_at IS NULL AND closed_at IS NULL)
         OR (state='acknowledged' AND acknowledged_at IS NOT NULL AND escalated_at IS NULL AND closed_at IS NULL)
         OR (state='escalated' AND escalated_at IS NOT NULL AND closed_at IS NULL)
         OR (state='closed' AND closed_at IS NOT NULL)))
    );
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_reconciliation_review_events(
      tenant_id INTEGER NOT NULL, id BIGSERIAL, case_id TEXT NOT NULL, decision_id TEXT NOT NULL,
      from_state TEXT NULL, to_state TEXT NOT NULL, classification TEXT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      note TEXT NULL, note_digest TEXT NULL, audit_ref TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,case_id,decision_id), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,case_id) REFERENCES orchestrator_google_ads_reconciliation_review_cases(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garevent_states_check CHECK(
        (from_state IS NULL AND to_state='open') OR
        (from_state='open' AND to_state IN ('acknowledged','escalated')) OR
        (from_state='acknowledged' AND to_state IN ('escalated','closed')) OR
        (from_state='escalated' AND to_state='closed')),
      CONSTRAINT orchestrator_garevent_decision_check CHECK(char_length(decision_id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_garevent_note_check CHECK(note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
      CONSTRAINT orchestrator_garevent_digest_check CHECK(note_digest IS NULL OR note_digest~'^[0-9a-f]{64}$')
    );
    CREATE INDEX IF NOT EXISTS orchestrator_garcase_tenant_created
      ON orchestrator_google_ads_reconciliation_review_cases(tenant_id,created_at DESC,id DESC);

    ALTER TABLE orchestrator_google_ads_reconciliation_review_events
      ADD COLUMN IF NOT EXISTS decision_payload_hash TEXT NULL;
    ALTER TABLE orchestrator_google_ads_reconciliation_review_events
      DROP CONSTRAINT IF EXISTS orchestrator_garevent_payload_hash_check;
    ALTER TABLE orchestrator_google_ads_reconciliation_review_events ADD CONSTRAINT orchestrator_garevent_payload_hash_check
      CHECK((from_state IS NULL AND decision_payload_hash IS NULL) OR
        (from_state IS NOT NULL AND decision_payload_hash~'^[0-9a-f]{64}

    CREATE OR REPLACE FUNCTION orchestrator_garcase_guard() RETURNS trigger AS $fn$
    DECLARE r orchestrator_google_ads_reconciliation_runs%ROWTYPE; BEGIN
      IF TG_OP='INSERT' THEN
        SELECT * INTO r FROM orchestrator_google_ads_reconciliation_runs
          WHERE tenant_id=NEW.tenant_id AND id=NEW.reconciliation_run_id FOR SHARE;
        IF NOT FOUND OR r.state NOT IN ('discrepancy_detected','failed')
          OR NEW.authorization_id IS DISTINCT FROM r.authorization_id OR NEW.workflow_id IS DISTINCT FROM r.workflow_id
          OR NEW.draft_id IS DISTINCT FROM r.draft_id OR NEW.publishing_request_id IS DISTINCT FROM r.publishing_request_id
          OR NEW.operation_id IS DISTINCT FROM r.operation_id OR NEW.snapshot_hash IS DISTINCT FROM r.snapshot_hash
          OR NEW.intent_id IS DISTINCT FROM r.intent_id OR NEW.intent_hash IS DISTINCT FROM r.intent_hash
          OR NEW.credential_ref_id IS DISTINCT FROM r.credential_ref_id
          OR NEW.credential_ref_version IS DISTINCT FROM r.credential_ref_version
          OR NEW.ledger_root_hash IS DISTINCT FROM r.ledger_root_hash
          OR NEW.original_state IS DISTINCT FROM r.state OR NEW.original_classifications IS DISTINCT FROM r.classifications
          OR NEW.original_requested_by IS DISTINCT FROM r.requested_by OR NEW.original_created_at IS DISTINCT FROM r.created_at
          OR NEW.original_completed_at IS DISTINCT FROM r.completed_at
        THEN RAISE EXCEPTION 'orchestrator_garcase_run_lineage'; END IF; RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_garcase_delete_prohibited'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id
        OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.original_object_kinds IS DISTINCT FROM OLD.original_object_kinds
        OR NEW.original_state IS DISTINCT FROM OLD.original_state
        OR NEW.original_classifications IS DISTINCT FROM OLD.original_classifications
        OR NEW.original_requested_by IS DISTINCT FROM OLD.original_requested_by
        OR NEW.original_created_at IS DISTINCT FROM OLD.original_created_at
        OR NEW.original_completed_at IS DISTINCT FROM OLD.original_completed_at
        OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref OR NEW.version<>OLD.version+1
      THEN RAISE EXCEPTION 'orchestrator_garcase_immutable_binding'; END IF;
      IF OLD.state='closed' OR NOT ((OLD.state='open' AND NEW.state IN ('acknowledged','escalated'))
        OR (OLD.state='acknowledged' AND NEW.state IN ('escalated','closed'))
        OR (OLD.state='escalated' AND NEW.state='closed'))
      THEN RAISE EXCEPTION 'orchestrator_garcase_invalid_transition'; END IF; RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garcase_guard ON orchestrator_google_ads_reconciliation_review_cases;
    CREATE TRIGGER orchestrator_garcase_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_review_cases FOR EACH ROW EXECUTE FUNCTION orchestrator_garcase_guard();
    CREATE OR REPLACE FUNCTION orchestrator_garevent_guard() RETURNS trigger AS $fn$
    BEGIN RAISE EXCEPTION 'orchestrator_garevent_append_only'; END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garevent_guard ON orchestrator_google_ads_reconciliation_review_events;
    CREATE TRIGGER orchestrator_garevent_guard BEFORE UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_review_events FOR EACH ROW EXECUTE FUNCTION orchestrator_garevent_guard();

    CREATE OR REPLACE FUNCTION orchestrator_garledger_consistent() RETURNS trigger AS $fn$
    DECLARE c RECORD; e RECORD; n INTEGER; BEGIN
      IF TG_TABLE_NAME='orchestrator_google_ads_reconciliation_review_cases' THEN
        SELECT * INTO c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
      ELSE
        SELECT * INTO c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id;
      END IF;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT *,row_number() OVER(ORDER BY id) AS ordinal INTO e
        FROM orchestrator_google_ads_reconciliation_review_events
        WHERE tenant_id=c.tenant_id AND case_id=c.id ORDER BY id DESC LIMIT 1;
      SELECT count(*) INTO n FROM orchestrator_google_ads_reconciliation_review_events
        WHERE tenant_id=c.tenant_id AND case_id=c.id;
      IF n<>c.version+1 OR e.to_state<>c.state OR e.classification IS DISTINCT FROM c.classification
        OR e.actor_user_id IS DISTINCT FROM COALESCE(c.assigned_reviewer_id,c.created_by)
        OR NOT EXISTS(SELECT 1 FROM orchestrator_audit_events a WHERE a.tenant_id=c.tenant_id
          AND a.workflow_id=c.workflow_id AND a.event='google_ads_reconciliation_review_'||CASE WHEN c.version=0 THEN 'opened' ELSE c.state END
          AND a.detail->>'google_ads_review_case_id'=c.id AND a.detail->>'audit_reference'=e.audit_ref)
      THEN RAISE EXCEPTION 'orchestrator_garledger_inconsistent'; END IF;
      RETURN NULL;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garcase_consistency ON orchestrator_google_ads_reconciliation_review_cases;
    CREATE CONSTRAINT TRIGGER orchestrator_garcase_consistency AFTER INSERT OR UPDATE
      ON orchestrator_google_ads_reconciliation_review_cases DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garledger_consistent();
    DROP TRIGGER IF EXISTS orchestrator_garevent_consistency ON orchestrator_google_ads_reconciliation_review_events;
    CREATE CONSTRAINT TRIGGER orchestrator_garevent_consistency AFTER INSERT
      ON orchestrator_google_ads_reconciliation_review_events DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garledger_consistent();
  `);

  await p.query(`
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'initial',
      ADD COLUMN IF NOT EXISTS review_case_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS review_version INTEGER NULL,
      ADD COLUMN IF NOT EXISTS closure_event_id BIGINT NULL;
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations
      DROP CONSTRAINT IF EXISTS orchestrator_garr_tenant_unique_operation_ledger;
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_garr_initial_operation_ledger
      ON orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,operation_id,ledger_root_hash)
      WHERE purpose='initial';
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_garr_post_review_case
      ON orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,review_case_id) WHERE purpose='post_review';
    DO $migration$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orchestrator_garr_purpose_check') THEN
        ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations ADD CONSTRAINT orchestrator_garr_purpose_check
          CHECK((purpose='initial' AND review_case_id IS NULL AND review_version IS NULL AND closure_event_id IS NULL)
            OR (purpose='post_review' AND review_case_id IS NOT NULL AND review_version>=1 AND closure_event_id IS NOT NULL));
      END IF;
    END $migration$;
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_rereconciliation_attempts(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,id TEXT NOT NULL,
      review_case_id TEXT NOT NULL,review_version INTEGER NOT NULL,closure_event_id BIGINT NOT NULL,
      original_reconciliation_run_id TEXT NOT NULL,original_authorization_id TEXT NOT NULL,
      new_authorization_id TEXT NOT NULL,new_reconciliation_run_id TEXT NOT NULL,
      invocation_payload_hash TEXT NOT NULL,initiated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      audit_ref TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),
      UNIQUE(tenant_id,review_case_id),UNIQUE(tenant_id,new_authorization_id),UNIQUE(tenant_id,new_reconciliation_run_id),
      UNIQUE(tenant_id,invocation_payload_hash),UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,review_case_id) REFERENCES orchestrator_google_ads_reconciliation_review_cases(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,closure_event_id) REFERENCES orchestrator_google_ads_reconciliation_review_events(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,new_authorization_id) REFERENCES orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,new_reconciliation_run_id) REFERENCES orchestrator_google_ads_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CHECK(review_version>=1 AND invocation_payload_hash~'^[0-9a-f]{64}$')
    );
    CREATE OR REPLACE FUNCTION orchestrator_garra_guard() RETURNS trigger AS $fn$
    DECLARE c RECORD;e RECORD;a RECORD;r RECORD;BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_garra_immutable';END IF;
      SELECT * INTO c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=NEW.tenant_id AND id=NEW.review_case_id;
      SELECT * INTO e FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=NEW.tenant_id AND id=NEW.closure_event_id;
      SELECT * INTO a FROM orchestrator_google_ads_reconciliation_read_authorizations WHERE tenant_id=NEW.tenant_id AND id=NEW.new_authorization_id;
      SELECT * INTO r FROM orchestrator_google_ads_reconciliation_runs WHERE tenant_id=NEW.tenant_id AND id=NEW.new_reconciliation_run_id;
      IF c.state<>'closed' OR c.classification<>'external_remediation_required' OR c.version<>NEW.review_version
        OR e.case_id<>c.id OR e.to_state<>'closed' OR e.classification<>c.classification
        OR a.purpose<>'post_review' OR a.review_case_id<>c.id OR a.review_version<>c.version OR a.closure_event_id<>e.id
        OR r.authorization_id<>a.id OR c.reconciliation_run_id<>NEW.original_reconciliation_run_id
        OR c.authorization_id<>NEW.original_authorization_id OR a.workflow_id<>c.workflow_id OR a.draft_id<>c.draft_id
        OR a.publishing_request_id<>c.publishing_request_id OR a.operation_id<>c.operation_id OR a.snapshot_hash<>c.snapshot_hash
        OR a.intent_id<>c.intent_id OR a.intent_hash<>c.intent_hash OR a.credential_ref_id<>c.credential_ref_id
        OR a.credential_ref_version<>c.credential_ref_version OR a.ledger_root_hash<>c.ledger_root_hash
      THEN RAISE EXCEPTION 'orchestrator_garra_invalid_provenance';END IF;RETURN NEW;
    END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garra_guard ON orchestrator_google_ads_rereconciliation_attempts;
    CREATE TRIGGER orchestrator_garra_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_google_ads_rereconciliation_attempts
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garra_guard();
  `);

  // PR 8C — consumes one approved PR8B request without changing it. No provider
  // identifiers, credential references, source hashes, payloads, or errors are stored.
  // orchestrator_advertising_global_kill_switches is a platform-wide GLOBAL)) NOT VALID;

    CREATE OR REPLACE FUNCTION orchestrator_garcase_guard() RETURNS trigger AS $fn$
    DECLARE r orchestrator_google_ads_reconciliation_runs%ROWTYPE; BEGIN
      IF TG_OP='INSERT' THEN
        SELECT * INTO r FROM orchestrator_google_ads_reconciliation_runs
          WHERE tenant_id=NEW.tenant_id AND id=NEW.reconciliation_run_id FOR SHARE;
        IF NOT FOUND OR r.state NOT IN ('discrepancy_detected','failed')
          OR NEW.authorization_id IS DISTINCT FROM r.authorization_id OR NEW.workflow_id IS DISTINCT FROM r.workflow_id
          OR NEW.draft_id IS DISTINCT FROM r.draft_id OR NEW.publishing_request_id IS DISTINCT FROM r.publishing_request_id
          OR NEW.operation_id IS DISTINCT FROM r.operation_id OR NEW.snapshot_hash IS DISTINCT FROM r.snapshot_hash
          OR NEW.intent_id IS DISTINCT FROM r.intent_id OR NEW.intent_hash IS DISTINCT FROM r.intent_hash
          OR NEW.credential_ref_id IS DISTINCT FROM r.credential_ref_id
          OR NEW.credential_ref_version IS DISTINCT FROM r.credential_ref_version
          OR NEW.ledger_root_hash IS DISTINCT FROM r.ledger_root_hash
          OR NEW.original_state IS DISTINCT FROM r.state OR NEW.original_classifications IS DISTINCT FROM r.classifications
          OR NEW.original_requested_by IS DISTINCT FROM r.requested_by OR NEW.original_created_at IS DISTINCT FROM r.created_at
          OR NEW.original_completed_at IS DISTINCT FROM r.completed_at
        THEN RAISE EXCEPTION 'orchestrator_garcase_run_lineage'; END IF; RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_garcase_delete_prohibited'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id
        OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.original_object_kinds IS DISTINCT FROM OLD.original_object_kinds
        OR NEW.original_state IS DISTINCT FROM OLD.original_state
        OR NEW.original_classifications IS DISTINCT FROM OLD.original_classifications
        OR NEW.original_requested_by IS DISTINCT FROM OLD.original_requested_by
        OR NEW.original_created_at IS DISTINCT FROM OLD.original_created_at
        OR NEW.original_completed_at IS DISTINCT FROM OLD.original_completed_at
        OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref OR NEW.version<>OLD.version+1
      THEN RAISE EXCEPTION 'orchestrator_garcase_immutable_binding'; END IF;
      IF OLD.state='closed' OR NOT ((OLD.state='open' AND NEW.state IN ('acknowledged','escalated'))
        OR (OLD.state='acknowledged' AND NEW.state IN ('escalated','closed'))
        OR (OLD.state='escalated' AND NEW.state='closed'))
      THEN RAISE EXCEPTION 'orchestrator_garcase_invalid_transition'; END IF; RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garcase_guard ON orchestrator_google_ads_reconciliation_review_cases;
    CREATE TRIGGER orchestrator_garcase_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_review_cases FOR EACH ROW EXECUTE FUNCTION orchestrator_garcase_guard();
    CREATE OR REPLACE FUNCTION orchestrator_garevent_guard() RETURNS trigger AS $fn$
    BEGIN RAISE EXCEPTION 'orchestrator_garevent_append_only'; END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garevent_guard ON orchestrator_google_ads_reconciliation_review_events;
    CREATE TRIGGER orchestrator_garevent_guard BEFORE UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_review_events FOR EACH ROW EXECUTE FUNCTION orchestrator_garevent_guard();

    CREATE OR REPLACE FUNCTION orchestrator_garledger_consistent() RETURNS trigger AS $fn$
    DECLARE c RECORD; e RECORD; n INTEGER; BEGIN
      IF TG_TABLE_NAME='orchestrator_google_ads_reconciliation_review_cases' THEN
        SELECT * INTO c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
      ELSE
        SELECT * INTO c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id;
      END IF;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT *,row_number() OVER(ORDER BY id) AS ordinal INTO e
        FROM orchestrator_google_ads_reconciliation_review_events
        WHERE tenant_id=c.tenant_id AND case_id=c.id ORDER BY id DESC LIMIT 1;
      SELECT count(*) INTO n FROM orchestrator_google_ads_reconciliation_review_events
        WHERE tenant_id=c.tenant_id AND case_id=c.id;
      IF n<>c.version+1 OR e.to_state<>c.state OR e.classification IS DISTINCT FROM c.classification
        OR e.actor_user_id IS DISTINCT FROM COALESCE(c.assigned_reviewer_id,c.created_by)
        OR NOT EXISTS(SELECT 1 FROM orchestrator_audit_events a WHERE a.tenant_id=c.tenant_id
          AND a.workflow_id=c.workflow_id AND a.event='google_ads_reconciliation_review_'||CASE WHEN c.version=0 THEN 'opened' ELSE c.state END
          AND a.detail->>'google_ads_review_case_id'=c.id AND a.detail->>'audit_reference'=e.audit_ref)
      THEN RAISE EXCEPTION 'orchestrator_garledger_inconsistent'; END IF;
      RETURN NULL;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garcase_consistency ON orchestrator_google_ads_reconciliation_review_cases;
    CREATE CONSTRAINT TRIGGER orchestrator_garcase_consistency AFTER INSERT OR UPDATE
      ON orchestrator_google_ads_reconciliation_review_cases DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garledger_consistent();
    DROP TRIGGER IF EXISTS orchestrator_garevent_consistency ON orchestrator_google_ads_reconciliation_review_events;
    CREATE CONSTRAINT TRIGGER orchestrator_garevent_consistency AFTER INSERT
      ON orchestrator_google_ads_reconciliation_review_events DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garledger_consistent();
  `);

  await p.query(`
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations
      ADD COLUMN IF NOT EXISTS credential_owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'initial',
      ADD COLUMN IF NOT EXISTS review_case_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS review_version INTEGER NULL,
      ADD COLUMN IF NOT EXISTS closure_event_id BIGINT NULL;
    UPDATE orchestrator_google_ads_reconciliation_read_authorizations SET credential_owner_user_id=requested_by
      WHERE credential_owner_user_id IS NULL;
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations ALTER COLUMN credential_owner_user_id SET NOT NULL;
    ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations
      DROP CONSTRAINT IF EXISTS orchestrator_garr_tenant_unique_operation_ledger;
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_garr_initial_operation_ledger
      ON orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,operation_id,ledger_root_hash)
      WHERE purpose='initial';
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_garr_post_review_case
      ON orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,review_case_id) WHERE purpose='post_review';
    DO $migration$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orchestrator_garr_purpose_check') THEN
        ALTER TABLE orchestrator_google_ads_reconciliation_read_authorizations ADD CONSTRAINT orchestrator_garr_purpose_check
          CHECK((purpose='initial' AND review_case_id IS NULL AND review_version IS NULL AND closure_event_id IS NULL)
            OR (purpose='post_review' AND review_case_id IS NOT NULL AND review_version>=1 AND closure_event_id IS NOT NULL));
      END IF;
    END $migration$;
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_rereconciliation_attempts(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,id TEXT NOT NULL,
      review_case_id TEXT NOT NULL,review_version INTEGER NOT NULL,closure_event_id BIGINT NOT NULL,
      original_reconciliation_run_id TEXT NOT NULL,original_authorization_id TEXT NOT NULL,
      new_authorization_id TEXT NOT NULL,new_reconciliation_run_id TEXT NOT NULL,
      invocation_payload_hash TEXT NOT NULL,initiated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      audit_ref TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),
      UNIQUE(tenant_id,review_case_id),UNIQUE(tenant_id,new_authorization_id),UNIQUE(tenant_id,new_reconciliation_run_id),
      UNIQUE(tenant_id,invocation_payload_hash),UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,review_case_id) REFERENCES orchestrator_google_ads_reconciliation_review_cases(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,closure_event_id) REFERENCES orchestrator_google_ads_reconciliation_review_events(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,new_authorization_id) REFERENCES orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,new_reconciliation_run_id) REFERENCES orchestrator_google_ads_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CHECK(review_version>=1 AND invocation_payload_hash~'^[0-9a-f]{64}$')
    );
    CREATE OR REPLACE FUNCTION orchestrator_garra_guard() RETURNS trigger AS $fn$
    DECLARE c RECORD;e RECORD;a RECORD;r RECORD;BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_garra_immutable';END IF;
      SELECT * INTO c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=NEW.tenant_id AND id=NEW.review_case_id;
      SELECT * INTO e FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=NEW.tenant_id AND id=NEW.closure_event_id;
      SELECT * INTO a FROM orchestrator_google_ads_reconciliation_read_authorizations WHERE tenant_id=NEW.tenant_id AND id=NEW.new_authorization_id;
      SELECT * INTO r FROM orchestrator_google_ads_reconciliation_runs WHERE tenant_id=NEW.tenant_id AND id=NEW.new_reconciliation_run_id;
      IF c.state<>'closed' OR c.classification<>'external_remediation_required' OR c.version<>NEW.review_version
        OR e.case_id<>c.id OR e.to_state<>'closed' OR e.classification<>c.classification
        OR a.purpose<>'post_review' OR a.review_case_id<>c.id OR a.review_version<>c.version OR a.closure_event_id<>e.id
        OR r.authorization_id<>a.id OR c.reconciliation_run_id<>NEW.original_reconciliation_run_id
        OR c.authorization_id<>NEW.original_authorization_id OR a.workflow_id<>c.workflow_id OR a.draft_id<>c.draft_id
        OR a.publishing_request_id<>c.publishing_request_id OR a.operation_id<>c.operation_id OR a.snapshot_hash<>c.snapshot_hash
        OR a.intent_id<>c.intent_id OR a.intent_hash<>c.intent_hash OR a.credential_ref_id<>c.credential_ref_id
        OR a.credential_ref_version<>c.credential_ref_version OR a.ledger_root_hash<>c.ledger_root_hash
      THEN RAISE EXCEPTION 'orchestrator_garra_invalid_provenance';END IF;RETURN NEW;
    END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garra_guard ON orchestrator_google_ads_rereconciliation_attempts;
    CREATE TRIGGER orchestrator_garra_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_google_ads_rereconciliation_attempts
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garra_guard();
  `);

  // PR 8C — consumes one approved PR8B request without changing it. No provider
  // identifiers, credential references, source hashes, payloads, or errors are stored.
  // orchestrator_advertising_global_kill_switches is a platform-wide GLOBAL