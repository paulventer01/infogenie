# Centralized Marketing Ecosystem Spine

**Branch:** `cursor/ecosystem-spine-767a`  
**Purpose:** Move InfoGenie from “many panels” to a connected operating system: one data/health spine, close-loop actions, deeper P1 channels, execution connectors, and generalized agent orchestration.

## Priority order (shipped foundations)

### 1. Unified audience + attribution spine
- **Service:** `services/marketing_spine/`
- **API:** `/api/marketing-spine/{context,actions,suggest,resolve,apply/:id,dismiss/:id}`
- **UI:** Grow → **Ecosystem Spine** (`/grow/ecosystem-spine`)
- Aggregates audiences, pixels/CAPI, attribution runs, leads, brief, optimizer, and decision queues into one health score + gap list.

### 2. Close-loop automation
- Suggest pulls from Marketing Brief, Decision Engine, Optimizer, and spine gaps.
- Resolve orders an apply plan.
- Apply can:
  - create **Brand Calendar** items
  - create **SEO tasks** (or calendar fallback)
  - create **content draft** slots
  - deep-link to Optimizer / nav targets
- Soft-marks linked Decision Engine rows as acted.

### 3. P1 channel depth studios
- **API:** `/api/channel-studios/{newsletter,podcast,push,social-commerce,interactive}/status`
- **UI panels:**
  - Newsletter Studio — `/create/newsletter-studio`
  - Podcast Studio — `/create/podcast-studio`
  - Push Marketing — `/reach/push-marketing` (status-backed)
  - Social Commerce — `/reach/social-commerce` (status-backed)
  - Interactive Leads — `/reach/interactive-leads`

### 4. Execution integrations
- **API:** `/api/execution-hub/status`
- **Segment:** `/api/segment/{status,track,history}` (+ `segment_event_log`)
- **UI:** Manage → **Execution Hub** (`/manage/execution-hub`)
- Surfaces Canva, Mailchimp, Google PMax, LinkedIn Ads, Segment readiness.

### 5. Agent orchestration
- **Service:** `services/agent_orchestrator/`
- **API:** `/api/agent-orchestrator/{status,modules,suggest,resolve,apply,history}`
- **UI:** Manage → **Agent Orchestrator** (`/manage/agent-orchestrator`)
- Generalizes Calendar Assistant’s suggest → resolve → apply across spine + calendar (+ module capability map for decision/optimizer/remarketing).

## Tables
- `marketing_spine_events`
- `marketing_actions`
- `marketing_spine_runs`
- `agent_orchestrator_runs`
- `segment_event_log`

## What this is not
- Not a full CRM replacement (still syncs to HubSpot/Mailchimp)
- Not a programmatic DSP
- Not live Canva OAuth / LinkedIn campaign creation (scaffolded with honest status)

## Tests
```bash
node --test test/marketing-spine.test.js
```
