"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface BusinessProfile {
  business_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  hours: Record<string, string>;
}

interface ListingStatus {
  platform: string;
  status: 'synced' | 'mismatch' | 'not_found' | 'error' | 'unknown';
  detected_data: any;
  discrepancies: Record<string, { expected: string; detected: string }> | null;
  last_checked: string;
}

export default function LocalListings() {
  const [profile, setProfile] = useState<BusinessProfile>({
    business_name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    website: "",
    hours: {}
  });
  const [statuses, setStatuses] = useState<ListingStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [pRes, sRes] = await Promise.all([
      apiGet<{ ok: boolean; profile: BusinessProfile }>("/api/local-listings/profile"),
      apiGet<{ ok: boolean; statuses: ListingStatus[] }>("/api/local-listings/status")
    ]);
    if (pRes.ok && pRes.profile) setProfile(pRes.profile);
    if (sRes.ok) setStatuses(sRes.statuses);
    setLoading(false);
  }

  async function saveProfile() {
    setSaving(true);
    const res = await apiPost("/api/local-listings/profile", profile);
    setSaving(false);
    if (res.ok) {
      alert("NAP Profile saved!");
    } else {
      alert("Error saving profile: " + (res as any).error);
    }
  }

  async function startScan() {
    setScanning(true);
    const res = await apiPost<{ ok: boolean; results: any }>("/api/local-listings/scan", {});
    setScanning(false);
    if (res.ok) {
      loadData();
    } else {
      alert("Scan failed: " + (res as any).error);
    }
  }

  async function resolveDiscrepancy(platform: string) {
    const res = await apiPost(`/api/local-listings/status/${platform}/resolve`, {});
    if (res.ok) {
      loadData();
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'synced': return '#10b981';
      case 'mismatch': return '#f59e0b';
      case 'not_found': return '#ef4444';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading Local Listings...</div>;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 8 }}>📍 Local Listings & NAP Consistency</h2>
        <p style={{ color: "#6b7280" }}>Manage your canonical Business Profile and sync it across major platforms.</p>
      </div>

      <div className="ig-card" style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Canonical Business Profile (NAP)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="form-group">
            <label>Business Name</label>
            <input className="form-control" value={profile.business_name} onChange={e => setProfile({...profile, business_name: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Website</label>
            <input className="form-control" value={profile.website} onChange={e => setProfile({...profile, website: e.target.value})} />
          </div>
          <div className="form-group" style={{ gridColumn: "span 2" }}>
            <label>Address</label>
            <input className="form-control" value={profile.address} onChange={e => setProfile({...profile, address: e.target.value})} />
          </div>
          <div className="form-group">
            <label>City</label>
            <input className="form-control" value={profile.city} onChange={e => setProfile({...profile, city: e.target.value})} />
          </div>
          <div className="form-group">
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>State</label>
                <input className="form-control" value={profile.state} onChange={e => setProfile({...profile, state: e.target.value})} />
              </div>
              <div style={{ flex: 1 }}>
                <label>ZIP</label>
                <input className="form-control" value={profile.zip} onChange={e => setProfile({...profile, zip: e.target.value})} />
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input className="form-control" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveProfile} disabled={saving}>
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Listing Status</h3>
        <button className="btn btn-primary" onClick={startScan} disabled={scanning || !profile.business_name}>
          {scanning ? "Scanning Platforms..." : "Scan All Platforms"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {['google', 'facebook', 'apple_maps', 'bing', 'yelp'].map(platform => {
          const s = statuses.find(x => x.platform === platform);
          const status = s?.status || 'unknown';
          const color = getStatusColor(status);
          
          return (
            <div key={platform} className="ig-card" style={{ borderTop: `4px solid ${color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{platform.replace('_', ' ')}</div>
                <div style={{ 
                  fontSize: ".7rem", 
                  fontWeight: 700, 
                  color: "#fff", 
                  background: color, 
                  padding: "2px 8px", 
                  borderRadius: 4,
                  textTransform: "uppercase"
                }}>
                  {status}
                </div>
              </div>

              {s?.last_checked && (
                <div style={{ fontSize: ".75rem", color: "#6b7280", marginBottom: 12 }}>
                  Last checked: {new Date(s.last_checked).toLocaleString()}
                </div>
              )}

              {s?.discrepancies && Object.keys(s.discrepancies).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: ".75rem", fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>DISCREPANCIES FOUND:</div>
                  {Object.entries(s.discrepancies).map(([field, diff]) => (
                    <div key={field} style={{ fontSize: ".75rem", marginBottom: 4, padding: 6, background: "#fffbeb", borderRadius: 4 }}>
                      <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{field.replace('_', ' ')}:</div>
                      <div style={{ color: "#ef4444" }}>Got: {diff.detected || "(empty)"}</div>
                      <div style={{ color: "#10b981" }}>Expected: {diff.expected}</div>
                    </div>
                  ))}
                  <button 
                    className="btn btn-sm btn-outline" 
                    style={{ marginTop: 8, width: "100%" }}
                    onClick={() => resolveDiscrepancy(platform)}
                  >
                    Mark Resolved
                  </button>
                </div>
              )}

              {status === 'not_found' && (
                <div style={{ fontSize: ".8rem", color: "#ef4444", background: "#fef2f2", padding: 8, borderRadius: 4 }}>
                  Business listing not found on this platform.
                </div>
              )}

              {status === 'unknown' && (
                <div style={{ fontSize: ".8rem", color: "#6b7280", fontStyle: "italic" }}>
                  Not yet scanned.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
