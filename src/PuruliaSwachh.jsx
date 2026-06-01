import React, { useState, useMemo, useEffect, useRef } from "react";

/* ============================================================
   PURULIA SWACHH — anonymous civic garbage reporting
   Architecture mirrors NammaKasa: React + MapLibre + Supabase/PostGIS.
   Functional demo (in-memory). Flip USE_SUPABASE to go live.
   Anonymous: no auth. Upvotes. Ward leaderboard. Image compression.
   Ward tagging: manual dropdown now; PostGIS trigger ready.
   ============================================================ */

const USE_SUPABASE = false; // flip true after wiring (see submit/upvote/useEffect)
// const SUPABASE_URL = "https://xxxx.supabase.co";
// const SUPABASE_ANON_KEY = "...";
// import { createClient } from "@supabase/supabase-js";
// const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PURULIA_CENTER = [86.3653, 23.3322]; // [lng, lat] MapLibre order
const WARDS = Array.from({ length: 23 }, (_, i) => i + 1); // verify actual count

const CATEGORIES = [
  { id: "garbage", label: "Garbage pile", color: "#c2410c", icon: "🗑️" },
  { id: "dump", label: "Illegal dump", color: "#7c2d12", icon: "🚯" },
  { id: "drain", label: "Blocked drain", color: "#0e7490", icon: "💧" },
  { id: "dead_animal", label: "Dead animal", color: "#9d174d", icon: "⚠️" },
  { id: "burning", label: "Open burning", color: "#a16207", icon: "🔥" },
];
const STATUS = {
  open: { label: "Open", color: "#dc2626" },
  in_progress: { label: "In progress", color: "#d97706" },
  resolved: { label: "Resolved", color: "#16a34a" },
};

const SEED = [
  { id: "r1", lat: 23.3361, lng: 86.3621, category: "garbage", ward: 4, status: "open", note: "Pile near vegetable market growing daily", photo: null, upvotes: 12, created: Date.now() - 36e5 * 30, channel: "whatsapp" },
  { id: "r2", lat: 23.3289, lng: 86.3702, category: "drain", ward: 11, status: "in_progress", note: "Drain overflowing after rain", photo: null, upvotes: 5, created: Date.now() - 36e5 * 80, channel: "app" },
  { id: "r3", lat: 23.3401, lng: 86.3588, category: "dump", ward: 2, status: "resolved", note: "Construction debris on roadside", photo: null, upvotes: 8, created: Date.now() - 36e5 * 200, channel: "whatsapp" },
  { id: "r4", lat: 23.3255, lng: 86.3640, category: "dead_animal", ward: 4, status: "open", note: "", photo: null, upvotes: 3, created: Date.now() - 36e5 * 12, channel: "app" },
  { id: "r5", lat: 23.3318, lng: 86.3680, category: "garbage", ward: 4, status: "open", note: "Overflowing bin not cleared in a week", photo: null, upvotes: 9, created: Date.now() - 36e5 * 50, channel: "app" },
];

const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

function compressImage(file, maxDim = 1024, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = (height * maxDim) / width; width = maxDim; }
      else if (height > maxDim) { width = (width * maxDim) / height; height = maxDim; }
      const c = document.createElement("canvas");
      c.width = width; c.height = height;
      c.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    reader.readAsDataURL(file);
  });
}

function useMapLibre() {
  const [ready, setReady] = useState(!!window.maplibregl);
  useEffect(() => {
    if (window.maplibregl) { setReady(true); return; }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
    js.onload = () => setReady(true);
    document.body.appendChild(js);
  }, []);
  return ready;
}

function MapView({ reports, picking, pin, onPick, onSelect }) {
  const ready = useMapLibre();
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const pinMarker = useRef(null);

  useEffect(() => {
    if (!ready || map.current || !el.current) return;
    const ml = window.maplibregl;
    map.current = new ml.Map({
      container: el.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: PURULIA_CENTER,
      zoom: 13.5,
    });
    map.current.addControl(new ml.NavigationControl(), "top-right");
  }, [ready]);

  useEffect(() => {
    if (!map.current) return;
    const handler = (e) => picking && onPick([e.lngLat.lat, e.lngLat.lng]);
    map.current.on("click", handler);
    if (el.current) el.current.style.cursor = picking ? "crosshair" : "";
    return () => map.current && map.current.off("click", handler);
  }, [picking, onPick, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const ml = window.maplibregl;
    reports.forEach((r) => {
      const cat = CATEGORIES.find((c) => c.id === r.category);
      const stat = STATUS[r.status];
      const div = document.createElement("div");
      div.style.cssText = "background:" + cat.color + ";width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid " + stat.color + ";box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;cursor:pointer";
      div.innerHTML = '<span style="transform:rotate(45deg);font-size:12px">' + cat.icon + "</span>";
      div.onclick = (e) => { e.stopPropagation(); onSelect(r); };
      markers.current.push(new ml.Marker({ element: div, anchor: "bottom" }).setLngLat([r.lng, r.lat]).addTo(map.current));
    });
  }, [reports, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (pinMarker.current) { pinMarker.current.remove(); pinMarker.current = null; }
    if (pin) {
      const ml = window.maplibregl;
      const div = document.createElement("div");
      div.style.cssText = "font-size:30px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))";
      div.textContent = "📍";
      pinMarker.current = new ml.Marker({ element: div, anchor: "bottom" }).setLngLat([pin[1], pin[0]]).addTo(map.current);
    }
  }, [pin, ready]);

  return <div ref={el} style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }} />;
}

export default function PuruliaSwachh() {
  const [reports, setReports] = useState(SEED);
  const [tab, setTab] = useState("map");
  const [fWardFilter, setFWardFilter] = useState("all");
  const [fCatFilter, setFCatFilter] = useState("all");
  const [fStatusFilter, setFStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [voted, setVoted] = useState({});

  const [picking, setPicking] = useState(false);
  const [pin, setPin] = useState(null);
  const [fCat, setFCat] = useState("garbage");
  const [fWard, setFWard] = useState(1);
  const [fNote, setFNote] = useState("");
  const [fPhoto, setFPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    // (async () => {
    //   const { data } = await sb.from("reports").select("*").order("created_at",{ascending:false});
    //   setReports(data.map(mapRow));
    //   sb.channel("reports").on("postgres_changes",{event:"*",schema:"public",table:"reports"},()=>refetch()).subscribe();
    // })();
  }, []);

  const filtered = useMemo(() =>
    reports.filter((r) =>
      (fWardFilter === "all" || r.ward === +fWardFilter) &&
      (fCatFilter === "all" || r.category === fCatFilter) &&
      (fStatusFilter === "all" || r.status === fStatusFilter)
    ), [reports, fWardFilter, fCatFilter, fStatusFilter]);

  const stats = useMemo(() => ({
    total: reports.length,
    open: reports.filter((r) => r.status === "open").length,
    prog: reports.filter((r) => r.status === "in_progress").length,
    done: reports.filter((r) => r.status === "resolved").length,
  }), [reports]);

  const leaderboard = useMemo(() => {
    const m = {};
    reports.forEach((r) => {
      const w = (m[r.ward] = m[r.ward] || { ward: r.ward, unresolved: 0, total: 0, upvotes: 0 });
      w.total++; w.upvotes += r.upvotes;
      if (r.status !== "resolved") w.unresolved++;
    });
    return Object.values(m).sort((a, b) => b.unresolved - a.unresolved || b.upvotes - a.upvotes);
  }, [reports]);

  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setFPhoto(await compressImage(file));
    setBusy(false);
  };

  const submit = async () => {
    if (!pin) { alert("Tap the map to drop a pin first."); return; }
    const row = { id: "r" + Date.now(), lat: pin[0], lng: pin[1], category: fCat, ward: fWard, status: "open", note: fNote, photo: fPhoto, upvotes: 0, created: Date.now(), channel: "app" };
    if (USE_SUPABASE) {
      // 1. upload compressed blob to Supabase Storage -> public url
      // 2. insert; ward_no auto-tagged by PostGIS trigger from location
      // await sb.from("reports").insert({ location:`POINT(${pin[1]} ${pin[0]})`, category:fCat, note:fNote, photo_url:url });
    }
    setReports((p) => [row, ...p]);
    setPin(null); setPicking(false); setFNote(""); setFPhoto(null); setTab("map");
  };

  const upvote = (id) => {
    if (voted[id]) return;
    setVoted((v) => ({ ...v, [id]: true }));
    setReports((p) => p.map((r) => (r.id === id ? { ...r, upvotes: r.upvotes + 1 } : r)));
    setSelected((s) => (s && s.id === id ? { ...s, upvotes: s.upvotes + 1 } : s));
    // if (USE_SUPABASE) sb.rpc("increment_upvote", { report_id: id });
  };

  const cycleStatus = (id) =>
    setReports((p) => p.map((r) => r.id === id
      ? { ...r, status: r.status === "open" ? "in_progress" : r.status === "in_progress" ? "resolved" : "open" }
      : r));

  const C = { bg: "#15110d", panel: "#221a13", line: "#39291d", text: "#f1e7d8", sub: "#a89178", accent: "#e07a3f", green: "#16a34a" };

  return (
    <div style={{ fontFamily: "system-ui,sans-serif", background: C.bg, color: C.text, minHeight: "100vh" }}>
      <style>{"*{box-sizing:border-box}button{cursor:pointer;font-family:inherit}select,textarea,input{font-family:inherit}"}</style>

      <header style={{ padding: "14px 18px", borderBottom: "1px solid " + C.line, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 26 }}>🧹</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 19 }}>পুরুলিয়া স্বচ্ছ <span style={{ color: C.sub, fontWeight: 400, fontSize: 13 }}>· Purulia Swachh</span></h1>
          <div style={{ fontSize: 11, color: C.sub }}>Anonymous garbage & sanitation reporting</div>
        </div>
      </header>

      <div style={{ display: "flex", gap: 1, background: C.line }}>
        {[["Reports", stats.total, C.text], ["Open", stats.open, STATUS.open.color], ["Working", stats.prog, STATUS.in_progress.color], ["Resolved", stats.done, STATUS.resolved.color]].map(([l, v, col]) => (
          <div key={l} style={{ flex: 1, background: C.panel, padding: "9px 10px" }}>
            <div style={{ fontSize: 21, fontWeight: 700, color: col }}>{v}</div>
            <div style={{ fontSize: 10, color: C.sub }}>{l}</div>
          </div>
        ))}
      </div>

      <nav style={{ display: "flex", borderBottom: "1px solid " + C.line }}>
        {[["map", "🗺️ Map"], ["report", "➕ Report"], ["list", "📋 Feed"], ["leaderboard", "🏆 Wards"]].map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "11px 0", background: tab === id ? C.panel : "transparent", color: tab === id ? C.accent : C.sub, border: "none", borderBottom: tab === id ? "2px solid " + C.accent : "2px solid transparent", fontSize: 12.5, fontWeight: 600 }}>{l}</button>
        ))}
      </nav>

      <main style={{ padding: 14 }}>
        {tab === "map" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Sel v={fStatusFilter} set={setFStatusFilter} opts={[["all", "All status"], ...Object.entries(STATUS).map(([k, s]) => [k, s.label])]} C={C} />
              <Sel v={fCatFilter} set={setFCatFilter} opts={[["all", "All types"], ...CATEGORIES.map((c) => [c.id, c.label])]} C={C} />
              <Sel v={fWardFilter} set={setFWardFilter} opts={[["all", "All wards"], ...WARDS.map((w) => [w, "Ward " + w])]} C={C} />
            </div>
            <div style={{ height: 440 }}>
              <MapView reports={filtered} picking={false} pin={null} onPick={() => {}} onSelect={setSelected} />
            </div>
            {selected && <DetailCard r={selected} C={C} voted={voted} onClose={() => setSelected(null)} onCycle={cycleStatus} onUpvote={upvote} />}
          </>
        )}

        {tab === "report" && (
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Report an issue <span style={{ color: C.sub, fontWeight: 400, fontSize: 12 }}>· anonymous</span></h2>
            <div style={{ height: 260, marginBottom: 8 }}>
              <MapView reports={[]} picking={picking} pin={pin} onPick={setPin} onSelect={() => {}} />
            </div>
            <button onClick={() => setPicking((v) => !v)} style={{ width: "100%", padding: 10, marginBottom: 12, background: picking ? C.accent : C.panel, color: picking ? "#fff" : C.text, border: "1px solid " + C.line, borderRadius: 8, fontSize: 13 }}>
              {picking ? "Tap map to drop pin…" : pin ? "📍 Pin set — tap to change" : "📍 Set location"}
            </button>

            <Label C={C}>Type</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setFCat(c.id)} style={{ padding: "7px 11px", borderRadius: 20, border: "1px solid " + (fCat === c.id ? c.color : C.line), background: fCat === c.id ? c.color : "transparent", color: fCat === c.id ? "#fff" : C.text, fontSize: 12 }}>{c.icon} {c.label}</button>
              ))}
            </div>

            <Label C={C}>Ward <span style={{ fontWeight: 400 }}>(auto-tagged by GPS once boundary polygons loaded)</span></Label>
            <Sel v={fWard} set={(v) => setFWard(+v)} opts={WARDS.map((w) => [w, "Ward " + w])} C={C} full />

            <Label C={C}>Photo</Label>
            <input type="file" accept="image/*" onChange={onPhoto} style={{ marginBottom: 8, color: C.sub, fontSize: 12 }} />
            {busy && <div style={{ fontSize: 12, color: C.sub }}>Compressing…</div>}
            {fPhoto && <img src={fPhoto} alt="" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}

            <Label C={C}>Note (optional)</Label>
            <textarea value={fNote} onChange={(e) => setFNote(e.target.value)} rows={3} placeholder="Describe the problem…" style={{ width: "100%", background: C.panel, color: C.text, border: "1px solid " + C.line, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12, resize: "vertical" }} />

            <button onClick={submit} style={{ width: "100%", padding: 14, background: C.green, color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700 }}>Submit anonymously</button>
          </div>
        )}

        {tab === "list" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Sel v={fStatusFilter} set={setFStatusFilter} opts={[["all", "All status"], ...Object.entries(STATUS).map(([k, s]) => [k, s.label])]} C={C} />
              <Sel v={fWardFilter} set={setFWardFilter} opts={[["all", "All wards"], ...WARDS.map((w) => [w, "Ward " + w])]} C={C} />
            </div>
            {[...filtered].sort((a, b) => b.upvotes - a.upvotes).map((r) => {
              const cat = CATEGORIES.find((c) => c.id === r.category);
              return (
                <div key={r.id} style={{ background: C.panel, border: "1px solid " + C.line, borderRadius: 10, padding: 12, marginBottom: 8, display: "flex", gap: 12 }}>
                  <div style={{ fontSize: 20 }}>{cat.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{cat.label}</strong>
                      <button onClick={() => cycleStatus(r.id)} style={{ background: STATUS[r.status].color, color: "#fff", border: "none", borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>{STATUS[r.status].label}</button>
                    </div>
                    <div style={{ fontSize: 12, color: C.sub, margin: "2px 0" }}>Ward {r.ward} · {timeAgo(r.created)} · via {r.channel}</div>
                    {r.note && <div style={{ fontSize: 13 }}>{r.note}</div>}
                    <button onClick={() => upvote(r.id)} disabled={voted[r.id]} style={{ marginTop: 6, background: voted[r.id] ? C.line : "transparent", color: voted[r.id] ? C.sub : C.accent, border: "1px solid " + C.line, borderRadius: 14, padding: "3px 12px", fontSize: 12 }}>▲ {r.upvotes}{voted[r.id] ? " voted" : ""}</button>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ color: C.sub, textAlign: "center", padding: 40 }}>No reports match filters.</div>}
          </>
        )}

        {tab === "leaderboard" && (
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Ward accountability board</h2>
            <p style={{ fontSize: 12, color: C.sub, marginTop: -4 }}>Ranked by unresolved issues. Public pressure on civic bodies.</p>
            {leaderboard.map((w, i) => (
              <div key={w.ward} style={{ display: "flex", alignItems: "center", gap: 12, background: C.panel, border: "1px solid " + C.line, borderRadius: 10, padding: "10px 14px", marginBottom: 6 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: i === 0 ? "#dc2626" : C.sub, width: 24 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <strong>Ward {w.ward}</strong>
                  <div style={{ fontSize: 12, color: C.sub }}>{w.total} reports · {w.upvotes} upvotes</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: w.unresolved ? STATUS.open.color : C.green }}>{w.unresolved}</div>
                  <div style={{ fontSize: 10, color: C.sub }}>unresolved</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer style={{ padding: "12px 18px", borderTop: "1px solid " + C.line, fontSize: 11, color: C.sub }}>
        {USE_SUPABASE ? "Live · Supabase" : "Demo · in-memory. Set USE_SUPABASE=true to persist."}
      </footer>
    </div>
  );
}

function Sel({ v, set, opts, C, full }) {
  return (
    <select value={v} onChange={(e) => set(e.target.value)} style={{ background: C.panel, color: C.text, border: "1px solid " + C.line, borderRadius: 8, padding: "8px 10px", fontSize: 13, width: full ? "100%" : "auto", marginBottom: full ? 12 : 0 }}>
      {opts.map(([val, lab]) => <option key={val} value={val} style={{ background: C.panel }}>{lab}</option>)}
    </select>
  );
}
function Label({ children, C }) {
  return <div style={{ fontSize: 12, color: C.sub, marginBottom: 5, fontWeight: 600 }}>{children}</div>;
}
function DetailCard({ r, C, voted, onClose, onCycle, onUpvote }) {
  const cat = CATEGORIES.find((c) => c.id === r.category);
  return (
    <div style={{ marginTop: 12, background: C.panel, border: "1px solid " + C.line, borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{cat.icon} {cat.label}</strong>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.sub, fontSize: 18 }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: C.sub, margin: "4px 0" }}>Ward {r.ward} · {timeAgo(r.created)} · via {r.channel}</div>
      {r.photo && <img src={r.photo} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, margin: "8px 0" }} />}
      {r.note && <div style={{ fontSize: 13, marginBottom: 8 }}>{r.note}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onUpvote(r.id)} disabled={voted[r.id]} style={{ background: voted[r.id] ? C.line : "transparent", color: voted[r.id] ? C.sub : C.accent, border: "1px solid " + C.line, borderRadius: 14, padding: "4px 14px", fontSize: 12 }}>▲ {r.upvotes}{voted[r.id] ? " voted" : ""}</button>
        <button onClick={() => onCycle(r.id)} style={{ background: STATUS[r.status].color, color: "#fff", border: "none", borderRadius: 14, padding: "4px 14px", fontSize: 12, fontWeight: 600 }}>{STATUS[r.status].label} — advance</button>
      </div>
    </div>
  );
}
