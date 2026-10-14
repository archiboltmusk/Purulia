-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — evidence system: source → document → assertion → harm →
-- body → relationship → official response → remedy → verified outcome
--
-- One shared record that every later feature (money, legal, graph, remedy)
-- points into. Plan: project files research/jandarpan-gap-backlog.md.
--
-- Rules the database enforces, not just the policy page:
--   * Nothing is public until a moderator approves it; sensitive items need two
--     different moderators.
--   * An assertion goes public only with an accepted supporting document (page
--     or table locator); contrary documents stay attached and shown.
--   * Evidence state (is it true?) and legal stage (where is the case?) are
--     separate columns, and every change to either is kept in status_history.
--   * Links between entities need a document and a reason; "tentative" links
--     never go public.
--   * Anything naming a person in an official capacity, or a criminal case, is
--     "sensitive" and stays private until the legal gate (setting
--     legal_gate_open) is opened by an admin after legal review.
--   * A remedy counts as "outcome verified" only with a verified outcome (live
--     camera photo, document or measurement), never on an office's word alone.
--   * Edits to anything already public need a note, which goes in the public
--     corrections log. Audit log, reviews and status history can't be edited.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('legal_gate_open', 'false', 'Set true only after Indian legal review of the publication model. Until then sensitive evidence records (people in official roles, criminal cases) stay private.'),
  ('remedy_recheck_days', '90', 'Days after a verified outcome before the spot is checked again for recurrence.')
on conflict (key) do nothing;

-- ── Tables ──────────────────────────────────────────────────────────────

create table if not exists kasa_private.sources (
  id               bigint generated always as identity primary key,
  url              text not null unique,
  publisher        text,
  title            text not null,
  source_type      text not null check (source_type in ('government', 'court', 'legislature', 'audit', 'dataset', 'regulator', 'oversight', 'public_submission', 'other')),
  jurisdiction     text not null,
  domains          text,
  access_method    text not null default 'manual_review' check (access_method in ('manual_review', 'download', 'api', 'rss', 'bulk_dataset', 'unknown')),
  access_terms_url text,
  update_frequency text,
  limitations      text,
  validation_state text not null default 'candidate' check (validation_state in ('candidate', 'checked', 'approved', 'blocked', 'retired')),
  last_checked_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists kasa_private.source_runs (
  id             bigint generated always as identity primary key,
  source_id      bigint not null references kasa_private.sources(id),
  fetched_at     timestamptz not null default now(),
  http_status    integer check (http_status between 100 and 599),
  sha256         text,
  archive_url    text,
  mime_type      text,
  parser_version text,
  error          text,
  notes          text
);

create table if not exists kasa_private.documents (
  id            bigint generated always as identity primary key,
  source_id     bigint not null references kasa_private.sources(id),
  source_run_id bigint references kasa_private.source_runs(id),
  url           text not null,
  title         text not null,
  source_class  text not null check (source_class in ('official_primary', 'court', 'audit', 'official_statistics', 'secondary_reporting', 'first_hand', 'other')),
  document_type text,
  published_on  date,
  retrieved_at  timestamptz not null default now(),
  language      text,
  page_count    integer check (page_count is null or page_count > 0),
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  archive_url   text,
  rights_review text not null default 'link_only' check (rights_review in ('pending', 'permitted', 'link_only', 'restricted', 'public_domain')),
  status        text not null default 'live' check (status in ('live', 'changed', 'gone')),
  supersedes_id bigint references kasa_private.documents(id),
  created_at    timestamptz not null default now()
);
create unique index if not exists kasa_documents_sha_idx on kasa_private.documents (sha256) where sha256 is not null;

create table if not exists kasa_private.entities (
  id                bigint generated always as identity primary key,
  kind              text not null check (kind in ('public_body', 'department', 'office', 'public_official', 'company', 'project', 'work', 'asset', 'court', 'regulator', 'place', 'other')),
  name              text not null,
  aliases           text,
  jurisdiction      text,
  district          text,
  lgd_code          text,
  identifier        text,             -- GSTIN, CNR, tender id, LGD code… as printed
  identity_basis    text,             -- how we know this is the same entity
  ref_table         text,             -- existing row it mirrors, e.g. kasa_private.works
  ref_id            text,
  sensitivity       text not null default 'public' check (sensitivity in ('public', 'sensitive')),
  publication_state text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists kasa_private.harms (
  id                       bigint generated always as identity primary key,
  title                    text not null,
  description              text not null,
  domain                   text not null,
  subdomain                text,
  state                    text not null default 'West Bengal',
  district                 text,
  block                    text,
  local_body               text,
  lgd_code                 text,
  period_from              date,
  period_to                date,
  affected_estimate        bigint check (affected_estimate is null or affected_estimate >= 0),
  affected_basis           text,
  financial_exposure       numeric(20,2) check (financial_exposure is null or financial_exposure >= 0),
  financial_exposure_basis text check (financial_exposure_basis is null or financial_exposure_basis in ('alleged', 'reported', 'budgeted', 'estimated', 'awarded', 'audited', 'ordered', 'paid', 'recovered')),
  unknown_note             text,      -- what is still not known; required to publish
  harm_status              text not null default 'under_assessment' check (harm_status in ('under_assessment', 'active', 'partially_remedied', 'remedied', 'recurring', 'unresolved', 'closed_no_finding')),
  sensitivity              text not null default 'public' check (sensitivity in ('public', 'sensitive')),
  publication_state        text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists kasa_private.harm_reports (
  harm_id    bigint not null references kasa_private.harms(id) on delete cascade,
  report_id  text not null,
  created_at timestamptz not null default now(),
  primary key (harm_id, report_id)
);

-- "Assertion", not "claim": kasa_private.claims already means cleanup claims.
create table if not exists kasa_private.assertions (
  id                    bigint generated always as identity primary key,
  harm_id               bigint references kasa_private.harms(id),
  headline              text not null,
  body                  text not null,
  domain                text,
  district              text,
  event_from            date,
  event_to              date,
  evidence_state        text not null default 'unverified' check (evidence_state in ('unverified', 'source_checked', 'corroborated', 'disputed', 'insufficient_evidence', 'established_by_finding', 'corrected', 'withdrawn', 'superseded')),
  evidence_as_of        date,
  uncertainty_note      text,
  right_of_reply_status text not null default 'not_requested' check (right_of_reply_status in ('not_requested', 'requested', 'received', 'no_response', 'not_applicable')),
  sensitivity           text not null default 'public' check (sensitivity in ('public', 'sensitive')),
  publication_state     text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists kasa_private.assertion_evidence (
  id            bigint generated always as identity primary key,
  assertion_id  bigint not null references kasa_private.assertions(id) on delete cascade,
  document_id   bigint not null references kasa_private.documents(id),
  locator       text not null,           -- page / paragraph / table
  excerpt       text,
  role          text not null check (role in ('supports', 'contradicts', 'context')),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  reviewer_id   uuid,
  rationale     text,
  created_at    timestamptz not null default now(),
  unique (assertion_id, document_id, locator, role)
);

create table if not exists kasa_private.assertion_entities (
  assertion_id bigint not null references kasa_private.assertions(id) on delete cascade,
  entity_id    bigint not null references kasa_private.entities(id),
  role_label   text not null,
  document_id  bigint references kasa_private.documents(id),
  rationale    text not null,
  created_at   timestamptz not null default now(),
  primary key (assertion_id, entity_id, role_label)
);

create table if not exists kasa_private.relationships (
  id                bigint generated always as identity primary key,
  from_entity_id    bigint not null references kasa_private.entities(id),
  to_entity_id      bigint not null references kasa_private.entities(id),
  kind              text not null,
  assertion_id      bigint references kasa_private.assertions(id),
  document_id       bigint not null references kasa_private.documents(id),
  locator           text,
  rationale         text not null,
  confidence        text not null check (confidence in ('confirmed_identifier_match', 'strong_documentary_link', 'tentative_candidate')),
  valid_from        date,
  valid_to          date,
  sensitivity       text not null default 'public' check (sensitivity in ('public', 'sensitive')),
  publication_state text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (from_entity_id <> to_entity_id)
);

create table if not exists kasa_private.proceedings (
  id                bigint generated always as identity primary key,
  kind              text not null check (kind in ('rti', 'grievance', 'court', 'criminal', 'administrative', 'audit', 'departmental', 'vigilance', 'lokayukta', 'legislative', 'other')),
  ref_no            text,
  forum             text,              -- court / authority
  jurisdiction      text,
  filed_on          date,
  statutes          text,
  stage             text not null default 'unknown' check (stage in ('complaint', 'preliminary_review', 'fir_registered', 'investigation', 'charge_sheet', 'trial', 'hearing', 'decision', 'conviction', 'acquittal', 'discharge', 'closure', 'dismissed', 'quashed', 'appeal_pending', 'reversed', 'compliance_pending', 'complied', 'administrative_resolution', 'withdrawn', 'unknown')),
  stage_as_of       date,
  stage_document_id bigint references kasa_private.documents(id),
  official_url      text,
  summary           text,
  report_docket_id  bigint,            -- kasa_private.report_dockets row it grew from
  sensitivity       text not null default 'public' check (sensitivity in ('public', 'sensitive')),
  publication_state text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists kasa_private.assertion_proceedings (
  assertion_id  bigint not null references kasa_private.assertions(id) on delete cascade,
  proceeding_id bigint not null references kasa_private.proceedings(id),
  basis         text not null,
  document_id   bigint references kasa_private.documents(id),
  created_at    timestamptz not null default now(),
  primary key (assertion_id, proceeding_id)
);

-- Each amount is one kind of figure; the page never adds different kinds together.
create table if not exists kasa_private.money_records (
  id                  bigint generated always as identity primary key,
  harm_id             bigint references kasa_private.harms(id),
  work_id             bigint,            -- kasa_private.works
  payer_entity_id     bigint references kasa_private.entities(id),
  recipient_entity_id bigint references kasa_private.entities(id),
  proceeding_id       bigint references kasa_private.proceedings(id),
  amount_basis        text not null check (amount_basis in ('allocated', 'contract', 'reported_paid', 'verified_paid', 'work_done', 'audit_questioned', 'recoverable', 'recovered')),
  amount              numeric(20,2) not null check (amount >= 0),
  as_of               date,
  financial_year      text,
  tender_ref          text,
  document_id         bigint not null references kasa_private.documents(id),
  locator             text not null,
  notes               text,
  publication_state   text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Official responses and right of reply, shown unedited beside the record.
create table if not exists kasa_private.responses (
  id                bigint generated always as identity primary key,
  target_type       text not null check (target_type in ('harm', 'assertion', 'proceeding', 'remedy')),
  target_id         bigint not null,
  from_entity_id    bigint references kasa_private.entities(id),
  from_label        text not null,
  document_id       bigint references kasa_private.documents(id),
  url               text,
  received_on       date not null,
  summary           text not null,
  publication_state text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists kasa_private.remedies (
  id                       bigint generated always as identity primary key,
  harm_id                  bigint not null references kasa_private.harms(id),
  body_entity_id           bigint references kasa_private.entities(id),
  responsible_label        text,
  requested_action         text not null,
  remedy_type              text not null default 'other' check (remedy_type in ('service_restored', 'money_recovered', 'order_complied', 'policy_changed', 'disciplinary_action', 'environmental_reduction', 'compensation', 'record_corrected', 'repair_under_warranty', 'other')),
  legal_basis_assertion_id bigint references kasa_private.assertions(id),
  requested_on             date,
  due_on                   date,
  stage                    text not null default 'identified' check (stage in ('identified', 'verified', 'referred', 'assessed', 'outcome_verified')),
  action_status            text not null default 'proposed' check (action_status in ('proposed', 'submitted', 'acknowledged', 'in_progress', 'claimed_complete', 'verified_complete', 'rejected', 'overdue')),
  unresolved               boolean not null default false,
  recurred                 boolean not null default false,
  recheck_on               date,
  publication_state        text not null default 'draft' check (publication_state in ('draft', 'in_review', 'published', 'rejected', 'archived')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists kasa_private.outcomes (
  id            bigint generated always as identity primary key,
  remedy_id     bigint not null references kasa_private.remedies(id) on delete cascade,
  metric        text not null,
  unit          text,
  baseline      numeric,
  observed      numeric,
  period_from   date,
  period_to     date,
  method        text not null,
  evidence_kind text not null check (evidence_kind in ('live_photo', 'document', 'measurement')),
  evidence_ref  text,                -- report or cleanup-claim id for live photos
  document_id   bigint references kasa_private.documents(id),
  verified      boolean not null default false,
  verified_by   uuid,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (not verified or (evidence_kind = 'live_photo' and evidence_ref is not null) or document_id is not null)
);

create table if not exists kasa_private.reviews (
  id          bigint generated always as identity primary key,
  target_type text not null,
  target_id   bigint not null,
  reviewer_id uuid not null,
  decision    text not null check (decision in ('approve', 'reject', 'request_changes', 'archive')),
  rationale   text not null,
  created_at  timestamptz not null default now()
);
create index if not exists kasa_reviews_target_idx on kasa_private.reviews (target_type, target_id);

create table if not exists kasa_private.status_history (
  id          bigint generated always as identity primary key,
  target_type text not null,
  target_id   bigint not null,
  field       text not null,
  value       text,
  as_of       date,
  actor_id    uuid,
  created_at  timestamptz not null default now()
);
create index if not exists kasa_status_history_target_idx on kasa_private.status_history (target_type, target_id, id);

create table if not exists kasa_private.record_corrections (
  id            bigint generated always as identity primary key,
  target_type   text not null,
  target_id     bigint not null,
  note          text not null,
  submission_id bigint,
  actor_id      uuid,
  created_at    timestamptz not null default now()
);

create table if not exists kasa_private.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  target_type text not null,
  target_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists kasa_audit_log_target_idx on kasa_private.audit_log (target_type, target_id, id);

-- Private inbox: sources, documents, corrections, right of reply, evidence.
create table if not exists kasa_private.ev_submissions (
  id          bigint generated always as identity primary key,
  ref_no      text not null unique,
  key_hash    text not null,
  kind        text not null check (kind in ('source', 'document', 'correction', 'right_of_reply', 'evidence', 'harm')),
  target_type text check (target_type is null or target_type in ('harm', 'assertion', 'entity', 'proceeding', 'remedy')),
  target_id   bigint,
  url         text,
  body        text not null,
  ip_hash     text,
  status      text not null default 'received' check (status in ('received', 'triage', 'source_review', 'legal_privacy_review', 'needs_more_information', 'accepted', 'rejected', 'referred')),
  reason      text,
  created_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists kasa_ev_submissions_status_idx on kasa_private.ev_submissions (status, created_at);

do $$
declare t text;
begin
  foreach t in array array['sources', 'source_runs', 'documents', 'entities', 'harms', 'harm_reports', 'assertions',
      'assertion_evidence', 'assertion_entities', 'relationships', 'proceedings', 'assertion_proceedings', 'money_records',
      'responses', 'remedies', 'outcomes', 'reviews', 'status_history', 'record_corrections', 'audit_log', 'ev_submissions'] loop
    execute format('alter table kasa_private.%I enable row level security', t);
    execute format('revoke all on table kasa_private.%I from anon, authenticated', t);
  end loop;
end $$;

create index if not exists kasa_harms_pub_idx on kasa_private.harms (publication_state, district, domain);
create index if not exists kasa_assertions_harm_idx on kasa_private.assertions (harm_id, publication_state);
create index if not exists kasa_relationships_from_idx on kasa_private.relationships (from_entity_id, publication_state);
create index if not exists kasa_relationships_to_idx on kasa_private.relationships (to_entity_id, publication_state);
create index if not exists kasa_remedies_harm_idx on kasa_private.remedies (harm_id, stage);

-- ── Seed: candidate official sources (not yet checked; see methodology) ──
insert into kasa_private.sources (url, publisher, title, source_type, jurisdiction, domains, limitations) values
  ('https://wb.gov.in/', 'Government of West Bengal', 'West Bengal Government portal', 'government', 'West Bengal', 'cross-domain', 'Check current directory structure and terms before collection'),
  ('https://wbpolice.gov.in/', 'West Bengal Police', 'West Bengal Police portal', 'government', 'West Bengal', 'police and public safety', 'Confirm available orders statistics and contact channels'),
  ('https://wbtenders.gov.in/', 'Government of West Bengal', 'West Bengal e-Tender portal', 'government', 'West Bengal', 'procurement', 'Review portal terms and available public tender data'),
  ('https://cag.gov.in/', 'Comptroller and Auditor General of India', 'CAG reports and audit resources', 'audit', 'India and states', 'public finance and audit', 'Identify West Bengal reports and document locators'),
  ('https://ecourts.gov.in/', 'eCourts Services', 'Indian court services portal', 'court', 'India', 'court and case records', 'Check access rules and case-search limitations'),
  ('https://calcuttahighcourt.gov.in/', 'Calcutta High Court', 'Calcutta High Court official portal', 'court', 'West Bengal', 'court orders and judgments', 'Verify official URL and public order archive'),
  ('https://eci.gov.in/', 'Election Commission of India', 'ECI official portal', 'government', 'India', 'elections', 'Prefer published orders and official datasets'),
  ('https://ceowestbengal.wb.gov.in/', 'Chief Electoral Officer West Bengal', 'CEO West Bengal portal', 'government', 'West Bengal', 'elections and voter services', 'Verify current portal availability and records'),
  ('https://cvc.gov.in/', 'Central Vigilance Commission', 'Central Vigilance Commission portal', 'oversight', 'India', 'vigilance and corruption oversight', 'Scope is central vigilance; not a substitute for state channels'),
  ('https://cbi.gov.in/', 'Central Bureau of Investigation', 'CBI official portal', 'oversight', 'India', 'investigation and press releases', 'Press releases do not establish guilt'),
  ('https://nhrc.nic.in/', 'National Human Rights Commission', 'NHRC official portal', 'oversight', 'India', 'human rights and complaints', 'Review complaint privacy and case disclosure limits'),
  ('https://cpcb.nic.in/', 'Central Pollution Control Board', 'CPCB official portal', 'regulator', 'India', 'environment', 'Check datasets and monitoring metadata'),
  ('https://wbpcb.gov.in/', 'West Bengal Pollution Control Board', 'WBPCB official portal', 'regulator', 'West Bengal', 'environment and compliance', 'Verify current portal and data reuse conditions'),
  ('https://pgportal.gov.in/', 'CPGRAMS', 'Centralised Public Grievance Redress and Monitoring System', 'government', 'India', 'grievance redress', 'Do not collect personal grievance details without explicit legal basis'),
  ('https://passportindia.gov.in/', 'Passport Seva', 'Passport Seva official portal', 'government', 'India', 'passport service information', 'Do not attempt to access non-public applicant data'),
  ('https://eprocure.gov.in/', 'Central Public Procurement Portal', 'Central Public Procurement Portal', 'government', 'India', 'central procurement', 'Central portal; distinguish from state procurement records'),
  ('https://greentribunal.gov.in/', 'National Green Tribunal', 'NGT official portal', 'court', 'India', 'environmental proceedings', 'Verify current case search and order URLs'),
  ('https://wbtenders.gov.in/nicgep/app/', null, 'West Bengal e-Procurement (legacy/current transition portal)', 'government', 'West Bengal', 'Government procurement', 'Check portal notices; confirm which portal each department now uses'),
  ('https://tenders.wb.gov.in/nicgep/app/', null, 'West Bengal e-Tender portal', 'government', 'West Bengal', 'Government procurement', 'Verify department coverage and archive availability'),
  ('https://acb.wb.gov.in/', null, 'West Bengal Anti-Corruption Branch', 'oversight', 'West Bengal', 'Anti-corruption', 'Public pages and FIR lookup; verify case records individually'),
  ('https://svc.wb.gov.in/', null, 'West Bengal State Vigilance Commission', 'oversight', 'West Bengal', 'Vigilance complaints', 'Jurisdiction and public availability vary'),
  ('https://lokayukta.wb.gov.in/', null, 'West Bengal Lokayukta', 'oversight', 'West Bengal', 'Complaints / orders', 'Check admissibility, status and published orders'),
  ('https://cag.gov.in/ag1/west-bengal/en/audit-report/', null, 'CAG West Bengal audit reports', 'audit', 'West Bengal', 'Public audit', 'Read report chapters; audit observations are not automatically criminal findings'),
  ('https://www.indiacode.nic.in/', null, 'India Code', 'legislature', 'India', 'Legislation', 'Use for statutory text; verify amendments and commencement'),
  ('https://www.sci.gov.in/', null, 'Supreme Court of India', 'court', 'India', 'Judgments / orders', 'Use official orders and judgments'),
  ('https://data.gov.in/', null, 'Open Government Data Platform India', 'dataset', 'India', 'Open datasets / APIs', 'Check dataset metadata, licence and API terms'),
  ('https://rtionline.gov.in/', null, 'RTI Online (Central authorities)', 'government', 'India', 'RTI', 'State authorities may require a state-specific mechanism')
on conflict (url) do nothing;

-- ── Triggers ────────────────────────────────────────────────────────────

create or replace function kasa_private.ev_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- Audit log, reviews and status history are append-only.
create or replace function kasa_private.ev_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'KASA_APPEND_ONLY' using detail = TG_TABLE_NAME || ' rows cannot be changed or deleted.';
end $$;

create or replace function kasa_private.ev_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.audit_log (actor_id, action, target_type, target_id, before, after)
  values (auth.uid(), lower(TG_OP), TG_TABLE_NAME,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id',
                   concat_ws(':', coalesce(to_jsonb(new), to_jsonb(old)) ->> 'harm_id', coalesce(to_jsonb(new), to_jsonb(old)) ->> 'assertion_id')),
          case when TG_OP <> 'INSERT' then to_jsonb(old) end,
          case when TG_OP <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- TG_ARGV[0] = status column, TG_ARGV[1] = its as-of date column (optional).
create or replace function kasa_private.ev_track_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new text := to_jsonb(new) ->> TG_ARGV[0];
  v_as  date := case when TG_NARGS > 1 then (to_jsonb(new) ->> TG_ARGV[1])::date end;
begin
  if TG_OP = 'INSERT' or v_new is distinct from (to_jsonb(old) ->> TG_ARGV[0]) then
    insert into kasa_private.status_history (target_type, target_id, field, value, as_of, actor_id)
    values (TG_TABLE_NAME, new.id, TG_ARGV[0], v_new, coalesce(v_as, current_date), auth.uid());
  end if;
  return new;
end $$;

-- A sensitive row, or one touching a person in an official role or a
-- criminal case, waits for the legal gate.
create or replace function kasa_private.ev_gate_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((kasa_private.cfg('legal_gate_open') #>> '{}')::boolean, false);
$$;

create or replace function kasa_private.ev_force_sensitive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (TG_TABLE_NAME = 'entities' and to_jsonb(new) ->> 'kind' = 'public_official')
     or (TG_TABLE_NAME = 'proceedings' and to_jsonb(new) ->> 'kind' = 'criminal')
     or (TG_TABLE_NAME = 'relationships' and exists (
           select 1 from kasa_private.entities e
           where e.id in ((to_jsonb(new) ->> 'from_entity_id')::bigint, (to_jsonb(new) ->> 'to_entity_id')::bigint)
             and e.sensitivity = 'sensitive')) then
    new.sensitivity := 'sensitive';
  end if;
  return new;
end $$;

create or replace function kasa_private.ev_link_sensitive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_TABLE_NAME = 'assertion_entities'
     and exists (select 1 from kasa_private.entities e where e.id = (to_jsonb(new) ->> 'entity_id')::bigint and e.sensitivity = 'sensitive') then
    update kasa_private.assertions set sensitivity = 'sensitive' where id = new.assertion_id and sensitivity <> 'sensitive';
  elsif TG_TABLE_NAME = 'assertion_proceedings'
     and exists (select 1 from kasa_private.proceedings p where p.id = (to_jsonb(new) ->> 'proceeding_id')::bigint and p.sensitivity = 'sensitive') then
    update kasa_private.assertions set sensitivity = 'sensitive' where id = new.assertion_id and sensitivity <> 'sensitive';
  end if;
  return new;
end $$;

-- Rules checked whenever something is about to go public.
create or replace function kasa_private.ev_publish_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case TG_TABLE_NAME when 'harms' then 'harm' when 'assertions' then 'assertion' when 'entities' then 'entity'
                   when 'relationships' then 'relationship' when 'proceedings' then 'proceeding' when 'money_records' then 'money'
                   when 'responses' then 'response' when 'remedies' then 'remedy' end;
  v_sens text := coalesce(to_jsonb(new) ->> 'sensitivity', 'public');
  v_approvals int;
  j jsonb := to_jsonb(new);
  v_need int := case when coalesce(to_jsonb(new) ->> 'sensitivity', 'public') = 'sensitive' then 2 else 1 end;
begin
  if new.publication_state <> 'published' or (TG_OP = 'UPDATE' and old.publication_state = 'published') then
    return new;
  end if;
  select count(distinct reviewer_id) into v_approvals from kasa_private.reviews
  where target_type = v_kind and target_id = new.id and decision = 'approve';
  if v_approvals < v_need then
    perform kasa_private.fail('KASA_NEEDS_REVIEW', case when v_sens = 'sensitive'
      then 'Sensitive records need two different moderators to approve.' else 'A moderator has to approve this first.' end);
  end if;
  if v_sens = 'sensitive' and not kasa_private.ev_gate_open() then
    perform kasa_private.fail('KASA_LEGAL_GATE', 'Records naming people in official roles or criminal cases stay private until legal review is done.');
  end if;
  if TG_TABLE_NAME = 'assertions' and not exists (
      select 1 from kasa_private.assertion_evidence ae
      join kasa_private.documents d on d.id = ae.document_id
      join kasa_private.sources s on s.id = d.source_id
      where ae.assertion_id = new.id and ae.role = 'supports' and ae.review_status = 'accepted'
        and s.validation_state <> 'blocked') then
    perform kasa_private.fail('KASA_NO_EVIDENCE', 'An assertion needs an accepted supporting document with a page or table reference.');
  elsif TG_TABLE_NAME = 'harms' then
    if coalesce(btrim(j ->> 'unknown_note'), '') = '' then
      perform kasa_private.fail('KASA_BAD_FORM', 'Say what is still not known before publishing.');
    end if;
    if not exists (select 1 from kasa_private.assertions a where a.harm_id = new.id and a.publication_state = 'published') then
      perform kasa_private.fail('KASA_NO_EVIDENCE', 'Publish at least one assertion for this harm first.');
    end if;
  elsif TG_TABLE_NAME = 'relationships' then
    if j ->> 'confidence' = 'tentative_candidate' then
      perform kasa_private.fail('KASA_TENTATIVE', 'Tentative links are never published.');
    end if;
    if exists (select 1 from kasa_private.entities e
               where e.id in ((j ->> 'from_entity_id')::bigint, (j ->> 'to_entity_id')::bigint) and e.publication_state <> 'published') then
      perform kasa_private.fail('KASA_BAD_FORM', 'Publish both entities first.');
    end if;
  elsif TG_TABLE_NAME = 'proceedings' and (j ->> 'stage_as_of' is null or j ->> 'stage_document_id' is null) then
    perform kasa_private.fail('KASA_NO_EVIDENCE', 'A case stage needs its date and the document that shows it.');
  elsif TG_TABLE_NAME = 'remedies' and not exists (
      select 1 from kasa_private.harms h where h.id = (j ->> 'harm_id')::bigint and h.publication_state = 'published') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Publish the harm first.');
  elsif TG_TABLE_NAME = 'responses' and j ->> 'document_id' is null and coalesce(j ->> 'url', '') = '' then
    perform kasa_private.fail('KASA_NO_EVIDENCE', 'A response needs its letter or the link where it was said.');
  end if;
  return new;
end $$;

-- "Outcome verified" needs a verified outcome, never just the office's word.
create or replace function kasa_private.ev_remedy_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.stage = 'outcome_verified' or new.action_status = 'verified_complete')
     and (TG_OP = 'INSERT' or old.stage is distinct from new.stage or old.action_status is distinct from new.action_status)
     and not exists (select 1 from kasa_private.outcomes o where o.remedy_id = new.id and o.verified) then
    perform kasa_private.fail('KASA_NO_EVIDENCE', 'Add a verified outcome (live photo, document or measurement) first.');
  end if;
  if new.stage = 'outcome_verified' and (TG_OP = 'INSERT' or old.stage is distinct from 'outcome_verified') then
    new.recheck_on := current_date + coalesce((kasa_private.cfg('remedy_recheck_days') #>> '{}')::int, 90);
  end if;
  if new.recurred then new.unresolved := true; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sources', 'entities', 'harms', 'assertions', 'relationships', 'proceedings', 'money_records', 'responses', 'remedies'] loop
    execute format('drop trigger if exists kasa_ev_touch on kasa_private.%I', t);
    execute format('create trigger kasa_ev_touch before update on kasa_private.%I for each row execute function kasa_private.ev_touch()', t);
  end loop;
  foreach t in array array['sources', 'documents', 'entities', 'harms', 'harm_reports', 'assertions', 'assertion_evidence',
      'assertion_entities', 'relationships', 'proceedings', 'assertion_proceedings', 'money_records', 'responses', 'remedies', 'outcomes'] loop
    execute format('drop trigger if exists kasa_ev_audit on kasa_private.%I', t);
    execute format('create trigger kasa_ev_audit after insert or update or delete on kasa_private.%I for each row execute function kasa_private.ev_audit()', t);
  end loop;
  foreach t in array array['entities', 'harms', 'assertions', 'relationships', 'proceedings', 'money_records', 'responses', 'remedies'] loop
    execute format('drop trigger if exists kasa_ev_publish on kasa_private.%I', t);
    execute format('create trigger kasa_ev_publish before insert or update on kasa_private.%I for each row execute function kasa_private.ev_publish_check()', t);
  end loop;
  foreach t in array array['audit_log', 'reviews', 'status_history'] loop
    execute format('drop trigger if exists kasa_ev_append_only on kasa_private.%I', t);
    execute format('create trigger kasa_ev_append_only before update or delete on kasa_private.%I for each row execute function kasa_private.ev_append_only()', t);
  end loop;
  foreach t in array array['entities', 'proceedings', 'relationships'] loop
    execute format('drop trigger if exists kasa_ev_sensitive on kasa_private.%I', t);
    execute format('create trigger kasa_ev_sensitive before insert or update on kasa_private.%I for each row execute function kasa_private.ev_force_sensitive()', t);
  end loop;
  foreach t in array array['assertion_entities', 'assertion_proceedings'] loop
    execute format('drop trigger if exists kasa_ev_link_sensitive on kasa_private.%I', t);
    execute format('create trigger kasa_ev_link_sensitive after insert on kasa_private.%I for each row execute function kasa_private.ev_link_sensitive()', t);
  end loop;
end $$;

drop trigger if exists kasa_ev_status on kasa_private.assertions;
create trigger kasa_ev_status after insert or update on kasa_private.assertions
  for each row execute function kasa_private.ev_track_status('evidence_state', 'evidence_as_of');
drop trigger if exists kasa_ev_status on kasa_private.proceedings;
create trigger kasa_ev_status after insert or update on kasa_private.proceedings
  for each row execute function kasa_private.ev_track_status('stage', 'stage_as_of');
drop trigger if exists kasa_ev_status on kasa_private.harms;
create trigger kasa_ev_status after insert or update on kasa_private.harms
  for each row execute function kasa_private.ev_track_status('harm_status');
drop trigger if exists kasa_ev_status on kasa_private.remedies;
create trigger kasa_ev_status after insert or update on kasa_private.remedies
  for each row execute function kasa_private.ev_track_status('stage');
drop trigger if exists kasa_ev_status2 on kasa_private.remedies;
create trigger kasa_ev_status2 after insert or update on kasa_private.remedies
  for each row execute function kasa_private.ev_track_status('action_status');
drop trigger if exists kasa_ev_remedy on kasa_private.remedies;
create trigger kasa_ev_remedy before insert or update on kasa_private.remedies
  for each row execute function kasa_private.ev_remedy_check();

-- ── Moderator RPCs ──────────────────────────────────────────────────────

-- Which table and which columns a moderator may write, per kind.
create or replace function kasa_private.ev_kind(p_kind text, out tbl text, out cols text[], out pub boolean)
language plpgsql immutable set search_path = '' as $$
begin
  pub := false;
  case p_kind
    when 'source' then tbl := 'sources'; cols := array['url', 'publisher', 'title', 'source_type', 'jurisdiction', 'domains', 'access_method', 'access_terms_url', 'update_frequency', 'limitations', 'validation_state', 'last_checked_at'];
    when 'source_run' then tbl := 'source_runs'; cols := array['source_id', 'fetched_at', 'http_status', 'sha256', 'archive_url', 'mime_type', 'parser_version', 'error', 'notes'];
    when 'document' then tbl := 'documents'; cols := array['source_id', 'source_run_id', 'url', 'title', 'source_class', 'document_type', 'published_on', 'retrieved_at', 'language', 'page_count', 'sha256', 'archive_url', 'rights_review', 'status', 'supersedes_id'];
    when 'entity' then tbl := 'entities'; pub := true; cols := array['kind', 'name', 'aliases', 'jurisdiction', 'district', 'lgd_code', 'identifier', 'identity_basis', 'ref_table', 'ref_id', 'sensitivity'];
    when 'harm' then tbl := 'harms'; pub := true; cols := array['title', 'description', 'domain', 'subdomain', 'state', 'district', 'block', 'local_body', 'lgd_code', 'period_from', 'period_to', 'affected_estimate', 'affected_basis', 'financial_exposure', 'financial_exposure_basis', 'unknown_note', 'harm_status', 'sensitivity'];
    when 'assertion' then tbl := 'assertions'; pub := true; cols := array['harm_id', 'headline', 'body', 'domain', 'district', 'event_from', 'event_to', 'evidence_state', 'evidence_as_of', 'uncertainty_note', 'right_of_reply_status', 'sensitivity'];
    when 'evidence' then tbl := 'assertion_evidence'; cols := array['assertion_id', 'document_id', 'locator', 'excerpt', 'role', 'rationale'];
    when 'relationship' then tbl := 'relationships'; pub := true; cols := array['from_entity_id', 'to_entity_id', 'kind', 'assertion_id', 'document_id', 'locator', 'rationale', 'confidence', 'valid_from', 'valid_to', 'sensitivity'];
    when 'proceeding' then tbl := 'proceedings'; pub := true; cols := array['kind', 'ref_no', 'forum', 'jurisdiction', 'filed_on', 'statutes', 'stage', 'stage_as_of', 'stage_document_id', 'official_url', 'summary', 'report_docket_id', 'sensitivity'];
    when 'money' then tbl := 'money_records'; pub := true; cols := array['harm_id', 'work_id', 'payer_entity_id', 'recipient_entity_id', 'proceeding_id', 'amount_basis', 'amount', 'as_of', 'financial_year', 'tender_ref', 'document_id', 'locator', 'notes'];
    when 'response' then tbl := 'responses'; pub := true; cols := array['target_type', 'target_id', 'from_entity_id', 'from_label', 'document_id', 'url', 'received_on', 'summary'];
    when 'remedy' then tbl := 'remedies'; pub := true; cols := array['harm_id', 'body_entity_id', 'responsible_label', 'requested_action', 'remedy_type', 'legal_basis_assertion_id', 'requested_on', 'due_on', 'stage', 'action_status', 'unresolved', 'recurred'];
    when 'outcome' then tbl := 'outcomes'; cols := array['remedy_id', 'metric', 'unit', 'baseline', 'observed', 'period_from', 'period_to', 'method', 'evidence_kind', 'evidence_ref', 'document_id'];
    else perform kasa_private.fail('KASA_BAD_FORM', 'Unknown record kind.');
  end case;
end $$;

-- Create (no id) or edit (with id) one record. Editing something already
-- public needs p_note, which goes in the public corrections log.
create or replace function public.kasa_admin_ev_save(p_kind text, p_row jsonb, p_id bigint default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k     record;
  v_set text[];
  v_id  bigint;
  v_pub text;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then perform kasa_private.fail('KASA_BAD_FORM', 'Nothing to save.'); end if;
  select * into k from kasa_private.ev_kind(p_kind);
  select array_agg(c) into v_set from unnest(k.cols) c where p_row ? c;
  if v_set is null then perform kasa_private.fail('KASA_BAD_FORM', 'Nothing to save.'); end if;
  if p_id is null then
    execute format('insert into kasa_private.%I (%s) select %s from jsonb_populate_record(null::kasa_private.%I, $1) returning id',
                   k.tbl, (select string_agg(quote_ident(c), ', ') from unnest(v_set) c),
                   (select string_agg(quote_ident(c), ', ') from unnest(v_set) c), k.tbl)
      using p_row into v_id;
  else
    if k.pub then
      execute format('select publication_state from kasa_private.%I where id = $1', k.tbl) using p_id into v_pub;
      if v_pub = 'published' then
        if coalesce(btrim(p_note), '') = '' then
          perform kasa_private.fail('KASA_BAD_FORM', 'This is public. Say what you corrected and why.');
        end if;
        insert into kasa_private.record_corrections (target_type, target_id, note, actor_id) values (p_kind, p_id, btrim(p_note), auth.uid());
      end if;
    end if;
    execute format('update kasa_private.%I t set (%s) = (select %s from jsonb_populate_record(null::kasa_private.%I, $1)) where t.id = $2 returning t.id',
                   k.tbl, (select string_agg(quote_ident(c), ', ') from unnest(v_set) c),
                   (select string_agg(quote_ident(c), ', ') from unnest(v_set) c), k.tbl)
      using p_row, p_id into v_id;
    if v_id is null then perform kasa_private.fail('KASA_NOT_FOUND', 'No such record.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Link rows that have no id of their own.
create or replace function public.kasa_admin_ev_link(p_kind text, p_a bigint, p_b text, p_role text default null,
    p_document_id bigint default null, p_rationale text default null, p_remove boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_kind = 'harm_report' then
    if p_remove then delete from kasa_private.harm_reports where harm_id = p_a and report_id = p_b;
    else
      if not exists (select 1 from public.kasa_public_reports v where v.id::text = p_b) then
        perform kasa_private.fail('KASA_NOT_FOUND', 'That report is not on the map.');
      end if;
      insert into kasa_private.harm_reports (harm_id, report_id) values (p_a, p_b) on conflict do nothing;
    end if;
  elsif p_kind = 'assertion_entity' then
    if p_remove then delete from kasa_private.assertion_entities where assertion_id = p_a and entity_id = p_b::bigint and role_label = p_role;
    else
      if coalesce(btrim(p_role), '') = '' or coalesce(btrim(p_rationale), '') = '' then
        perform kasa_private.fail('KASA_BAD_FORM', 'Say what role this entity has and why.');
      end if;
      insert into kasa_private.assertion_entities (assertion_id, entity_id, role_label, document_id, rationale)
      values (p_a, p_b::bigint, btrim(p_role), p_document_id, btrim(p_rationale)) on conflict do nothing;
    end if;
  elsif p_kind = 'assertion_proceeding' then
    if p_remove then delete from kasa_private.assertion_proceedings where assertion_id = p_a and proceeding_id = p_b::bigint;
    else
      if coalesce(btrim(p_rationale), '') = '' then perform kasa_private.fail('KASA_BAD_FORM', 'Say how the case relates.'); end if;
      insert into kasa_private.assertion_proceedings (assertion_id, proceeding_id, basis, document_id)
      values (p_a, p_b::bigint, btrim(p_rationale), p_document_id) on conflict do nothing;
    end if;
  else
    perform kasa_private.fail('KASA_BAD_FORM', 'Unknown link.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Approve / reject / ask for changes / archive. Approval publishes once
-- enough different moderators agree (two for sensitive records). For
-- evidence rows "approve" accepts the document; for outcomes it verifies.
create or replace function public.kasa_admin_ev_review(p_kind text, p_id bigint, p_decision text, p_rationale text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k       record;
  v_sens  text;
  v_need  int;
  v_have  int;
  v_state text;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_decision is null or p_decision not in ('approve', 'reject', 'request_changes', 'archive') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose a decision.');
  end if;
  if coalesce(btrim(p_rationale), '') = '' then perform kasa_private.fail('KASA_BAD_FORM', 'Give a reason.'); end if;
  select * into k from kasa_private.ev_kind(p_kind);
  execute format('select 1 from kasa_private.%I where id = $1', k.tbl) using p_id into v_have;
  if v_have is null then perform kasa_private.fail('KASA_NOT_FOUND', 'No such record.'); end if;
  insert into kasa_private.reviews (target_type, target_id, reviewer_id, decision, rationale)
  values (p_kind, p_id, auth.uid(), p_decision, btrim(p_rationale));

  if p_kind = 'evidence' then
    update kasa_private.assertion_evidence set review_status = case p_decision when 'approve' then 'accepted' when 'reject' then 'rejected' else 'pending' end,
           reviewer_id = auth.uid(), rationale = btrim(p_rationale) where id = p_id;
    return jsonb_build_object('ok', true, 'state', case p_decision when 'approve' then 'accepted' when 'reject' then 'rejected' else 'pending' end);
  elsif p_kind = 'outcome' then
    if p_decision = 'approve' then
      update kasa_private.outcomes set verified = true, verified_by = auth.uid(), verified_at = now() where id = p_id;
    elsif p_decision in ('reject', 'archive') then
      update kasa_private.outcomes set verified = false where id = p_id;
    end if;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'source' then
    update kasa_private.sources set validation_state = case p_decision when 'approve' then 'approved' when 'reject' then 'blocked'
             when 'archive' then 'retired' else validation_state end, last_checked_at = now() where id = p_id;
    return jsonb_build_object('ok', true);
  elsif not k.pub then
    return jsonb_build_object('ok', true);
  end if;

  if p_decision = 'approve' then
    execute format('select coalesce(to_jsonb(t) ->> ''sensitivity'', ''public''), publication_state from kasa_private.%I t where id = $1', k.tbl)
      using p_id into v_sens, v_state;
    v_need := case when v_sens = 'sensitive' then 2 else 1 end;
    select count(distinct reviewer_id) into v_have from kasa_private.reviews
    where target_type = p_kind and target_id = p_id and decision = 'approve'
      and created_at > coalesce((select max(created_at) from kasa_private.reviews
                                 where target_type = p_kind and target_id = p_id and decision in ('reject', 'request_changes', 'archive')), '-infinity');
    if v_state <> 'published' then
      execute format('update kasa_private.%I set publication_state = $2 where id = $1', k.tbl)
        using p_id, case when v_have >= v_need then 'published' else 'in_review' end;
    end if;
    return jsonb_build_object('ok', true, 'state', case when v_state = 'published' or v_have >= v_need then 'published' else 'in_review' end,
                              'approvals', v_have, 'needed', v_need);
  end if;
  execute format('update kasa_private.%I set publication_state = $2 where id = $1', k.tbl)
    using p_id, case p_decision when 'reject' then 'rejected' when 'archive' then 'archived' else 'draft' end;
  return jsonb_build_object('ok', true, 'state', case p_decision when 'reject' then 'rejected' when 'archive' then 'archived' else 'draft' end);
end $$;

-- Rows of one kind for the admin screen, newest first.
create or replace function public.kasa_admin_ev_list(p_kind text, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k     record;
  v_out jsonb;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_kind = 'submission' then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ref_no', s.ref_no, 'kind', s.kind, 'target_type', s.target_type,
             'target_id', s.target_id, 'url', s.url, 'body', s.body, 'status', s.status, 'reason', s.reason, 'created_at', s.created_at)
             order by s.id desc), '[]'::jsonb) into v_out
    from (select * from kasa_private.ev_submissions order by id desc limit least(greatest(p_limit, 1), 500)) s;
    return v_out;
  end if;
  select * into k from kasa_private.ev_kind(p_kind);
  execute format($q$
    select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('approvals',
             (select count(distinct r.reviewer_id) from kasa_private.reviews r
              where r.target_type = $1 and r.target_id = t.id and r.decision = 'approve')) order by t.id desc), '[]'::jsonb)
    from (select * from kasa_private.%I order by id desc limit $2) t $q$, k.tbl)
    using p_kind, least(greatest(p_limit, 1), 500) into v_out;
  return v_out;
end $$;

create or replace function public.kasa_admin_ev_triage_submission(p_id bigint, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_status is null or p_status not in ('triage', 'source_review', 'legal_privacy_review', 'needs_more_information', 'accepted', 'rejected', 'referred') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose a status.');
  end if;
  if p_status in ('rejected', 'needs_more_information', 'referred') and coalesce(btrim(p_reason), '') = '' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give the sender a reason.');
  end if;
  select status into v_old from kasa_private.ev_submissions where id = p_id;
  if v_old is null then perform kasa_private.fail('KASA_NOT_FOUND', 'No such submission.'); end if;
  update kasa_private.ev_submissions set status = p_status, reason = nullif(btrim(p_reason), ''), processed_at = now() where id = p_id;
  insert into kasa_private.audit_log (actor_id, action, target_type, target_id, before, after)
  values (auth.uid(), 'update', 'ev_submissions', p_id::text, jsonb_build_object('status', v_old),
          jsonb_build_object('status', p_status, 'reason', nullif(btrim(p_reason), '')));
  return jsonb_build_object('ok', true);
end $$;

-- ── Public RPCs ─────────────────────────────────────────────────────────

-- Every registered source with its check state (source coverage).
create or replace function public.kasa_ev_sources()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'url', s.url, 'publisher', s.publisher, 'title', s.title,
           'type', s.source_type, 'jurisdiction', s.jurisdiction, 'domains', s.domains, 'state', s.validation_state,
           'limitations', s.limitations, 'checked', s.last_checked_at::date,
           'documents', (select count(*) from kasa_private.documents d where d.source_id = s.id))
           order by s.validation_state = 'approved' desc, s.jurisdiction, s.title), '[]'::jsonb)
  from kasa_private.sources s where s.validation_state <> 'blocked';
$$;

create or replace function kasa_private.ev_doc(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'url', d.url, 'title', d.title, 'class', d.source_class, 'type', d.document_type,
           'published_on', d.published_on, 'retrieved_at', d.retrieved_at::date, 'sha256', d.sha256, 'archive_url', d.archive_url,
           'status', d.status, 'publisher', coalesce(s.publisher, s.title), 'source_url', s.url, 'source_state', s.validation_state)
  from kasa_private.documents d join kasa_private.sources s on s.id = d.source_id where d.id = p_id;
$$;

-- Published harms, filtered by district / domain / words.
create or replace function public.kasa_ev_harms(p_district text default null, p_domain text default null, p_q text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', 'H-' || h.id, 'title', h.title, 'domain', h.domain, 'district', h.district,
           'block', h.block, 'local_body', h.local_body, 'status', h.harm_status, 'period_from', h.period_from, 'period_to', h.period_to,
           'updated', h.updated_at::date,
           'assertions', (select count(*) from kasa_private.assertions a where a.harm_id = h.id and a.publication_state = 'published'),
           'remedy_stage', (select r.stage from kasa_private.remedies r where r.harm_id = h.id and r.publication_state = 'published' order by r.id desc limit 1))
           order by h.updated_at desc), '[]'::jsonb)
  from kasa_private.harms h
  where h.publication_state = 'published'
    and (p_district is null or h.district = p_district)
    and (p_domain is null or h.domain = p_domain)
    and (coalesce(btrim(p_q), '') = '' or (h.title || ' ' || h.description || ' ' || coalesce(h.local_body, '') || ' ' || coalesce(h.block, '')) ilike '%' || btrim(p_q) || '%');
$$;

create or replace function kasa_private.ev_history(p_type text, p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', field, 'value', value, 'as_of', as_of, 'at', created_at::date) order by id), '[]'::jsonb)
  from kasa_private.status_history where target_type = p_type and target_id = p_id;
$$;

create or replace function kasa_private.ev_entity_card(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', 'E-' || e.id, 'kind', e.kind, 'name', e.name, 'district', e.district, 'identifier', e.identifier)
  from kasa_private.entities e where e.id = p_id and e.publication_state = 'published';
$$;

-- One harm, end to end: every assertion with its supporting and contrary
-- documents, cases with their full stage history, money by kind, responses,
-- remedies with outcomes, linked map reports, corrections.
create or replace function public.kasa_ev_harm(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_id bigint := nullif(regexp_replace(coalesce(p_id, ''), '^[Hh]-', ''), '')::bigint;
  h    kasa_private.harms;
begin
  select * into h from kasa_private.harms where id = v_id and publication_state = 'published';
  if h.id is null then return null; end if;
  return jsonb_build_object(
    'id', 'H-' || h.id, 'title', h.title, 'description', h.description, 'domain', h.domain, 'subdomain', h.subdomain,
    'state', h.state, 'district', h.district, 'block', h.block, 'local_body', h.local_body, 'lgd_code', h.lgd_code,
    'period_from', h.period_from, 'period_to', h.period_to, 'affected_estimate', h.affected_estimate, 'affected_basis', h.affected_basis,
    'financial_exposure', h.financial_exposure, 'financial_exposure_basis', h.financial_exposure_basis,
    'unknown', h.unknown_note, 'status', h.harm_status, 'updated', h.updated_at::date,
    'history', kasa_private.ev_history('harms', h.id),
    'reports', (select coalesce(jsonb_agg(hr.report_id order by hr.created_at), '[]'::jsonb) from kasa_private.harm_reports hr
                where hr.harm_id = h.id and exists (select 1 from public.kasa_public_reports v where v.id::text = hr.report_id)),
    'assertions', (select coalesce(jsonb_agg(jsonb_build_object('id', 'A-' || a.id, 'headline', a.headline, 'body', a.body,
        'evidence_state', a.evidence_state, 'as_of', a.evidence_as_of, 'uncertainty', a.uncertainty_note, 'reply', a.right_of_reply_status,
        'history', kasa_private.ev_history('assertions', a.id),
        'evidence', (select coalesce(jsonb_agg(jsonb_build_object('role', ae.role, 'locator', ae.locator, 'excerpt', ae.excerpt,
                        'document', kasa_private.ev_doc(ae.document_id)) order by ae.role, ae.id), '[]'::jsonb)
                     from kasa_private.assertion_evidence ae where ae.assertion_id = a.id and ae.review_status = 'accepted'),
        'entities', (select coalesce(jsonb_agg(kasa_private.ev_entity_card(x.entity_id) || jsonb_build_object('role', x.role_label)), '[]'::jsonb)
                     from kasa_private.assertion_entities x join kasa_private.entities e on e.id = x.entity_id
                     where x.assertion_id = a.id and e.publication_state = 'published'),
        'proceedings', (select coalesce(jsonb_agg(jsonb_build_object('id', 'P-' || p.id, 'kind', p.kind, 'ref_no', p.ref_no, 'forum', p.forum,
                        'filed_on', p.filed_on, 'stage', p.stage, 'as_of', p.stage_as_of, 'url', p.official_url, 'summary', p.summary,
                        'document', kasa_private.ev_doc(p.stage_document_id), 'basis', ap.basis,
                        'history', kasa_private.ev_history('proceedings', p.id))), '[]'::jsonb)
                        from kasa_private.assertion_proceedings ap join kasa_private.proceedings p on p.id = ap.proceeding_id
                        where ap.assertion_id = a.id and p.publication_state = 'published')
      ) order by a.id), '[]'::jsonb)
      from kasa_private.assertions a where a.harm_id = h.id and a.publication_state = 'published'),
    'money', (select coalesce(jsonb_agg(jsonb_build_object('basis', m.amount_basis, 'amount', m.amount, 'as_of', m.as_of,
        'year', m.financial_year, 'tender_ref', m.tender_ref, 'locator', m.locator, 'notes', m.notes,
        'document', kasa_private.ev_doc(m.document_id)) order by m.as_of nulls last, m.id), '[]'::jsonb)
      from kasa_private.money_records m where m.harm_id = h.id and m.publication_state = 'published'),
    'responses', (select coalesce(jsonb_agg(jsonb_build_object('from', r.from_label, 'received_on', r.received_on, 'summary', r.summary,
        'url', r.url, 'document', kasa_private.ev_doc(r.document_id)) order by r.received_on), '[]'::jsonb)
      from kasa_private.responses r where r.publication_state = 'published'
        and ((r.target_type = 'harm' and r.target_id = h.id)
          or (r.target_type = 'assertion' and r.target_id in (select a.id from kasa_private.assertions a where a.harm_id = h.id))
          or (r.target_type = 'remedy' and r.target_id in (select rm.id from kasa_private.remedies rm where rm.harm_id = h.id)))),
    'remedies', (select coalesce(jsonb_agg(jsonb_build_object('id', 'R-' || rm.id, 'requested', rm.requested_action, 'type', rm.remedy_type,
        'responsible', coalesce(kasa_private.ev_entity_card(rm.body_entity_id) ->> 'name', rm.responsible_label),
        'requested_on', rm.requested_on, 'due_on', rm.due_on, 'stage', rm.stage, 'action_status', rm.action_status,
        'unresolved', rm.unresolved, 'recurred', rm.recurred, 'recheck_on', rm.recheck_on,
        'history', kasa_private.ev_history('remedies', rm.id),
        'outcomes', (select coalesce(jsonb_agg(jsonb_build_object('metric', o.metric, 'unit', o.unit, 'baseline', o.baseline, 'observed', o.observed,
                        'period_from', o.period_from, 'period_to', o.period_to, 'method', o.method, 'evidence_kind', o.evidence_kind,
                        'evidence_ref', o.evidence_ref, 'document', kasa_private.ev_doc(o.document_id), 'verified_at', o.verified_at::date)), '[]'::jsonb)
                     from kasa_private.outcomes o where o.remedy_id = rm.id and o.verified)) order by rm.id), '[]'::jsonb)
      from kasa_private.remedies rm where rm.harm_id = h.id and rm.publication_state = 'published'),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('what', c.target_type, 'note', c.note, 'at', c.created_at::date) order by c.id), '[]'::jsonb)
      from kasa_private.record_corrections c
      where (c.target_type = 'harm' and c.target_id = h.id)
         or (c.target_type = 'assertion' and c.target_id in (select a.id from kasa_private.assertions a where a.harm_id = h.id))
         or (c.target_type = 'remedy' and c.target_id in (select rm.id from kasa_private.remedies rm where rm.harm_id = h.id)))
  );
end $$;

-- One entity and its published links, one level out, each with its document.
create or replace function public.kasa_ev_entity(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_id bigint := nullif(regexp_replace(coalesce(p_id, ''), '^[Ee]-', ''), '')::bigint;
  e    kasa_private.entities;
begin
  select * into e from kasa_private.entities where id = v_id and publication_state = 'published';
  if e.id is null then return null; end if;
  return jsonb_build_object('id', 'E-' || e.id, 'kind', e.kind, 'name', e.name, 'aliases', e.aliases, 'jurisdiction', e.jurisdiction,
    'district', e.district, 'lgd_code', e.lgd_code, 'identifier', e.identifier, 'identity_basis', e.identity_basis,
    'links', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'direction', case when r.from_entity_id = e.id then 'out' else 'in' end,
        'other', kasa_private.ev_entity_card(case when r.from_entity_id = e.id then r.to_entity_id else r.from_entity_id end),
        'confidence', r.confidence, 'rationale', r.rationale, 'locator', r.locator, 'valid_from', r.valid_from, 'valid_to', r.valid_to,
        'document', kasa_private.ev_doc(r.document_id)) order by r.valid_from nulls last, r.id), '[]'::jsonb)
      from kasa_private.relationships r where r.publication_state = 'published' and e.id in (r.from_entity_id, r.to_entity_id)),
    'harms', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', 'H-' || h.id, 'title', h.title, 'status', h.harm_status, 'role', x.role_label)), '[]'::jsonb)
      from kasa_private.assertion_entities x
      join kasa_private.assertions a on a.id = x.assertion_id and a.publication_state = 'published'
      join kasa_private.harms h on h.id = a.harm_id and h.publication_state = 'published'
      where x.entity_id = e.id));
end $$;

-- Words across harms, entities and documents behind published assertions.
create or replace function public.kasa_ev_search(p_q text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with q as (select '%' || btrim(p_q) || '%' as w where length(btrim(coalesce(p_q, ''))) >= 2)
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    (select jsonb_build_object('type', 'harm', 'id', 'H-' || h.id, 'title', h.title, 'district', h.district) x
     from kasa_private.harms h, q where h.publication_state = 'published'
       and (h.title || ' ' || h.description || ' ' || coalesce(h.local_body, '')) ilike q.w limit 30)
    union all
    (select jsonb_build_object('type', 'entity', 'id', 'E-' || e.id, 'title', e.name, 'district', e.district, 'kind', e.kind)
     from kasa_private.entities e, q where e.publication_state = 'published'
       and (e.name || ' ' || coalesce(e.aliases, '') || ' ' || coalesce(e.identifier, '')) ilike q.w limit 30)
    union all
    (select jsonb_build_object('type', 'proceeding', 'id', 'P-' || p.id, 'title', coalesce(p.ref_no, p.kind) || coalesce(' · ' || p.forum, ''),
            'harm', (select 'H-' || a.harm_id from kasa_private.assertion_proceedings ap join kasa_private.assertions a on a.id = ap.assertion_id
                     where ap.proceeding_id = p.id and a.publication_state = 'published' and a.harm_id is not null limit 1))
     from kasa_private.proceedings p, q where p.publication_state = 'published' and (coalesce(p.ref_no, '') || ' ' || coalesce(p.forum, '')) ilike q.w limit 30)
  ) s;
$$;

-- Counts for the record page and transparency report. Each is a plain count
-- of rows in the stated state; definitions are on methodology.html#evidence.
create or replace function public.kasa_ev_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sources', (select coalesce(jsonb_object_agg(validation_state, n), '{}'::jsonb) from (select validation_state, count(*) n from kasa_private.sources group by 1) s),
    'documents', (select count(*) from kasa_private.documents),
    'harms', (select coalesce(jsonb_object_agg(harm_status, n), '{}'::jsonb) from (select harm_status, count(*) n from kasa_private.harms where publication_state = 'published' group by 1) s),
    'assertions', (select coalesce(jsonb_object_agg(evidence_state, n), '{}'::jsonb) from (select evidence_state, count(*) n from kasa_private.assertions where publication_state = 'published' group by 1) s),
    'remedies', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (select stage, count(*) n from kasa_private.remedies where publication_state = 'published' group by 1) s),
    'remedies_unresolved', (select count(*) from kasa_private.remedies where publication_state = 'published' and unresolved),
    'corrections', (select count(*) from kasa_private.record_corrections),
    'submissions', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from kasa_private.ev_submissions group by 1) s),
    'legal_gate_open', kasa_private.ev_gate_open()
  );
$$;

-- Anyone can send a source, document, correction, right of reply or extra
-- evidence. Nothing is published from it directly. The sender gets a
-- reference number and a private key to check its status.
create or replace function public.kasa_ev_submit(p_kind text, p_body text, p_url text default null,
    p_target_type text default null, p_target_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := kasa_private.ip_hash();
  v_body text := nullif(btrim(p_body), '');
  v_url  text := nullif(btrim(p_url), '');
  v_tid  bigint := nullif(regexp_replace(coalesce(p_target_id, ''), '^[A-Za-z]-', ''), '')::bigint;
  v_key  text := replace(gen_random_uuid()::text, '-', '');
  v_ref  text;
begin
  if p_kind is null or p_kind not in ('source', 'document', 'correction', 'right_of_reply', 'evidence', 'harm') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Choose what you are sending.');
  end if;
  if v_body is null or length(v_body) < 20 or length(v_body) > 4000 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Describe it in 20 to 4000 letters.');
  end if;
  if v_url is not null and (v_url !~* '^https?://[^ ]+\.[^ ]+$' or length(v_url) > 500) then
    perform kasa_private.fail('KASA_BAD_FORM', 'That link does not look right.');
  end if;
  if p_kind in ('source', 'document', 'evidence') and v_url is null then
    perform kasa_private.fail('KASA_BAD_FORM', 'Add the link to the document or page.');
  end if;
  if p_target_type is not null and p_target_type not in ('harm', 'assertion', 'entity', 'proceeding', 'remedy') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Unknown record.');
  end if;
  if kasa_private.text_verdict(v_body) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  perform kasa_private.net_limit('ev_submit', 5, 20, 'Too many sent from this network. Please try again later.');
  if (v_ip is not null and (select count(*) from kasa_private.ev_submissions where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10)
     or (select count(*) from kasa_private.ev_submissions where created_at > now() - interval '1 day') >= 300 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many sent right now. Please try again tomorrow.');
  end if;
  loop
    v_ref := 'S-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from kasa_private.ev_submissions where ref_no = v_ref);
  end loop;
  insert into kasa_private.ev_submissions (ref_no, key_hash, kind, target_type, target_id, url, body, ip_hash)
  values (v_ref, md5(v_key), p_kind, p_target_type, v_tid, v_url, v_body, v_ip);
  return jsonb_build_object('ok', true, 'ref_no', v_ref, 'key', v_key, 'status', 'received');
end $$;

create or replace function public.kasa_ev_submission_status(p_ref_no text, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref_no', s.ref_no, 'kind', s.kind, 'status', s.status, 'reason', s.reason,
                            'sent', s.created_at::date, 'updated', s.processed_at::date)
  from kasa_private.ev_submissions s where s.ref_no = upper(btrim(p_ref_no)) and s.key_hash = md5(coalesce(p_key, ''));
$$;

-- ── Grants ──────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['kasa_private.ev_touch()', 'kasa_private.ev_append_only()', 'kasa_private.ev_audit()', 'kasa_private.ev_track_status()',
      'kasa_private.ev_gate_open()', 'kasa_private.ev_force_sensitive()', 'kasa_private.ev_link_sensitive()', 'kasa_private.ev_publish_check()',
      'kasa_private.ev_remedy_check()', 'kasa_private.ev_kind(text)', 'kasa_private.ev_doc(bigint)', 'kasa_private.ev_history(text, bigint)',
      'kasa_private.ev_entity_card(bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.kasa_admin_ev_save(text, jsonb, bigint, text)',
      'public.kasa_admin_ev_link(text, bigint, text, text, bigint, text, boolean)',
      'public.kasa_admin_ev_review(text, bigint, text, text)', 'public.kasa_admin_ev_list(text, integer)',
      'public.kasa_admin_ev_triage_submission(bigint, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.kasa_ev_sources()', 'public.kasa_ev_harms(text, text, text)', 'public.kasa_ev_harm(text)',
      'public.kasa_ev_entity(text)', 'public.kasa_ev_search(text)', 'public.kasa_ev_stats()',
      'public.kasa_ev_submit(text, text, text, text, text)', 'public.kasa_ev_submission_status(text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
