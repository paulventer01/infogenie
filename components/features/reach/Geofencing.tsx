"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import PanelHero from "@/components/layout/PanelHero";

interface Geofence {
  id: number;
  tenant_id: number;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  channel: string;
  message_template: string;
  active: boolean;
  created_at: string;
}

interface GeofenceEvent {
  id: number;
  tenant_id: number;
  geofence_id: number;
  geofence_name?: string;
  contact_email: string;
  contact_phone: string;
  lat: number;
  lng: number;
  distance_meters: number;
  triggered_at: string;
  delivery_status: string;
}

interface FencesResponse {
  ok: boolean;
  fences: Geofence[];
}

interface EventsResponse {
  ok: boolean;
  events: GeofenceEvent[];
}

interface CheckInResponse {
  ok: boolean;
  triggered_count: number;
  triggered: Array<{
    fence_id: number;
    fence_name: string;
    distance: number;
    delivery_status: string;
    message: string;
  }>;
}

export default function Geofencing() {
  const [fences, setFences] = useState<Geofence[]>([]);
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"fences" | "events" | "simulate">("fences");

  // Form state
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState(200);
  const [channel, setChannel] = useState("email");
  const [template, setTemplate] = useState("Hi! You just entered {{name}}. Check out our latest deals!");
  const [saving, setSaving] = useState(false);

  // Simulation state
  const [simLat, setSimLat] = useState("");
  const [simLng, setSimLng] = useState("");
  const [simEmail, setSimEmail] = useState("");
  const [simPhone, setSimPhone] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<CheckInResponse | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [fRes, eRes] = await Promise.all([
      apiGet<FencesResponse>("/api/geofencing/fences"),
      apiGet<EventsResponse>("/api/geofencing/events"),
    ]);
    if (fRes.ok) setFences(fRes.fences);
    if (eRes.ok) setEvents(eRes.events);
    setLoading(false);
  }

  async function saveFence() {
    if (!name || !lat || !lng) return alert("Please fill in name and coordinates");
    setSaving(true);
    const res = await apiPost<{ ok: boolean }>("/api/geofencing/fences", {
      name,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radius_meters: radius,
      channel,
      message_template: template,
    });
    setSaving(false);
    if (res.ok) {
      setName("");
      setLat("");
      setLng("");
      setRadius(200);
      loadData();
    }
  }

  async function toggleFence(fence: Geofence) {
    const res = await apiPut<{ ok: boolean }>(`/api/geofencing/fences/${fence.id}`, {
      active: !fence.active,
    });
    if (res.ok) loadData();
  }

  async function deleteFence(id: number) {
    if (!confirm("Delete this geofence?")) return;
    const res = await apiDelete<{ ok: boolean }>(`/api/geofencing/fences/${id}`);
    if (res.ok) loadData();
  }

  async function simulateCheckIn() {
    if (!simLat || !simLng) return alert("Enter simulation coordinates");
    setSimulating(true);
    setSimResult(null);
    const res = await apiPost<CheckInResponse>("/api/geofencing/check-in", {
      lat: parseFloat(simLat),
      lng: parseFloat(simLng),
      contact_email: simEmail,
      contact_phone: simPhone,
    });
    setSimulating(false);
    if (res.ok) {
      setSimResult(res);
      loadData(); // Refresh events
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 4px 40px" }}>
      <PanelHero
        group="Reach"
        title="📍 Geofencing"
        subtitle="Location-triggered messages and proximity alerts"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`btn ${activeTab === "fences" ? "btn-primary" : "btn-outline"}`} onClick={() => setActiveTab("fences")}>Fences</button>
            <button className={`btn ${activeTab === "events" ? "btn-primary" : "btn-outline"}`} onClick={() => setActiveTab("events")}>Event Log</button>
            <button className={`btn ${activeTab === "simulate" ? "btn-primary" : "btn-outline"}`} onClick={() => setActiveTab("simulate")}>Simulate</button>
          </div>
        }
      />

      {activeTab === "fences" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 350px", gap: 24 }}>
          <div>
            <div className="ig-card">
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Active Geofences</h2>
              {loading ? (
                <p>Loading...</p>
              ) : fences.length === 0 ? (
                <p style={{ color: "#6b7280", textAlign: "center", padding: "40px 0" }}>No geofences created yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {fences.map(f => (
                    <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, border: "1px solid #e5e7eb", borderRadius: 12, opacity: f.active ? 1 : 0.6 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{f.name}</div>
                        <div style={{ fontSize: ".85rem", color: "#6b7280" }}>
                          {f.lat.toFixed(6)}, {f.lng.toFixed(6)} • {f.radius_meters}m radius
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontSize: ".7rem", padding: "2px 6px", background: "#f3f4f6", borderRadius: 4, textTransform: "uppercase", fontWeight: 700 }}>{f.channel}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-sm btn-outline" onClick={() => toggleFence(f)}>{f.active ? "Pause" : "Activate"}</button>
                        <button className="btn btn-sm btn-outline" style={{ color: "#ef4444" }} onClick={() => deleteFence(f.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="ig-card">
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Create New Fence</h2>
              <div className="form-group">
                <label>Fence Name</label>
                <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Street Store" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label>Latitude</label>
                  <input className="form-control" value={lat} onChange={e => setLat(e.target.value)} placeholder="51.5074" />
                </div>
                <div className="form-group">
                  <label>Longitude</label>
                  <input className="form-control" value={lng} onChange={e => setLng(e.target.value)} placeholder="-0.1278" />
                </div>
              </div>
              <div className="form-group">
                <label>Radius (meters): {radius}m</label>
                <input type="range" min="50" max="2000" step="50" style={{ width: "100%" }} value={radius} onChange={e => setRadius(parseInt(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Channel</label>
                <select className="form-control" value={channel} onChange={e => setChannel(e.target.value)}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Message Template</label>
                <textarea className="form-control" rows={3} value={template} onChange={e => setTemplate(e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={saving} onClick={saveFence}>
                {saving ? "Saving..." : "Create Geofence"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "events" && (
        <div className="ig-card">
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Triggered Events Log</h2>
          {loading ? (
            <p>Loading...</p>
          ) : events.length === 0 ? (
            <p style={{ color: "#6b7280", textAlign: "center", padding: "40px 0" }}>No events triggered yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                    <th style={{ padding: 12, fontSize: ".85rem", color: "#6b7280" }}>Time</th>
                    <th style={{ padding: 12, fontSize: ".85rem", color: "#6b7280" }}>Fence</th>
                    <th style={{ padding: 12, fontSize: ".85rem", color: "#6b7280" }}>Contact</th>
                    <th style={{ padding: 12, fontSize: ".85rem", color: "#6b7280" }}>Distance</th>
                    <th style={{ padding: 12, fontSize: ".85rem", color: "#6b7280" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: 12, fontSize: ".9rem" }}>{new Date(e.triggered_at).toLocaleString()}</td>
                      <td style={{ padding: 12, fontSize: ".9rem", fontWeight: 600 }}>{e.geofence_name || `ID: ${e.geofence_id}`}</td>
                      <td style={{ padding: 12, fontSize: ".9rem" }}>{e.contact_email || e.contact_phone || "Anonymous"}</td>
                      <td style={{ padding: 12, fontSize: ".9rem" }}>{Math.round(e.distance_meters)}m</td>
                      <td style={{ padding: 12, fontSize: ".9rem" }}>
                        <span style={{ 
                          fontSize: ".7rem", 
                          padding: "2px 6px", 
                          background: e.delivery_status === 'sent' ? "#dcfce7" : "#f3f4f6",
                          color: e.delivery_status === 'sent' ? "#166534" : "#374151",
                          borderRadius: 4, 
                          textTransform: "uppercase", 
                          fontWeight: 700 
                        }}>
                          {e.delivery_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "simulate" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div className="ig-card">
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Simulate Check-in</h2>
            <p style={{ fontSize: ".85rem", color: "#6b7280", marginBottom: 16 }}>
              Manually trigger a location update to see which geofences are within range.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label>Current Latitude</label>
                <input className="form-control" value={simLat} onChange={e => setSimLat(e.target.value)} placeholder="51.5074" />
              </div>
              <div className="form-group">
                <label>Current Longitude</label>
                <input className="form-control" value={simLng} onChange={e => setSimLng(e.target.value)} placeholder="-0.1278" />
              </div>
            </div>
            <div className="form-group">
              <label>Contact Email (optional)</label>
              <input className="form-control" value={simEmail} onChange={e => setSimEmail(e.target.value)} placeholder="test@example.com" />
            </div>
            <div className="form-group">
              <label>Contact Phone (optional)</label>
              <input className="form-control" value={simPhone} onChange={e => setSimPhone(e.target.value)} placeholder="+123456789" />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={simulating} onClick={simulateCheckIn}>
              {simulating ? "Checking..." : "🚀 Simulate Check-in"}
            </button>
          </div>

          <div>
            {simResult && (
              <div className="ig-card" style={{ borderLeft: "4px solid #8b5cf6" }}>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Simulation Result</h2>
                {simResult.triggered_count === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: "2rem", marginBottom: 8 }}>🏜️</div>
                    <p>No geofences triggered at this location.</p>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontWeight: 600, color: "#10b981", marginBottom: 12 }}>
                      ✅ {simResult.triggered_count} fence(s) triggered!
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {simResult.triggered.map((t, idx) => (
                        <div key={idx} style={{ padding: 12, background: "#f9fafb", borderRadius: 8 }}>
                          <div style={{ fontWeight: 600 }}>{t.fence_name}</div>
                          <div style={{ fontSize: ".8rem", color: "#6b7280" }}>
                            Distance: {Math.round(t.distance)}m • Status: {t.delivery_status}
                          </div>
                          <div style={{ marginTop: 6, fontStyle: "italic", fontSize: ".85rem" }}>
                            &quot;{t.message}&quot;
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
