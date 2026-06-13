"use client";

// view id -> React component map for migrated dashboard panels.
//
// Keep this in lockstep with `lib/migratedViews.ts` (the MIGRATED_VIEWS list):
// every entry there should have a component here, and vice-versa. <MigratedPanel/>
// looks the active view up in this map to decide whether to render React or fall
// through to the replayed legacy panel.

import type { ComponentType } from "react";
import SeoRoadmap from "@/components/features/reach/SeoRoadmap";
import Deliverability from "@/components/features/reach/Deliverability";
import WebVitals from "@/components/features/reach/WebVitals";
import TechStack from "@/components/features/analyse/TechStack";
import GrowthMethodology from "@/components/features/manage/GrowthMethodology";
import WhiteLabel from "@/components/features/manage/WhiteLabel";
import BulkReports from "@/components/features/manage/BulkReports";
import ModelCompare from "@/components/features/manage/ModelCompare";
import WebAnalytics from "@/components/features/manage/WebAnalytics";
import VerticalPlaybooks from "@/components/features/manage/VerticalPlaybooks";
import Flywheel from "@/components/features/manage/Flywheel";
import Playbook7Day from "@/components/features/manage/Playbook7Day";
import NewProject from "@/components/features/manage/NewProject";
import MasterCalendar from "@/components/features/manage/MasterCalendar";
import BrandCalendar from "@/components/features/manage/BrandCalendar";
import Launches from "@/components/features/manage/Launches";
import AiTraffic from "@/components/features/manage/AiTraffic";
import Heatmaps from "@/components/features/manage/Heatmaps";
import BudgetBoard from "@/components/features/manage/BudgetBoard";
import AskInfoGenie from "@/components/features/manage/AskInfoGenie";
import AgentGoals from "@/components/features/manage/AgentGoals";
import AiProviders from "@/components/features/manage/AiProviders";
import MeetingNotes from "@/components/features/manage/MeetingNotes";
import TeamMeetings from "@/components/features/manage/TeamMeetings";
import Infographics from "@/components/features/manage/Infographics";
import Reengage from "@/components/features/manage/Reengage";
import Automations from "@/components/features/manage/Automations";
import EmployeeAdvocacy from "@/components/features/manage/EmployeeAdvocacy";
import SignalTriggers from "@/components/features/manage/SignalTriggers";
import Stakeholders from "@/components/features/manage/Stakeholders";
import Results from "@/components/features/manage/Results";
import WeeklyReport from "@/components/features/manage/WeeklyReport";
import CrossChannel from "@/components/features/manage/CrossChannel";
import Csuite from "@/components/features/manage/Csuite";
import InvestorMode from "@/components/features/manage/InvestorMode";
import Agency from "@/components/features/manage/Agency";
import Marketplace from "@/components/features/manage/Marketplace";
import Workspaces from "@/components/features/manage/Workspaces";
import Admin from "@/components/features/manage/Admin";
import TechnicalSuite from "@/components/features/manage/TechnicalSuite";
import BrandSafety from "@/components/features/manage/BrandSafety";
import DataProvenance from "@/components/features/manage/DataProvenance";
import Settings from "@/components/features/manage/Settings";

export const MIGRATED_COMPONENTS: Record<string, ComponentType> = {
  "seo-roadmap": SeoRoadmap,
  deliverability: Deliverability,
  "web-vitals": WebVitals,
  "tech-stack": TechStack,
  "growth-methodology": GrowthMethodology,
  "white-label": WhiteLabel,
  "bulk-reports": BulkReports,
  "model-compare": ModelCompare,
  "web-analytics": WebAnalytics,
  "vertical-playbooks": VerticalPlaybooks,
  flywheel: Flywheel,
  "playbook-7day": Playbook7Day,
  // ── Remainder of the Manage group (Phase 3 batch 2) ──────────────────────
  "new-project": NewProject,
  "master-calendar": MasterCalendar,
  "brand-calendar": BrandCalendar,
  launches: Launches,
  "ai-traffic": AiTraffic,
  heatmaps: Heatmaps,
  "budget-board": BudgetBoard,
  "ask-infogenie": AskInfoGenie,
  "agent-goals": AgentGoals,
  "ai-providers": AiProviders,
  "meeting-notes": MeetingNotes,
  "team-meetings": TeamMeetings,
  infographics: Infographics,
  reengage: Reengage,
  automations: Automations,
  "employee-advocacy": EmployeeAdvocacy,
  "signal-triggers": SignalTriggers,
  stakeholders: Stakeholders,
  results: Results,
  "weekly-report": WeeklyReport,
  "cross-channel": CrossChannel,
  csuite: Csuite,
  "investor-mode": InvestorMode,
  agency: Agency,
  marketplace: Marketplace,
  workspaces: Workspaces,
  admin: Admin,
  "technical-suite": TechnicalSuite,
  "brand-safety": BrandSafety,
  "data-provenance": DataProvenance,
  settings: Settings,
};
