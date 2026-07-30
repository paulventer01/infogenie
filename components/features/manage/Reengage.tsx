"use client";

// Native React port of the legacy `reengage` panel (was
// `window.buildReEngagement` in public/js/ig_reach_automation.js +
// `#view-reengage`, with drip helpers from public/js/ig_drip_serp.js). The
// Re-Engagement Hub is a 5-tab workspace (Lapsed Leads · Win-back Templates ·
// Sequence Builder · Competitor Steal · DM Sequences). Tab/filter/contacted
// state is ported to useState. The lapsed-lead database, win-back templates and
// DM sequences are seeded client-side exactly as the legacy builder did
// (derived from window.analysisData domain/industry/competitors). AI copy, the
// sequence-content generator and competitor counter-offers hit
// `POST /api/reengage-copy`; the live drip engine uses `GET /api/drips`,
// `GET /api/drips/stats`, `POST /api/drips/enroll` and
// `POST /api/drips/:id/:action` via lib/api. Real contacts + dry-run mode
// persist to localStorage, mirroring the legacy behaviour.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: { name?: string }[];
}

interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  value: number;
  daysDormant: number;
  lastSeen: string;
  priorityScore: number;
  bestChannel: string;
  reason: string;
  industry: string;
  contacted: boolean;
}

interface SeqStep {
  id: string;
  day: number;
  channel: string;
  icon: string;
  msg: string;
  label: string;
  tone: string;
  subject?: string;
}

interface Contact {
  email: string;
  name: string;
}

interface DripHistory {
  ok?: boolean;
  bounced?: boolean;
  bounceReason?: string;
}

interface Enrollment {
  id: string;
  name?: string;
  email: string;
  status: string;
  currentStep: number;
  sequence?: { label?: string }[];
  history?: DripHistory[];
  nextSendAt?: string;
  dryRun?: boolean;
}

interface DripStats {
  total?: number;
  active?: number;
  paused?: number;
  completed?: number;
  sentTotal?: number;
  failedTotal?: number;
  unsubscribed?: number;
  emailAttempts?: number;
  emailDelivered?: number;
  emailBounced?: number;
  emailComplained?: number;
  bounceRate?: number;
  complaintRate?: number;
}

interface ReengageEmail {
  subject?: string;
  body?: string;
}
interface ReengageAd {
  headline?: string;
  body?: string;
  cta?: string;
}
interface ReengageCopyResult {
  ok?: boolean;
  email?: ReengageEmail;
  ad?: ReengageAd;
  social?: string;
  counter?: string;
}

interface CopyTarget {
  id: string;
  name: string;
  company: string;
  channel: string;
  reason: string;
  value: number;
}

type TabId = "leads" | "templates" | "sequence" | "steal" | "dm";
type FilterId = "all" | "high" | "30-60" | "60-90" | "90plus";

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function sh(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const COMPANIES = ["Acme Corp", "BlueSky Ltd", "Nexus Digital", "Orbit Systems", "Pinnacle Group", "Vertex AI", "Solaris Co", "Atlas Media", "Crest Ventures", "Summit Tech", "Forge Solutions", "Zenith Labs", "Beacon Analytics", "Prism Consulting", "Nova Dynamics"];
const FIRST = ["James", "Sarah", "Michael", "Emma", "David", "Rachel", "Tom", "Nina", "Chris", "Priya", "Ben", "Laura", "Alex", "Mia", "Jordan"];
const LAST = ["Wilson", "Chen", "Roberts", "Patel", "Thompson", "Nguyen", "Davis", "Kim", "Martinez", "Johnson", "Lee", "Brown", "Garcia", "Smith", "Taylor"];
const CHANNELS = ["Email", "Retarget Ad", "LinkedIn DM", "SMS", "Facebook Ad", "TikTok Ad"];
const REASONS = ["Pricing concerns", "Competitor switch", "Feature gap", "Budget freeze", "Contract ended", "Inactivity"];
const CHANNEL_OPTS = ["Email", "Retarget Ad", "LinkedIn DM", "Facebook Ad", "TikTok Ad", "SMS", "Instagram DM"];

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "leads", icon: "👥", label: "Lapsed Leads" },
  { id: "templates", icon: "📋", label: "Win-back Templates" },
  { id: "sequence", icon: "⚡", label: "Sequence Builder" },
  { id: "steal", icon: "🎯", label: "Competitor Steal" },
  { id: "dm", icon: "💬", label: "DM Sequences" },
];

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All Leads" },
  { id: "high", label: "🔥 High Priority" },
  { id: "30-60", label: "30–60 Days" },
  { id: "60-90", label: "60–90 Days" },
  { id: "90plus", label: "90+ Days" },
];

const DEFAULT_SEQ: SeqStep[] = [
  { id: "s0", day: 0, channel: "Email", icon: "📧", msg: "", label: "Personal re-introduction", tone: "Empathetic & direct" },
  { id: "s1", day: 3, channel: "Retarget Ad", icon: "📱", msg: "", label: "Social proof carousel", tone: "Confident & benefit-led" },
  { id: "s2", day: 7, channel: "LinkedIn DM", icon: "💼", msg: "", label: "Value-first outreach", tone: "Professional & brief" },
  { id: "s3", day: 14, channel: "Email", icon: "📧", msg: "", label: "Limited-time offer", tone: "Urgency & scarcity" },
];

interface TemplateStep {
  day: number;
  channel: string;
  label: string;
  desc: string;
}
interface WinbackTemplate {
  id: string;
  icon: string;
  title: string;
  color: string;
  bg: string;
  border: string;
  desc: string;
  rate: string;
  leads: number;
  steps: TemplateStep[];
}

interface DmStep {
  day: number;
  msg: string;
}
interface DmSeq {
  id: string;
  icon: string;
  label: string;
  stage: string;
  color: string;
  bg: string;
  intro: string;
  steps: DmStep[];
}

const DM_SEQS: DmSeq[] = [
  {
    id: "warm", icon: "🔥", label: "Warm Lead DM", stage: "Conversion", color: "#F59E0B", bg: "#FFFBEB",
    intro: "Use after someone watches your Reel, replies to a Story, or engages 3+ times. Your goal: start a real conversation, not pitch.",
    steps: [
      { day: 0, msg: "Hey [Name]! Noticed you've been checking out our content — are you currently working on [problem area]? Happy to share what's been working for others in your space." },
      { day: 2, msg: "Quick follow-up — did you get a chance to look at what I sent? I've got a specific idea that might help [Name] with [their goal]. No strings attached." },
      { day: 5, msg: "Last one I promise 😄 — I put together a quick resource on [topic] that's been getting great results. Want me to drop it over? Takes 2 mins to read." },
    ],
  },
  {
    id: "testimonial", icon: "⭐", label: "Testimonial Request DM", stage: "Advocacy", color: "#7C3AED", bg: "#F5F3FF",
    intro: "Send to customers ~30 days after purchase or after they've had a win. Makes it personal and easy for them to say yes.",
    steps: [
      { day: 0, msg: "Hey [Name]! So glad to see how [specific result] has been going for you. I'd love to share your story — would you be open to a quick 2–3 sentence quote I could use? Totally your words, I'll just format it." },
      { day: 3, msg: "No pressure at all — even a single line like \"I went from X to Y\" would be amazing. Lots of people in similar situations look for this kind of proof before jumping in." },
    ],
  },
  {
    id: "referral", icon: "🌟", label: "Referral Ask DM", stage: "Advocacy", color: "#10B981", bg: "#ECFDF5",
    intro: "Send to your happiest clients. Keep it light and make it feel exclusive — like you're inviting them into a private circle.",
    steps: [
      { day: 0, msg: "Hey [Name]! Quick question — do you know anyone else dealing with [problem] that I could help? I'm taking on [X] new clients this month and I'd love for them to be in your network. You'd both get [specific benefit]." },
      { day: 4, msg: "Totally understand if no one comes to mind! If you do think of someone later, just send them my way. In the meantime, here's [valuable resource] — thought of you when I saw it." },
    ],
  },
  {
    id: "postpurchase", icon: "💎", label: "Post-Purchase DM", stage: "Nurture", color: "#3B82F6", bg: "#EFF6FF",
    intro: "Send within 24 hours of purchase. The goal is to make them feel like they made the right decision and start building loyalty.",
    steps: [
      { day: 0, msg: "Hey [Name]! So excited to have you on board 🙌 I wanted to personally check in — is there anything you need from me to get started? I'm here." },
      { day: 3, msg: "Quick check-in — how's everything going so far? Any early wins or questions? Don't hesitate to DM me directly — I reply to everyone." },
      { day: 7, msg: "One week in! I'd love to know how [specific thing] is going. A lot of people see [common early win] around this point. Anything we can do to accelerate that for you?" },
    ],
  },
  {
    id: "reactivation", icon: "🔄", label: "Reactivation DM", stage: "Conversion", color: "#EC4899", bg: "#FDF2F8",
    intro: "For followers who haven't engaged in 60+ days. Aim to re-spark curiosity with something new or a genuine check-in — no pitch.",
    steps: [
      { day: 0, msg: "Hey [Name], it's been a while! We've been working on something new around [relevant topic] and it reminded me of a conversation we had. Are you still working on [challenge]?" },
      { day: 3, msg: "Thought you might find this useful — [specific tip or insight relevant to their situation]. No need to reply, just wanted to drop some value your way." },
      { day: 7, msg: "Last one from me for now! We're opening up [offer/spots] for people who've been following for a while. If timing is ever right, I'd love to work together. Here's the link: [link]" },
    ],
  },
];

const cardBox: React.CSSProperties = { background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.04)" };
const thStyle: React.CSSProperties = { textAlign: "center", padding: "10px 14px", color: "#6B7280", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase" };

export default function Reengage() {
  const toast = useToast();

  const [tab, setTab] = useState<TabId>("leads");
  const [filter, setFilter] = useState<FilterId>("all");
  const [contacted, setContacted] = useState<Record<string, boolean>>({});

  const [seq, setSeq] = useState<SeqStep[]>(DEFAULT_SEQ);
  const [genningSeq, setGenningSeq] = useState(false);

  const [realContacts, setRealContacts] = useState<Contact[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [stats, setStats] = useState<DripStats>({});
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [dripError, setDripError] = useState<string | null>(null);

  const [counterResults, setCounterResults] = useState<Record<number, string>>({});
  const [counterLoading, setCounterLoading] = useState<Record<number, boolean>>({});

  const [copyTarget, setCopyTarget] = useState<CopyTarget | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyData, setCopyData] = useState<ReengageCopyResult | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copyTimer, setCopyTimer] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ad = useMemo(() => getAnalysisData(), []);
  const domain = (ad.url || "").replace(/https?:\/\//, "").split("/")[0] || "yourdomain.com";
  const industry = ad.industry?.name || "your industry";
  const comps = (ad.competitors || []).slice(0, 3);

  // ── Restore real contacts + dry-run from localStorage ─────────────────────
  useEffect(() => {
    try {
      setRealContacts(JSON.parse(localStorage.getItem("ig-drip-real-contacts") || "[]"));
      setDryRun(localStorage.getItem("ig-drip-dryrun") !== "0");
    } catch {
      setRealContacts([]);
      setDryRun(true);
    }
  }, []);

  // ── Seeded lapsed-lead database (faithful port of the legacy generator) ────
  const leads = useMemo<Lead[]>(() => {
    return Array.from({ length: 18 }, (_, i) => {
      const s = sh(domain + i);
      const daysDormant = 25 + (s % 110);
      const priorityScore = Math.min(99, Math.max(30, 95 - Math.floor(daysDormant * 0.4) + (s % 30)));
      const d = new Date();
      d.setDate(d.getDate() - daysDormant);
      return {
        id: "lead_" + i,
        name: FIRST[s % FIRST.length] + " " + LAST[(s + 3) % LAST.length],
        company: COMPANIES[s % COMPANIES.length],
        email: FIRST[s % FIRST.length].toLowerCase() + "@" + COMPANIES[s % COMPANIES.length].toLowerCase().replace(/\s/g, "") + ".com",
        value: 500 + (s % 3) * 800 + (sh("val" + i) % 2000),
        daysDormant,
        lastSeen: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        priorityScore,
        bestChannel: CHANNELS[(s + i) % CHANNELS.length],
        reason: REASONS[s % REASONS.length],
        industry,
        contacted: !!contacted["lead_" + i],
      };
    });
  }, [domain, industry, contacted]);

  const filteredLeads = leads.filter((l) => {
    if (filter === "high") return l.priorityScore >= 75;
    if (filter === "30-60") return l.daysDormant >= 30 && l.daysDormant < 60;
    if (filter === "60-90") return l.daysDormant >= 60 && l.daysDormant < 90;
    if (filter === "90plus") return l.daysDormant >= 90;
    return true;
  });

  const totalValue = leads.reduce((a, l) => a + l.value, 0);
  const highPri = leads.filter((l) => l.priorityScore >= 75).length;
  const avgDays = Math.round(leads.reduce((a, l) => a + l.daysDormant, 0) / leads.length);

  // ── Drip engine status ────────────────────────────────────────────────────
  const refreshDripStatus = useCallback(async () => {
    setDripError(null);
    const [statsR, listR] = await Promise.all([
      apiGet<{ ok?: boolean; error?: string; stats?: DripStats }>("/api/drips/stats"),
      apiGet<{ ok?: boolean; error?: string; enrollments?: Enrollment[] }>("/api/drips"),
    ]);
    if (statsR.ok === false && listR.ok === false) {
      setDripError(statsR.error || listR.error || "unavailable");
      return;
    }
    setStats(statsR.stats || {});
    setEnrollments((listR.enrollments || []).slice(0, 12));
  }, []);

  useEffect(() => {
    if (tab !== "sequence") return;
    refreshDripStatus();
  }, [tab, refreshDripStatus]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── AI copy modal timer ───────────────────────────────────────────────────
  useEffect(() => {
    if (!copyLoading) return;
    setCopyTimer(0);
    const start = performance.now();
    const t = setInterval(() => setCopyTimer((performance.now() - start) / 1000), 100);
    return () => clearInterval(t);
  }, [copyLoading]);

  function openCopyModal(target: CopyTarget) {
    setCopyTarget(target);
    setCopyData(null);
    setCopyFailed(false);
    setCopyLoading(true);
    let resolvedUrl = ad.url;
    if (!resolvedUrl) {
      try {
        resolvedUrl = localStorage.getItem("ig-last-analysed-url") || "";
      } catch {
        resolvedUrl = "";
      }
    }
    const dom = (resolvedUrl || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "yourdomain.com";
    const brandSlug = dom.split(".")[0] || "our";
    const brandName = brandSlug.charAt(0).toUpperCase() + brandSlug.slice(1);
    (async () => {
      const data = await apiPost<ReengageCopyResult>("/api/reengage-copy", {
        name: target.name, company: target.company, channel: target.channel, reason: target.reason,
        value: target.value, domain: dom, brandName, industry,
      });
      setCopyLoading(false);
      if (data.ok === false && !data.email && !data.ad && !data.social) {
        setCopyFailed(true);
        return;
      }
      setCopyData(data);
    })();
  }

  function closeCopyModal() {
    setCopyTarget(null);
    setCopyData(null);
    setCopyLoading(false);
  }

  function markContacted(id: string, name: string) {
    setContacted((prev) => ({ ...prev, [id]: true }));
    toast(`✅ ${name} marked as contacted`);
  }

  function copyText(text: string, msg: string) {
    navigator.clipboard?.writeText(text).then(() => toast(msg));
  }

  // ── Sequence builder helpers ──────────────────────────────────────────────
  function addStep() {
    setSeq((prev) => [
      ...prev,
      { id: "s" + Date.now(), day: (prev[prev.length - 1]?.day ?? 14) + 7 || 21, channel: "Email", icon: "📧", msg: "", label: "Follow-up step", tone: "Friendly" },
    ]);
  }
  function removeStep(i: number) {
    setSeq((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setStepChannel(i: number, channel: string) {
    setSeq((prev) => prev.map((s, idx) => (idx === i ? { ...s, channel } : s)));
  }
  function setStepDay(i: number, day: number) {
    setSeq((prev) => prev.map((s, idx) => (idx === i ? { ...s, day } : s)));
  }
  function clearStepMsg(i: number) {
    setSeq((prev) => prev.map((s, idx) => (idx === i ? { ...s, msg: "" } : s)));
  }

  async function generateSequenceContent() {
    setGenningSeq(true);
    let resolvedUrl = ad.url;
    if (!resolvedUrl) {
      try {
        resolvedUrl = localStorage.getItem("ig-last-analysed-url") || "";
      } catch {
        resolvedUrl = "";
      }
    }
    const dom = (resolvedUrl || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "yourdomain.com";
    const brandSlug = dom.split(".")[0] || "our";
    const brandName = brandSlug.charAt(0).toUpperCase() + brandSlug.slice(1);
    const next = [...seq];
    try {
      for (let i = 0; i < next.length; i++) {
        const s = next[i];
        const d = await apiPost<ReengageCopyResult>("/api/reengage-copy", {
          name: "[First Name]", company: "[Company]", channel: s.channel, reason: "inactivity",
          value: 1200, domain: dom, brandName, industry, step: s.label, tone: s.tone, sequenceStep: true,
        });
        if (s.channel === "Email" && d.email) {
          next[i] = { ...s, msg: `Subject: ${d.email.subject || ""}\n\n${d.email.body || ""}` };
        } else if (d.social) {
          next[i] = { ...s, msg: d.social };
        } else if (d.ad) {
          next[i] = { ...s, msg: `${d.ad.headline || ""}\n\n${d.ad.body || ""}\n\n${d.ad.cta || ""}` };
        }
      }
      setSeq(next);
      toast("✅ All sequence steps generated!");
    } catch {
      toast("⚠️ Generation failed — please retry");
    }
    setGenningSeq(false);
  }

  async function launchCustomSequence() {
    if (!seq.length) {
      toast("⚠️ No sequence steps defined");
      return;
    }
    if (seq.some((s) => !s.msg || !s.msg.trim())) {
      toast("⚠️ Generate the sequence content first (✨ Generate All Content)");
      return;
    }
    const isDry = dryRun || realContacts.length === 0;
    const contacts: Contact[] = realContacts.length
      ? realContacts.map((c) => ({ email: c.email, name: c.name }))
      : (() => {
          const out: Contact[] = [];
          const dom = (ad.url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "example.com";
          void dom;
          const COMP = ["Acme Corp", "BlueSky Ltd", "Nexus Digital", "Orbit Systems", "Pinnacle Group"];
          const F = ["James", "Sarah", "Michael", "Emma", "David"];
          for (let i = 0; i < 5; i++) {
            out.push({ email: `${F[i].toLowerCase()}@${COMP[i].toLowerCase().replace(/\s/g, "")}.com`, name: F[i] });
          }
          return out;
        })();
    if (!contacts.length) {
      toast('⚠️ Add at least one contact under "Real Contacts" first');
      return;
    }
    const j = await apiPost<{ ok?: boolean; enrolled?: number; skipped?: unknown[]; error?: string }>("/api/drips/enroll", {
      contacts,
      sequence: seq.map((s) => ({ day: s.day, channel: s.channel, label: s.label, msg: s.msg, subject: s.subject || s.label })),
      brand: (ad.url || "InfoGenie").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0],
      dryRun: isDry,
      appOrigin: typeof window !== "undefined" ? window.location.origin : "",
    });
    if (j.ok === false) {
      toast("❌ Launch failed: " + (j.error || "error"));
      return;
    }
    toast(`🚀 Sequence launched! ${j.enrolled ?? 0} enrolled${isDry ? " (dry-run)" : ""}${j.skipped?.length ? `, ${j.skipped.length} skipped` : ""}`);
    refreshDripStatus();
    if (pollRef.current) clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = setInterval(() => {
      if (++ticks > 6) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        return;
      }
      refreshDripStatus();
    }, 5000);
  }

  function persistContacts(list: Contact[]) {
    try {
      localStorage.setItem("ig-drip-real-contacts", JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
  function addRealContact() {
    const email = newEmail.trim().toLowerCase();
    const name = newName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("⚠️ Enter a valid email");
      return;
    }
    if (realContacts.find((c) => c.email === email)) {
      toast("Already added");
      return;
    }
    const list = [...realContacts, { email, name }];
    setRealContacts(list);
    persistContacts(list);
    setNewName("");
    setNewEmail("");
    toast(`✅ Added ${email}`);
  }
  function removeRealContact(email: string) {
    const list = realContacts.filter((c) => c.email !== email);
    setRealContacts(list);
    persistContacts(list);
  }
  function toggleDripDryRun(on: boolean) {
    setDryRun(on);
    try {
      localStorage.setItem("ig-drip-dryrun", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  async function dripAction(id: string, action: string) {
    const r = await apiPost<{ ok?: boolean }>(`/api/drips/${id}/${action}`);
    if (r.ok !== false) {
      toast(`✓ ${action}d`);
      refreshDripStatus();
    } else {
      toast("Failed");
    }
  }

  // ── Competitor steal ──────────────────────────────────────────────────────
  const stealComps = comps.length > 0 ? comps : [{ name: "Competitor A" }, { name: "Competitor B" }, { name: "Competitor C" }];
  const stealData = stealComps.map((c, i) => {
    const name = c.name || `Competitor ${i + 1}`;
    const s = sh(name + domain);
    const offers: [string, string][] = [
      ["Free trial extended to 30 days", "Aggressive free-tier to lure trial users"],
      ["Discounted annual plan (30% off)", "Price undercutting on annual commitment"],
      ["New AI features released", "Feature parity threat — capturing attention"],
      ["Referral bonus program", "Viral growth via existing customer base"],
      ["White-glove onboarding", "Service differentiation targeting switchers"],
    ];
    const stealReasons = ["Pricing", "Features", "Support", "Onboarding", "Content"][i % 5];
    return {
      name,
      offer: offers[s % offers.length][0],
      why: offers[s % offers.length][1],
      angle: stealReasons,
      threat: ["High", "Medium", "Medium", "High", "Low"][s % 5],
      color: ["#DC2626", "#D97706", "#7C3AED"][i % 3],
      idx: i,
    };
  });

  async function generateCounterOffer(idx: number, compName: string, offer: string, angle: string) {
    setCounterLoading((prev) => ({ ...prev, [idx]: true }));
    const dom = ad.url?.replace(/https?:\/\//, "").split("/")[0] || "yourdomain.com";
    const data = await apiPost<ReengageCopyResult>("/api/reengage-copy", {
      counterOffer: true, compName, offer, angle, domain: dom, industry,
    });
    if (data.counter) {
      setCounterResults((prev) => ({ ...prev, [idx]: data.counter as string }));
    }
    setCounterLoading((prev) => ({ ...prev, [idx]: false }));
  }

  // ── Win-back templates (seeded, depend on lead counts) ────────────────────
  const templates: WinbackTemplate[] = [
    {
      id: "t1", icon: "⚡", title: "30-Day Lapse", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A",
      desc: "For leads who went quiet in the last month — highest re-engagement rate. Strike while intent is still warm.",
      rate: "62%", leads: leads.filter((l) => l.daysDormant < 35).length,
      steps: [
        { day: 0, channel: "📧 Email", label: "Personal re-intro", desc: "From the founder — personal tone, acknowledge the gap, offer value" },
        { day: 3, channel: "📱 Retarget", label: "Social proof ad", desc: "Carousel of customer success stories on Meta + Google Display" },
        { day: 7, channel: "💼 LinkedIn", label: "Connection + note", desc: "Short value-first LinkedIn message, no pitch" },
        { day: 10, channel: "📧 Email", label: "Limited-time offer", desc: "10% off or extended trial — expires in 72 hours" },
      ],
    },
    {
      id: "t2", icon: "🔥", title: "60-Day Lapse", color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE",
      desc: "Contacts who slipped away 1–2 months ago. Acknowledge the silence and lead with a compelling new value angle.",
      rate: "44%", leads: leads.filter((l) => l.daysDormant >= 30 && l.daysDormant < 70).length,
      steps: [
        { day: 0, channel: "📧 Email", label: "\"We noticed you've been quiet\"", desc: "Empathy-first email, no hard sell, ask what changed" },
        { day: 5, channel: "📱 Facebook", label: "New feature/offer ad", desc: "Highlight what's new since they left" },
        { day: 12, channel: "📧 Email", label: "Competitor comparison", desc: "Brief, factual comparison — why you're the better choice now" },
        { day: 18, channel: "📱 Retarget", label: "Win-back discount ad", desc: "Personalised offer ad — mention their company name via audience segment" },
        { day: 22, channel: "📧 Email", label: "Final outreach", desc: "Last chance framing, keep it short, direct CTA" },
      ],
    },
    {
      id: "t3", icon: "🧊", title: "90-Day Deep Freeze", color: "#0066FF", bg: "#EFF6FF", border: "#BFDBFE",
      desc: "Long-dormant leads. Re-introduce yourself almost from scratch — lead with transformation, not product.",
      rate: "28%", leads: leads.filter((l) => l.daysDormant >= 70).length,
      steps: [
        { day: 0, channel: "📧 Email", label: "\"A lot has changed…\"", desc: "Brand reset email — show how the product/service has evolved" },
        { day: 7, channel: "📱 TikTok", label: "Brand awareness video", desc: "Short-form video ad targeting lookalike segments of lost customers" },
        { day: 14, channel: "📧 Email", label: "Social proof case study", desc: "One compelling success story directly relevant to their industry" },
        { day: 21, channel: "💼 LinkedIn", label: "Direct message outreach", desc: "Personalized note referencing their company or role" },
        { day: 28, channel: "📱 Retarget", label: "Re-engagement offer", desc: "Exclusive \"welcome back\" pricing or bonus" },
        { day: 35, channel: "📧 Email", label: "Break-up email", desc: "Playful final email — often triggers the most replies" },
      ],
    },
    {
      id: "t4", icon: "🎁", title: "Post-Purchase Re-activate", color: "#059669", bg: "#F0FDF4", border: "#BBF7D0",
      desc: "Customers who bought once but didn't return. Drive repeat purchase with loyalty hooks and cross-sell angles.",
      rate: "55%", leads: Math.floor(leads.length * 0.4),
      steps: [
        { day: 0, channel: "📧 Email", label: "\"How are you getting on?\"", desc: "Check-in email — ask for feedback, show you care" },
        { day: 4, channel: "📱 Facebook", label: "Cross-sell product ad", desc: "Show complementary products/services based on first purchase" },
        { day: 10, channel: "📧 Email", label: "Loyalty reward", desc: "Exclusive repeat-buyer discount or early access offer" },
        { day: 16, channel: "📱 Retarget", label: "Testimonial retarget", desc: "Video testimonial ad from similar customer profile" },
      ],
    },
  ];

  function priBadge(s: number) {
    if (s >= 75) return <span style={{ background: "#FEF2F2", color: "#DC2626", borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>🔥 {s}</span>;
    if (s >= 55) return <span style={{ background: "#FFFBEB", color: "#D97706", borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>⚡ {s}</span>;
    return <span style={{ background: "#F3F4F6", color: "#6B7280", borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>{s}</span>;
  }

  // ── Shared blocks ─────────────────────────────────────────────────────────
  const hero = (
    <div style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", borderRadius: 20, padding: "28px 32px", marginBottom: 24, position: "relative", overflow: "hidden", boxShadow: "0 12px 32px rgba(15,23,42,0.25)" }}>
      <div style={{ position: "absolute", top: -30, right: -30, width: 220, height: 220, background: "radial-gradient(circle,rgba(251,146,60,0.35),transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", bottom: -60, right: 80, width: 180, height: 180, background: "radial-gradient(circle,rgba(245,158,11,0.22),transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", top: 20, left: -40, width: 140, height: 140, background: "radial-gradient(circle,rgba(217,119,6,0.18),transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: "0.6rem", fontWeight: 800, color: "#FDBA74", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 4 }}>Grow › Re-Engage</div>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#FED7AA", textTransform: "uppercase", letterSpacing: ".14em", marginBottom: 6 }}>Re-Engagement Hub</div>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.7rem", fontWeight: 800, color: "#FFFFFF", lineHeight: 1.2, marginBottom: 8, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>Turn Lost Leads Into<br />Revenue — Automatically</div>
        <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.92)", maxWidth: 480, lineHeight: 1.55 }}>AI-identifies your highest-value lapsed contacts, generates personalised win-back copy across email, ads, and social — then launches re-engagement campaigns directly from InfoGenie.</div>
      </div>
    </div>
  );

  const kpiTiles = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
      {[
        { icon: "👥", label: "Lapsed Contacts", value: leads.length, color: "#D97706", sub: "Detected by AI", bg: "#FFFBEB", border: "#FDE68A" },
        { icon: "🔥", label: "High Priority", value: highPri, color: "#DC2626", sub: "Score ≥ 75", bg: "#FEF2F2", border: "#FECACA" },
        { icon: "💰", label: "Est. Recovery Value", value: "$" + totalValue.toLocaleString(), color: "#059669", sub: "If re-engaged", bg: "#F0FDF4", border: "#BBF7D0" },
        { icon: "📅", label: "Avg Days Dormant", value: avgDays + "d", color: "#7C3AED", sub: "Across all leads", bg: "#F5F3FF", border: "#DDD6FE" },
      ].map((k) => (
        <div key={k.label} style={{ background: k.bg, border: `1.5px solid ${k.border}`, borderRadius: 16, padding: "18px 16px" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>{k.icon}</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: k.color, marginBottom: 2 }}>{k.value}</div>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151" }}>{k.label}</div>
          <div style={{ fontSize: "0.63rem", color: "#9CA3AF", marginTop: 2 }}>{k.sub}</div>
        </div>
      ))}
    </div>
  );

  const tabBar = (
    <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E5E7EB", marginBottom: 24, background: "white", borderRadius: "14px 14px 0 0", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
      {TABS.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "14px 8px", border: "none", borderBottom: `3px solid ${tab === t.id ? "#F59E0B" : "transparent"}`, background: tab === t.id ? "#FFFBEB" : "white", fontSize: "0.8rem", fontWeight: tab === t.id ? 800 : 600, color: tab === t.id ? "#D97706" : "#6B7280", cursor: "pointer", transition: "all .15s" }}>
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );

  const statColor = (rate: number | undefined, hi: number, mid: number) => ((rate ?? 0) >= hi ? "#DC2626" : (rate ?? 0) >= mid ? "#D97706" : "#059669");

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", padding: "28px 32px" }}>
      {hero}
      {kpiTiles}
      {tabBar}

      {/* ════════════ LAPSED LEADS ════════════ */}
      {tab === "leads" && (
        <div style={cardBox}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>Lapsed Lead Database</div>
              <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>AI-scored by re-engagement likelihood · {filteredLeads.length} of {leads.length} shown</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: "7px 14px", border: `1.5px solid ${filter === f.id ? "#D97706" : "#E5E7EB"}`, borderRadius: 8, background: filter === f.id ? "#FFFBEB" : "white", fontSize: "0.72rem", fontWeight: filter === f.id ? 700 : 500, color: filter === f.id ? "#D97706" : "#6B7280", cursor: "pointer" }}>{f.label}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E5E7EB" }}>
                  <th style={{ ...thStyle, textAlign: "left" }}>Contact</th>
                  <th style={thStyle}>AI Score</th>
                  <th style={thStyle}>Days Gone</th>
                  <th style={thStyle}>Last Seen</th>
                  <th style={thStyle}>Best Channel</th>
                  <th style={thStyle}>Value</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((l) => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #F3F4F6", opacity: l.contacted ? 0.55 : 1 }}>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.82rem" }}>{l.name}</div>
                      <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>{l.company}</div>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "center" }}>{priBadge(l.priorityScore)}</td>
                    <td style={{ padding: "12px 14px", textAlign: "center", fontSize: "0.75rem", color: "#374151" }}>{l.daysDormant}d</td>
                    <td style={{ padding: "12px 14px", textAlign: "center", fontSize: "0.75rem", color: "#374151" }}>{l.lastSeen}</td>
                    <td style={{ padding: "12px 14px", textAlign: "center" }}>
                      <span style={{ background: "#EFF6FF", color: "#0066FF", borderRadius: 6, padding: "2px 8px", fontSize: "0.65rem", fontWeight: 700 }}>{l.bestChannel}</span>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "center", fontSize: "0.75rem", fontWeight: 700, color: "#059669" }}>${l.value.toLocaleString()}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 5, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                        {l.contacted ? (
                          <span style={{ fontSize: "0.68rem", color: "#059669", fontWeight: 700 }}>✓ Contacted</span>
                        ) : (
                          <>
                            <button onClick={() => openCopyModal({ id: l.id, name: l.name, company: l.company, channel: l.bestChannel, reason: l.reason, value: l.value })} style={{ padding: "5px 10px", background: "linear-gradient(135deg,#D97706,#B45309)", border: "none", borderRadius: 7, fontSize: "0.65rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>✨ AI Copy</button>
                            <button onClick={() => markContacted(l.id, l.name)} style={{ padding: "5px 10px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 7, fontSize: "0.65rem", fontWeight: 600, color: "#059669", cursor: "pointer", whiteSpace: "nowrap" }}>✓ Done</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredLeads.length === 0 && <div style={{ textAlign: "center", padding: 32, color: "#9CA3AF", fontSize: "0.82rem" }}>No leads match this filter</div>}
        </div>
      )}

      {/* ════════════ WIN-BACK TEMPLATES ════════════ */}
      {tab === "templates" && (
        <>
          {templates.map((t) => (
            <div key={t.id} style={{ background: t.bg, border: `1.5px solid ${t.border}`, borderRadius: 18, padding: "22px 24px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: "1.6rem" }}>{t.icon}</span>
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628" }}>{t.title}</div>
                      <div style={{ fontSize: "0.68rem", color: t.color, fontWeight: 700 }}>{t.leads} matching leads · {t.rate} avg re-engage rate</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.5 }}>{t.desc}</div>
                </div>
                <button onClick={() => toast(`🚀 "${t.title}" campaign launched for ${t.leads} leads — tracking in Results`)} style={{ padding: "10px 20px", background: `linear-gradient(135deg,${t.color},${t.color}CC)`, border: "none", borderRadius: 10, fontSize: "0.8rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>🚀 Launch Campaign</button>
              </div>
              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
                <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Sequence</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {t.steps.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {i > 0 && <div style={{ color: "#D1D5DB", fontSize: "0.7rem" }}>→</div>}
                      <div style={{ background: "white", border: `1px solid ${t.border}`, borderRadius: 10, padding: "7px 10px", fontSize: "0.68rem" }}>
                        <div style={{ fontWeight: 700, color: "#0A1628", marginBottom: 2 }}>{s.channel}</div>
                        <div style={{ color: t.color, fontWeight: 600 }}>Day {s.day}</div>
                        <div style={{ color: "#6B7280", marginTop: 1, maxWidth: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ════════════ SEQUENCE BUILDER ════════════ */}
      {tab === "sequence" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20, alignItems: "flex-start" }}>
          <div>
            <div style={{ ...cardBox, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>Custom Sequence Builder</div>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>{seq.length}-step sequence · Drag to reorder, edit channels and timing</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={addStep} style={{ padding: "8px 14px", background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: "0.75rem", fontWeight: 600, color: "#374151", cursor: "pointer" }}>+ Add Step</button>
                  <button onClick={generateSequenceContent} disabled={genningSeq} style={{ padding: "8px 16px", background: "linear-gradient(135deg,#D97706,#B45309)", border: "none", borderRadius: 9, fontSize: "0.75rem", fontWeight: 700, color: "white", cursor: "pointer", opacity: genningSeq ? 0.7 : 1 }}>{genningSeq ? "⏳ Generating…" : "✨ Generate All Content"}</button>
                </div>
              </div>
              {seq.map((s, i) => (
                <div key={s.id} style={{ background: "white", border: "1.5px solid #E5E7EB", borderRadius: 14, padding: "18px 20px", marginBottom: 10, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#D97706,#B45309)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", color: "white", fontWeight: 800 }}>{i + 1}</div>
                    {i < seq.length - 1 && <div style={{ width: 2, height: 24, background: "#E5E7EB", margin: "2px 0" }} />}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <select value={s.channel} onChange={(e) => setStepChannel(i, e.target.value)} style={{ padding: "6px 10px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontSize: "0.75rem", color: "#0A1628", background: "white", fontFamily: "'Inter',sans-serif" }}>
                        {CHANNEL_OPTS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>Day</span>
                        <input type="number" value={s.day} min={0} onChange={(e) => setStepDay(i, +e.target.value)} style={{ width: 52, padding: "5px 8px", border: "1.5px solid #E5E7EB", borderRadius: 7, fontSize: "0.75rem", color: "#0A1628", textAlign: "center" }} />
                      </div>
                      <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#D97706" }}>{s.label}</span>
                    </div>
                    {s.msg ? (
                      <>
                        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 14px", fontSize: "0.75rem", color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{s.msg}</div>
                        <button onClick={() => clearStepMsg(i)} style={{ marginTop: 6, padding: "4px 10px", background: "white", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: "0.65rem", color: "#9CA3AF", cursor: "pointer" }}>✕ Clear</button>
                      </>
                    ) : (
                      <div style={{ fontSize: "0.72rem", color: "#9CA3AF", fontStyle: "italic" }}>No AI content yet — click &quot;Generate All Content&quot; below</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {i > 0 && <button onClick={() => removeStep(i)} style={{ width: 28, height: 28, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, fontSize: "0.75rem", color: "#DC2626", cursor: "pointer", lineHeight: "28px", textAlign: "center" }}>✕</button>}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={launchCustomSequence} style={{ width: "100%", padding: 13, background: "linear-gradient(135deg,#D97706,#B45309)", border: "none", borderRadius: 12, fontSize: "0.88rem", fontWeight: 700, color: "white", cursor: "pointer" }}>🚀 Launch This Sequence to All High-Priority Leads</button>

            {/* Live Drip Engine status panel */}
            <div style={{ ...cardBox, borderRadius: 14, padding: 16, marginTop: 14 }}>
              {dripError ? (
                <div style={{ padding: 14, color: "#DC2626", fontSize: "0.78rem" }}>Drip status unavailable: {dripError}</div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>⚡ Live Drip Engine</div>
                      <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 2 }}>Server-side scheduler · processes due steps every 60 seconds</div>
                    </div>
                    <button onClick={refreshDripStatus} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 600, color: "#374151", cursor: "pointer" }}>↻ Refresh</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(78px,1fr))", gap: 8, marginBottom: 10 }}>
                    {([
                      ["Total", stats.total || 0, "#0A1628"],
                      ["Active", stats.active || 0, "#059669"],
                      ["Paused", stats.paused || 0, "#D97706"],
                      ["Completed", stats.completed || 0, "#6B7280"],
                      ["Sent", stats.sentTotal || 0, "#0066FF"],
                      ["Failed", stats.failedTotal || 0, stats.failedTotal ? "#DC2626" : "#6B7280"],
                      ["Unsubbed", stats.unsubscribed || 0, "#DC2626"],
                    ] as [string, number, string][]).map(([label, val, color]) => (
                      <div key={label} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", textAlign: "center", minWidth: 0 }}>
                        <div style={{ fontSize: "1.15rem", fontWeight: 800, color }}>{val}</div>
                        <div style={{ fontSize: "0.62rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(96px,1fr))", gap: 8, marginBottom: 14, padding: 10, background: "linear-gradient(135deg,#FEF2F2,#FFF7ED)", border: "1px solid #FECACA", borderRadius: 10 }}>
                    <div style={{ gridColumn: "1/-1", fontSize: "0.62rem", fontWeight: 700, color: "#991B1B", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 2 }}>📬 Email Deliverability {stats.emailAttempts ? `· ${stats.emailAttempts} live attempt${stats.emailAttempts === 1 ? "" : "s"}` : "· no live email sends yet"}</div>
                    {([
                      ["Attempts", stats.emailAttempts || 0, "#0A1628"],
                      ["Delivered", stats.emailDelivered || 0, "#059669"],
                      ["Bounced", stats.emailBounced || 0, stats.emailBounced ? "#DC2626" : "#6B7280"],
                      ["Complaint", stats.emailComplained || 0, stats.emailComplained ? "#DC2626" : "#6B7280"],
                      ["Bounce %", stats.emailAttempts ? (stats.bounceRate || 0) + "%" : "—", statColor(stats.bounceRate, 5, 2)],
                      ["Spam %", stats.emailAttempts ? (stats.complaintRate || 0) + "%" : "—", statColor(stats.complaintRate, 0.5, 0.1)],
                    ] as [string, string | number, string][]).map(([label, val, color]) => (
                      <div key={label} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", textAlign: "center", minWidth: 0 }}>
                        <div style={{ fontSize: "1.15rem", fontWeight: 800, color }}>{val}</div>
                        <div style={{ fontSize: "0.62rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  {(stats.bounceRate ?? 0) >= 5 && (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderLeft: "3px solid #DC2626", borderRadius: 8, padding: "9px 12px", marginBottom: 12, fontSize: "0.72rem", color: "#991B1B" }}>⚠️ <b>Bounce rate is high ({stats.bounceRate}%).</b> Industry threshold is 2%; above 5% triggers ESP throttling. Likely cause: invalid recipient addresses or unverified sending domain.</div>
                  )}
                  <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#374151", marginBottom: 8 }}>Real contacts (will receive live emails when dry-run is OFF)</div>
                    {realContacts.length ? (
                      realContacts.map((c) => (
                        <div key={c.email} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                          <div style={{ fontSize: "0.74rem", color: "#0A1628" }}><b>{c.name || c.email.split("@")[0]}</b> <span style={{ color: "#6B7280" }}>· {c.email}</span></div>
                          <button onClick={() => removeRealContact(c.email)} style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: "0.7rem" }}>✕</button>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: "0.72rem", color: "#9CA3AF", fontStyle: "italic", padding: "6px 0" }}>No real contacts yet — add your own email below to test live sends.</div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 90, padding: "7px 10px", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: "0.74rem" }} />
                      <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@example.com" style={{ flex: 2, minWidth: 140, padding: "7px 10px", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: "0.74rem" }} />
                      <button onClick={addRealContact} style={{ background: '#eef4ff', color: "white", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>+ Add</button>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: "0.72rem", color: "#374151", cursor: "pointer" }}>
                      <input type="checkbox" checked={dryRun} onChange={(e) => toggleDripDryRun(e.target.checked)} />
                      <span><b>Dry-run mode</b> — record sends but don&apos;t actually email. Recommended while testing. Turn off to send real emails (Resend&apos;s free tier requires a verified domain or only delivers to your own verified address).</span>
                    </label>
                  </div>
                  <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580 }}>
                      <thead>
                        <tr style={{ background: "#F9FAFB" }}>
                          {["Contact", "Step", "Status", "Sends", "Next"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: 8, fontSize: "0.65rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em" }}>{h}</th>
                          ))}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {enrollments.length ? (
                          enrollments.map((e) => {
                            const stepLabel = e.sequence?.[e.currentStep]?.label || (e.status === "completed" ? "✓ all sent" : "—");
                            const statusColor = ({ active: "#059669", paused: "#D97706", completed: "#6B7280", cancelled: "#9CA3AF", unsubscribed: "#DC2626" } as Record<string, string>)[e.status] || "#6B7280";
                            const sentN = (e.history || []).filter((h) => h.ok).length;
                            const failN = (e.history || []).filter((h) => !h.ok).length;
                            const bounceN = (e.history || []).filter((h) => h.bounced).length;
                            const lastBounce = (e.history || []).slice().reverse().find((h) => h.bounced);
                            const nextWhen = e.status === "active" && e.nextSendAt ? new Date(e.nextSendAt).toLocaleString() : "—";
                            return (
                              <tr key={e.id}>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid #F3F4F6", fontSize: "0.74rem", color: "#0A1628" }}><b>{e.name || e.email.split("@")[0]}</b><br /><span style={{ color: "#6B7280", fontSize: "0.7rem" }}>{e.email}</span></td>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid #F3F4F6", fontSize: "0.72rem", color: "#374151" }}>{e.currentStep + 1}/{e.sequence?.length || 0} · {stepLabel}</td>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid #F3F4F6", fontSize: "0.72rem" }}><span style={{ color: statusColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{e.status}</span>{e.dryRun ? <span style={{ color: "#9CA3AF", fontSize: "0.65rem" }}> · dry</span> : null}</td>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid #F3F4F6", fontSize: "0.7rem", color: "#6B7280" }}>{sentN}✓{failN ? ` ${failN}✕` : ""}{bounceN ? <span title={(lastBounce?.bounceReason || "bounced").slice(0, 140)} style={{ display: "inline-block", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "1px 6px", fontSize: "0.62rem", color: "#991B1B", fontWeight: 700, marginLeft: 4 }}>↩ {bounceN}</span> : null}</td>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid #F3F4F6", fontSize: "0.7rem", color: "#6B7280" }}>{nextWhen}</td>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid #F3F4F6", textAlign: "right" }}>
                                  {e.status === "active" && <button onClick={() => dripAction(e.id, "pause")} style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "3px 8px", fontSize: "0.65rem", color: "#92400E", cursor: "pointer" }}>Pause</button>}
                                  {e.status === "paused" && <button onClick={() => dripAction(e.id, "resume")} style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 6, padding: "3px 8px", fontSize: "0.65rem", color: "#059669", cursor: "pointer" }}>Resume</button>}
                                  {(e.status === "active" || e.status === "paused") && <button onClick={() => dripAction(e.id, "cancel")} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 8px", fontSize: "0.65rem", color: "#DC2626", cursor: "pointer", marginLeft: 4 }}>Cancel</button>}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr><td colSpan={6} style={{ padding: 14, textAlign: "center", fontSize: "0.74rem", color: "#9CA3AF", fontStyle: "italic" }}>No active enrollments yet — click &quot;🚀 Launch This Sequence&quot; above.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...cardBox, borderRadius: 16, padding: 18 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>⚡ Sequence Stats</div>
              {([
                ["Total Steps", seq.length, "#D97706"],
                ["Duration (days)", seq.length ? Math.max(...seq.map((s) => s.day)) : 0, "#7C3AED"],
                ["Target Leads", highPri, "#059669"],
                ["Est. Re-engage", "~" + Math.round(highPri * 0.44), "#0066FF"],
              ] as [string, string | number, string][]).map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F9FAFB" }}>
                  <span style={{ fontSize: "0.75rem", color: "#6B7280" }}>{l}</span>
                  <span style={{ fontSize: "0.9rem", fontWeight: 800, color: c }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", border: "1.5px solid #FDE68A", borderRadius: 16, padding: 18 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>💡 Best Practice Tip</div>
              <div style={{ fontSize: "0.75rem", color: "#92400E", lineHeight: 1.6 }}>Space your first 3 touchpoints within 10 days. After that, weekly follow-ups perform best. Mix channels — email + retargeting together is 2× more effective than email alone.</div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ COMPETITOR STEAL ════════════ */}
      {tab === "steal" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>Why Your Leads Left — and How to Win Them Back</div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>AI cross-references your competitors&apos; current offers against your lapsed lead segments to surface the most likely steal angles.</div>
          </div>
          {stealData.map((c) => (
            <div key={c.idx} style={{ background: "white", border: "1.5px solid #E5E7EB", borderRadius: 18, padding: "22px 24px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{ width: 36, height: 36, background: `linear-gradient(135deg,${c.color},${c.color}99)`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", color: "white", fontWeight: 800 }}>{c.name[0]}</div>
                    <div>
                      <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.88rem" }}>{c.name}</div>
                      <div style={{ fontSize: "0.65rem", color: c.color, fontWeight: 700 }}>Steal Angle: {c.angle} · Threat: {c.threat}</div>
                    </div>
                  </div>
                  <div style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                    <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", marginBottom: 4 }}>What they&apos;re offering</div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#0A1628" }}>{c.offer}</div>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 3 }}>{c.why}</div>
                  </div>
                </div>
                <button onClick={() => generateCounterOffer(c.idx, c.name, c.offer, c.angle)} disabled={counterLoading[c.idx]} style={{ padding: "10px 18px", background: "linear-gradient(135deg,#D97706,#B45309)", border: "none", borderRadius: 10, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, height: "fit-content", opacity: counterLoading[c.idx] ? 0.7 : 1 }}>{counterLoading[c.idx] ? "⏳ Generating…" : "🎯 Generate Counter-Offer"}</button>
              </div>
              {counterResults[c.idx] && (
                <div style={{ background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", border: "1.5px solid #FDE68A", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>🎯 Your Counter-Offer Strategy</div>
                  <div style={{ fontSize: "0.82rem", color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{counterResults[c.idx]}</div>
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #FDE68A", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: "0.75rem", color: "#92400E", fontWeight: 600 }}>Ready to put this messaging live?</div>
                    <button onClick={() => toast("🚀 Launching campaign…")} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "linear-gradient(135deg,#D97706,#B45309)", border: "none", borderRadius: 9, padding: "9px 20px", fontSize: "0.78rem", fontWeight: 800, color: "white", cursor: "pointer", boxShadow: "0 3px 12px rgba(180,83,9,.35)" }}>🚀 Launch Now</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ════════════ DM SEQUENCES ════════════ */}
      {tab === "dm" && (
        <>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "Space Grotesk,sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>💬 DM Conversion Sequences</div>
            <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>Ready-to-use DM templates mapped to funnel stages. Copy, personalise the [brackets], and start conversations that convert.</div>
          </div>
          {DM_SEQS.map((s) => {
            const allText = s.steps.map((step, i) => `Message ${i + 1}${i === 0 ? " (Day 0 — Send immediately)" : " (Day " + step.day + ")"}\n${step.msg}`).join("\n\n");
            return (
              <div key={s.id} style={{ background: "white", border: `1.5px solid ${s.color}33`, borderRadius: 18, padding: "22px 24px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={{ width: 40, height: 40, background: s.bg, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", flexShrink: 0 }}>{s.icon}</div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.88rem" }}>{s.label}</div>
                    <div style={{ fontSize: "0.65rem", fontWeight: 700, color: s.color, marginTop: 1 }}>Funnel: {s.stage} Stage</div>
                  </div>
                  <button onClick={() => copyText(allText, "✅ DM sequence copied!")} style={{ padding: "7px 14px", background: s.bg, border: `1px solid ${s.color}55`, borderRadius: 9, fontSize: "0.7rem", fontWeight: 700, color: s.color, cursor: "pointer" }}>📋 Copy All</button>
                </div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 12, padding: "10px 12px", background: "#F9FAFB", borderRadius: 9, lineHeight: 1.5 }}>{s.intro}</div>
                <div>
                  {s.steps.map((step, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", marginBottom: 4 }}>Message {i + 1}{i === 0 ? " (Day 0 — Send immediately)" : " (Day " + step.day + ")"}</div>
                      <div style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", fontSize: "0.78rem", color: "#374151", lineHeight: 1.55, position: "relative" }}>
                        {step.msg}
                        <button onClick={() => copyText(step.msg, "✅ Message copied!")} style={{ position: "absolute", top: 8, right: 8, background: "white", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 8px", fontSize: "0.6rem", color: "#6B7280", cursor: "pointer" }}>Copy</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ════════════ AI COPY MODAL ════════════ */}
      {copyTarget && (
        <div onClick={(e) => { if (e.target === e.currentTarget) closeCopyModal(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}>
            <div style={{ background: "linear-gradient(135deg,#92400E,#D97706)", borderRadius: "20px 20px 0 0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 3 }}>AI Re-engagement Copy</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "white" }}>{copyTarget.name}</div>
              </div>
              <button onClick={closeCopyModal} style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: "50%", width: 32, height: 32, fontSize: "1.1rem", color: "white", cursor: "pointer", lineHeight: "32px", textAlign: "center" }}>✕</button>
            </div>
            <div style={{ padding: "22px 24px" }}>
              {copyLoading && (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ fontSize: "1.5rem", marginBottom: 10 }}>⏳</div>
                  <div style={{ fontSize: "0.82rem", color: "#6B7280", fontWeight: 600 }}>Generating personalised re-engagement copy…</div>
                  <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4 }}>Analysing {copyTarget.name}&apos;s profile, last activity, and best channel</div>
                  <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8, background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 999, padding: "6px 14px" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#D97706" }} />
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#92400E", letterSpacing: ".04em" }}>InfoGenie working</span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#B45309", fontVariantNumeric: "tabular-nums" }}>{copyTimer.toFixed(1)}s</span>
                  </div>
                </div>
              )}
              {copyFailed && <div style={{ color: "#DC2626", fontSize: "0.8rem", textAlign: "center" }}>Failed to generate copy — please try again</div>}
              {copyData && !copyLoading && (
                <div>
                  {copyData.email && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>📧 Email</div>
                      <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "14px 16px" }}>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#92400E", marginBottom: 6 }}>Subject: {copyData.email.subject || ""}</div>
                        <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{copyData.email.body || ""}</div>
                      </div>
                      <button onClick={() => copyText(`Subject: ${copyData.email?.subject || ""}\n\n${copyData.email?.body || ""}`, "📋 Email copied!")} style={{ marginTop: 6, padding: "5px 12px", background: "white", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: "0.65rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>📋 Copy Email</button>
                    </div>
                  )}
                  {copyData.ad && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>📱 Retargeting Ad Copy</div>
                      <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: "14px 16px" }}>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1E40AF", marginBottom: 4 }}>{copyData.ad.headline || ""}</div>
                        <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.6 }}>{copyData.ad.body || ""}</div>
                        <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <button onClick={() => { markContacted(copyTarget.id, copyTarget.name); toast(`🚀 Retargeting ad launched to ${copyTarget.name} — tracking in Results`); closeCopyModal(); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg,#0066FF,#0052CC)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: "0.74rem", fontWeight: 800, cursor: "pointer", boxShadow: "0 3px 10px rgba(0,102,255,0.35)" }}>{(copyData.ad.cta || "Re-Engage Now") + " →"}</button>
                          <button onClick={() => copyText(`${copyData.ad?.headline || ""}\n\n${copyData.ad?.body || ""}\n\nCTA: ${copyData.ad?.cta || "Re-Engage Now"}`, "📋 Ad copy copied!")} style={{ padding: "8px 14px", background: "white", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: "0.7rem", fontWeight: 700, color: "#1E40AF", cursor: "pointer" }}>📋 Copy Ad</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {copyData.social && (
                    <div>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>💬 {copyTarget.channel} Message</div>
                      <div style={{ background: "#F5F3FF", border: "1.5px solid #DDD6FE", borderRadius: 12, padding: "14px 16px", fontSize: "0.78rem", color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{copyData.social}</div>
                      <button onClick={() => copyText(copyData.social || "", "📋 Message copied!")} style={{ marginTop: 6, padding: "5px 12px", background: "white", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: "0.65rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>📋 Copy Message</button>
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={closeCopyModal} style={{ flex: 1, padding: 11, background: "#F3F4F6", border: "none", borderRadius: 10, fontSize: "0.82rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>Close</button>
                <button onClick={() => { markContacted(copyTarget.id, copyTarget.name); closeCopyModal(); }} style={{ flex: 1, padding: 11, background: "linear-gradient(135deg,#D97706,#B45309)", border: "none", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700, color: "white", cursor: "pointer" }}>✓ Mark as Contacted</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
