import React, { useState, useMemo, useEffect } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, BarChart, Bar, Cell
} from 'recharts';
import {
  ChevronDown, Search, ExternalLink, ArrowUpDown, Info, Award,
  Building2, ChevronRight, Scale, Zap, Globe2, TrendingUp, Layers
} from 'lucide-react';

/* ============================= DATA (fetched live from the API) ============================= */
// Total companies in the *global* patent-strength study this ranking is drawn from.
// This isn't part of the uploaded workbook (only the US subset is), so it's a manually
// maintained figure — update it if the underlying global study universe size changes.
const TOTAL_GLOBAL = 2630;
const SPOTLIGHT_DEFAULT = 'Archer Aviation Inc';
const COMPETITORS_DEFAULT = ['Beta Air Llc', 'Boeing', 'Textron'];
const MAX_COMPETITORS = 3;
const COMPARE_COLORS = ['#0F8F82', '#6B5FB0', '#C2703D'];

/* ============================= HELPERS ============================= */
function fmtMoney(m) {
  if (m === null || m === undefined) return 'Not disclosed';
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(2)}B`;
  if (Math.abs(m) < 1) return `$${Math.round(m * 1000)}K`;
  return `$${m.toFixed(1)}M`;
}
function fmtPct(v) { if (v === null || v === undefined) return '—'; return `${v > 0 ? '+' : ''}${v.toFixed(0)}%`; }
function growth(a, b) { if (!a || b === null || b === undefined) return null; return ((b - a) / a) * 100; }
function n1(v) { return v === null || v === undefined ? '—' : v.toFixed(1); }

// Derived dimension rollups (Section 4 of the methodology) — each patent is scored
// across these 5 dimensions out of 100 total; we show the portfolio's average per-patent
// performance on each, since that's the intuitive, business-readable view of quality.
function dims(c) {
  return {
    techImpact: { value: c.forwardCitationScore + c.citationVelocity + c.classificationBreadth, max: 25 },
    legalStrength: { value: c.claimQuality + c.prosecutionHistory + c.survivalLegalStatus, max: 25 },
    marketCoverage: { value: c.familySize + c.geographicCoverage + c.remainingTerm, max: 20 },
    economicActivity: { value: c.assignmentActivity + c.litigationActivity + c.maintenanceActivity, max: 20 },
    strategicLayer: { value: c.strategicScoreCap, max: 10 },
  };
}
const DIM_META = [
  {
    key: 'techImpact', label: 'Technological Impact', icon: TrendingUp, pct: '25 pts',
    meaning: 'How much later innovation cites or builds on these patents, and how broadly they span technical categories.',
    why: 'Shows whether the invention is technically influential — useful for spotting foundational assets, not just ones that exist in the portfolio.',
  },
  {
    key: 'legalStrength', label: 'Legal Strength', icon: Scale, pct: '25 pts',
    meaning: 'How well-drafted the claims are, how the application was prosecuted, and whether the patent is still legally active.',
    why: 'Shows whether the patent is likely enforceable and defensible — critical for licensing, negotiation, and litigation-risk discussions.',
  },
  {
    key: 'marketCoverage', label: 'Market Coverage', icon: Globe2, pct: '20 pts',
    meaning: 'How broad the protection is — family size, how many countries, and how much enforceable life remains.',
    why: 'A technically strong patent has limited business value if coverage is narrow, expired, or geographically weak — useful for global strategy and monetization timing.',
  },
  {
    key: 'economicActivity', label: 'Economic Activity', icon: Zap, pct: '20 pts',
    meaning: 'Real-world signals of commercial attention — ownership transfers, litigation or challenges, and fee-payment commitment.',
    why: 'Distinguishes purely technical assets from patents the market has actually treated as commercially relevant.',
  },
  {
    key: 'strategicLayer', label: 'Strategic Layer', icon: Layers, pct: '10 pts',
    meaning: 'Competitive blocking value — whether a patent can restrict competitors\u2019 design freedom or follow-on innovation.',
    why: 'Captures competitive control that citations or legal status alone can\u2019t show — relevant for benchmarking, licensing leverage, and acquisition scouting.',
  },
];

const FINAL_WEIGHTS = [
  { key: 'patentContribution60', label: 'Patent Portfolio Score', pct: '60%', color: '#B8862E' },
  { key: 'revenueGrowthScore', weight: 0.10, label: 'Revenue Growth', pct: '10%', color: '#0F8F82' },
  { key: 'rdIntensityScore', weight: 0.10, label: 'R&D Intensity', pct: '10%', color: '#6B5FB0' },
  { key: 'rdGrowthScore', weight: 0.075, label: 'R&D Growth', pct: '7.5%', color: '#C2703D' },
  { key: 'fdaScore', weight: 0.075, label: 'FDA Clearance', pct: '7.5%', color: '#9AA5B8' },
  { key: 'maScore', weight: 0.05, label: 'M&A Activity', pct: '5%', color: '#3E5C8A' },
];

const GLOSSARY = {
  'Composite Score': 'Blends the Patent Portfolio Score (60%) with five business/commercial indicators (40%) into one comparable ranking number — not a percentage of 100.',
  'Patent Portfolio Score': 'Rolls up the five patent-quality dimensions across every patent in the portfolio into one company-level number, so no single patent or the raw patent count can dominate the result.',
  'Technological Impact': 'How much later innovation cites or builds on these patents, and how broadly they span technical categories.',
  'Legal Strength': 'How enforceable and well-prosecuted the claims are, and whether the patents remain legally active.',
  'Market Coverage': 'How broad the protection is — family size, how many countries, and how much enforceable life remains.',
  'Economic Activity': 'Real-world signals of commercial attention — ownership transfers, litigation/challenges, and fee-payment commitment.',
  'Strategic Layer': 'Competitive blocking value — whether a patent can restrict competitors\u2019 design freedom or follow-on innovation.',
  'Revenue Growth': 'Change in reported revenue, 2023 to 2025 — shows whether innovation is converting into commercial traction.',
  'R&D Intensity': 'R&D spend as a share of revenue — a high score often flags an early-stage innovator investing ahead of sales.',
  'R&D Growth': 'Change in R&D spend, 2023 to 2025 — an early signal of future innovation output, since patents typically lag investment.',
  'FDA Clearance': 'Regulatory clearances (510(k)) as a market-readiness signal — mainly relevant to regulated medical-device makers; not applicable to most companies in this study.',
  'M&A Activity': 'Credit for acquiring companies or technology assets — a sign of inorganic growth and strategic consolidation.',
};

/* ============================= SMALL COMPONENTS ============================= */
function GlossaryTip({ term }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="tip-wrap">
      <button type="button" className="tip-btn" aria-label={`What is ${term}?`}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(o => !o)}>
        <Info size={12} />
      </button>
      {open && <span className="tip-box">{GLOSSARY[term]}</span>}
    </span>
  );
}

function KpiCard({ label, value, sub, glossaryKey, accent }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}{glossaryKey && <GlossaryTip term={glossaryKey} />}</div>
      <div className="kpi-value" style={accent ? { color: 'var(--gold)' } : undefined}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function RankSeal({ rank, total }) {
  return (
    <div className="seal">
      <svg viewBox="0 0 120 120" className="seal-svg">
        <circle cx="60" cy="60" r="56" className="seal-ring-outer" />
        <circle cx="60" cy="60" r="47" className="seal-ring-inner" />
        {Array.from({ length: 28 }).map((_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return <line key={i} x1={60 + Math.cos(a) * 51} y1={60 + Math.sin(a) * 51} x2={60 + Math.cos(a) * 56} y2={60 + Math.sin(a) * 56} className="seal-tick" />;
        })}
      </svg>
      <div className="seal-content">
        <div className="seal-rank">#{rank}</div>
        <div className="seal-of">of {total}</div>
      </div>
    </div>
  );
}

function SectionHead({ n, title, icon: Icon }) {
  return (
    <div className="section-head">
      <span className="section-num">{n}</span>
      <span className="section-title">{Icon && <Icon size={15} style={{ marginRight: 6, verticalAlign: -3 }} />}{title}</span>
    </div>
  );
}

/* ============================= MAIN APP ============================= */
function Dashboard({ companies, meta }) {
  const TOTAL_US = companies.length;
  const defaultSpotlight = useMemo(() => {
    const hasDefault = companies.some((c) => c.name === SPOTLIGHT_DEFAULT);
    if (hasDefault) return SPOTLIGHT_DEFAULT;
    const sorted = [...companies].sort((a, b) => a.rankUS33 - b.rankUS33);
    return sorted[0] ? sorted[0].name : null;
  }, [companies]);
  const defaultCompetitors = useMemo(
    () => COMPETITORS_DEFAULT.filter((n) => companies.some((c) => c.name === n)),
    [companies]
  );

  const [spotlightName, setSpotlightName] = useState(defaultSpotlight);
  const [competitorNames, setCompetitorNames] = useState(defaultCompetitors);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('rankUS33');
  const [sortDir, setSortDir] = useState('asc');
  const [growthMetric, setGrowthMetric] = useState('rd');
  const [expandedRow, setExpandedRow] = useState(null);
  const [howToOpen, setHowToOpen] = useState(false);

  const byName = useMemo(() => Object.fromEntries(companies.map(c => [c.name, c])), [companies]);
  const spotlight = byName[spotlightName];
  const competitors = competitorNames.map(n => byName[n]).filter(Boolean);
  const compareSet = spotlight ? [spotlight, ...competitors] : [];

  function toggleCompetitor(name) {
    if (name === spotlightName) return;
    setCompetitorNames(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (prev.length >= MAX_COMPETITORS) return [...prev.slice(1), name];
      return [...prev, name];
    });
  }
  function setSpot(name) { setSpotlightName(name); setCompetitorNames(prev => prev.filter(n => n !== name)); setPickerOpen(false); }

  // ---- Final score bridge (6 weighted parts, matches Section 8 formula) ----
  const bridgeParts = useMemo(() => FINAL_WEIGHTS.map(w => {
    const points = w.key === 'patentContribution60' ? spotlight.patentContribution60 : spotlight[w.key] * w.weight;
    return { ...w, points: Math.max(points, 0), raw: points };
  }), [spotlight]);
  const bridgeSum = bridgeParts.reduce((s, p) => s + p.points, 0) || 1;

  // ---- Patent quality profile: 5 dimensions, spotlight + competitors, value & % of max ----
  const dimBlocks = useMemo(() => DIM_META.map(dm => ({
    ...dm,
    byCompany: compareSet.map(c => { const d = dims(c)[dm.key]; return { name: c.name, value: d.value, max: d.max, pct: (d.value / d.max) * 100 }; }),
  })), [compareSet]);

  // ---- Patent quality profile radar (Section 4 dimensions, % of max) ----
  const radarData = useMemo(() => DIM_META.map(({ key, label }) => {
    const row = { axis: label };
    compareSet.forEach(c => { const d = dims(c)[key]; row[c.name] = Math.round((d.value / d.max) * 1000) / 10; });
    return row;
  }), [compareSet]);

  // ---- Business momentum bars ----
  const bizMetrics = [
    { key: 'revenueGrowthScore', label: 'Revenue Growth', weight: '10%' },
    { key: 'rdIntensityScore', label: 'R&D Intensity', weight: '10%' },
    { key: 'rdGrowthScore', label: 'R&D Growth', weight: '7.5%' },
    { key: 'fdaScore', label: 'FDA Clearance', weight: '7.5%' },
    { key: 'maScore', label: 'M&A Activity', weight: '5%' },
  ];

  // ---- Growth trajectory ----
  const growthData = useMemo(() => {
    const years = [2023, 2024, 2025];
    return years.map((year, yi) => {
      const row = { year: String(year) };
      compareSet.forEach(c => {
        const series = growthMetric === 'rd' ? [c.rd2023, c.rd2024, c.rd2025] : [c.revenue2023, c.revenue2024, c.revenue2025];
        if (series[0] && series[yi] !== null && series[yi] !== undefined) row[c.name] = Math.round((series[yi] / series[0]) * 1000) / 10;
      });
      return row;
    });
  }, [compareSet, growthMetric]);
  const excludedFromGrowth = compareSet.filter(c => { const s = growthMetric === 'rd' ? c.rd2023 : c.revenue2023; return !s; });

  const filteredTable = useMemo(() => {
    let rows = companies.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    rows = [...rows].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const na = va === null || va === undefined ? -Infinity : va, nb = vb === null || vb === undefined ? -Infinity : vb;
      if (typeof na === 'string') return sortDir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
      return sortDir === 'asc' ? na - nb : nb - na;
    });
    return rows;
  }, [search, sortKey, sortDir]);
  function toggleSort(key) { if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc'); } }

  const revGrowth3y = growth(spotlight.revenue2023, spotlight.revenue2025);
  const rdGrowth3y = growth(spotlight.rd2023, spotlight.rd2025);
  const percentileGlobal = Math.round((1 - spotlight.rankGlobal / TOTAL_GLOBAL) * 1000) / 10;
  const spotDims = dims(spotlight);

  return (
    <div className="dash">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .dash {
          --bg: #eef1f6;
          --rule: rgba(22,35,61,0.05);
          --panel: #ffffff;
          --panel-2: #f5f7fa;
          --border: #dfe4ec;
          --ink: #16233d;
          --ink-dim: #5b6b85;
          --ink-dim2: #8996ac;
          --gold: #a8762a;
          --gold-soft: rgba(168,118,42,0.10);
          --gold-line: rgba(168,118,42,0.4);
          --teal: #0f8f82;
          --violet: #6b5fb0;
          --clay: #c2703d;
          --up: #1e9e6b;
          --down: #c44536;
          font-family: 'IBM Plex Sans', sans-serif;
          background:
            repeating-linear-gradient(var(--rule) 0 1px, transparent 1px 34px),
            var(--bg);
          color: var(--ink);
          min-height: 100vh;
          padding: 26px 18px 60px;
        }
        .dash * { box-sizing: border-box; }
        .wrap { max-width: 1180px; margin: 0 auto; }
        .serif { font-family: 'Fraunces', serif; }

        .topbar { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:22px; border-bottom: 1.5px solid var(--ink); padding-bottom:16px; }
        .brand { display:flex; gap:12px; align-items:center; }
        .brand-mark { width:36px; height:36px; border:1.5px solid var(--gold); border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--gold); flex-shrink:0; }
        .brand-title { font-family:'Fraunces', serif; font-weight:600; font-size:19px; }
        .brand-sub { font-size:11.5px; color:var(--ink-dim); letter-spacing:0.05em; text-transform:uppercase; margin-top:2px; }

        .selector { position:relative; }
        .selector-btn { background:var(--panel); border:1px solid var(--border); color:var(--ink); padding:9px 13px; border-radius:7px; display:flex; gap:9px; align-items:center; cursor:pointer; font-family:'IBM Plex Mono', monospace; font-size:12.5px; box-shadow: 0 1px 2px rgba(22,35,61,0.05); }
        .selector-btn:hover { border-color: var(--gold); }
        .selector-label { color:var(--ink-dim); font-family:'IBM Plex Sans',sans-serif; font-size:10.5px; text-transform:uppercase; letter-spacing:0.05em; }
        .dropdown { position:absolute; top:calc(100% + 6px); right:0; background:var(--panel); border:1px solid var(--border); border-radius:9px; width:300px; max-height:340px; overflow-y:auto; z-index:20; box-shadow: 0 14px 34px rgba(22,35,61,0.14); }
        .dropdown-item { padding:9px 14px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; gap:8px; border-bottom:1px solid var(--panel-2); }
        .dropdown-item:hover { background: var(--panel-2); }
        .dropdown-item.active { color:var(--gold); font-weight:600; }
        .dd-rank { color:var(--ink-dim2); font-family:'IBM Plex Mono',monospace; font-size:11px; }

        .hero { display:grid; grid-template-columns:150px 1fr; gap:24px; margin-bottom:22px; align-items:center; }
        @media (max-width:700px){ .hero{ grid-template-columns:1fr; text-align:center;} }
        .seal { position:relative; width:128px; height:128px; margin:0 auto; display:flex; align-items:center; justify-content:center; }
        .seal-svg { position:absolute; inset:0; width:100%; height:100%; }
        .seal-ring-outer { fill:none; stroke:var(--gold); stroke-width:1.5; }
        .seal-ring-inner { fill:none; stroke:var(--gold); stroke-width:1; stroke-dasharray:2 4; opacity:0.6; }
        .seal-tick { stroke:var(--gold); stroke-width:1; opacity:0.55; }
        .seal-content { text-align:center; }
        .seal-rank { font-family:'Fraunces',serif; font-size:32px; font-weight:700; color:var(--gold); line-height:1; }
        .seal-of { font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:var(--ink-dim); margin-top:2px; }

        .hero-info h1 { font-family:'Fraunces',serif; font-size:25px; margin:0 0 6px; }
        .domain-tag { display:inline-block; font-size:11px; color:var(--teal); border:1px solid rgba(15,143,130,0.35); background:rgba(15,143,130,0.08); padding:2px 9px; border-radius:20px; margin-bottom:9px; }
        .hero-info p { color:var(--ink-dim); font-size:13.5px; line-height:1.65; margin:0 0 10px; max-width:640px; }
        .hero-links { display:flex; gap:16px; font-size:12.5px; flex-wrap:wrap; }
        .hero-links a { color:var(--teal); text-decoration:none; display:inline-flex; align-items:center; gap:4px; }
        .hero-links a:hover { text-decoration:underline; }

        .howto { margin-bottom:16px; }
        .howto-toggle { display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--teal); font-size:12.5px; font-weight:500; }
        .howto-body { margin-top:12px; display:grid; grid-template-columns: repeat(2,1fr); gap:10px 22px; font-size:12px; color:var(--ink-dim); line-height:1.6; }
        @media (max-width:700px){ .howto-body{ grid-template-columns:1fr; } }
        .howto-body b { color:var(--ink); }

        .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
        @media (max-width:800px){ .kpi-row{ grid-template-columns:repeat(2,1fr);} }
        .kpi-card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; box-shadow:0 1px 3px rgba(22,35,61,0.04); }
        .kpi-label { font-size:10.5px; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-dim); display:flex; align-items:center; gap:5px; margin-bottom:6px; }
        .kpi-value { font-family:'Fraunces',serif; font-size:21px; font-weight:600; }
        .kpi-sub { font-size:11.5px; color:var(--ink-dim2); margin-top:3px; font-family:'IBM Plex Mono',monospace; }

        .tip-wrap { position:relative; display:inline-flex; }
        .tip-btn { background:none; border:none; color:var(--ink-dim2); cursor:pointer; padding:0; display:flex; }
        .tip-btn:hover { color:var(--teal); }
        .tip-box { position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); width:230px; background:var(--ink); color:#fff; font-size:11.5px; line-height:1.5; padding:9px 11px; border-radius:8px; z-index:30; font-family:'IBM Plex Sans',sans-serif; text-transform:none; letter-spacing:normal; box-shadow:0 10px 24px rgba(22,35,61,0.25); }

        .section { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px 22px; margin-bottom:16px; box-shadow:0 1px 3px rgba(22,35,61,0.04); }
        .section-head { display:flex; align-items:baseline; gap:12px; margin-bottom:14px; }
        .section-num { font-family:'Fraunces',serif; font-size:13px; color:var(--gold); border:1px solid var(--gold-line); border-radius:20px; padding:1px 9px; }
        .section-title { font-family:'Fraunces',serif; font-size:16px; font-weight:600; }
        .section-desc { font-size:12px; color:var(--ink-dim); margin: -6px 0 16px; max-width:760px; line-height:1.6; }

        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media (max-width:880px){ .grid2{ grid-template-columns:1fr; } }

        .chip-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
        .chip { font-size:11px; border:1px solid var(--border); background:var(--panel-2); padding:4px 9px; border-radius:20px; cursor:pointer; display:flex; align-items:center; gap:5px; color:var(--ink-dim); }
        .chip.on { border-color: var(--teal); color: var(--teal); background: rgba(15,143,130,0.08); }
        .chip .swatch { width:7px; height:7px; border-radius:50%; }
        .legend-row { display:flex; gap:14px; flex-wrap:wrap; margin-top:10px; font-size:11.5px; color:var(--ink-dim); }
        .legend-row span { display:flex; align-items:center; gap:5px; }
        .legend-row .dot { width:8px; height:8px; border-radius:50%; }

        /* Final score bridge */
        .bridge-bar { display:flex; height:38px; border-radius:8px; overflow:hidden; border:1px solid var(--border); }
        .bridge-seg { display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:600; color:#fff; }
        .bridge-key { display:grid; grid-template-columns:repeat(3,1fr); gap:8px 16px; margin-top:14px; }
        @media (max-width:700px){ .bridge-key{ grid-template-columns:repeat(2,1fr);} }
        .bridge-key-item { font-size:11.5px; color:var(--ink-dim); display:flex; justify-content:space-between; gap:6px; border-bottom:1px dotted var(--border); padding-bottom:4px; }
        .bridge-key-item b { color:var(--ink); font-family:'IBM Plex Mono',monospace; }
        .bridge-total { display:flex; justify-content:space-between; align-items:baseline; margin-top:16px; padding-top:14px; border-top:1px dashed var(--border); }
        .bridge-total .num { font-family:'Fraunces',serif; font-size:26px; color:var(--gold); font-weight:700; }

        /* Portfolio blocks */
        .pblock { display:flex; align-items:center; gap:12px; padding:7px 0; border-bottom:1px solid var(--panel-2); }
        .pblock:last-child { border-bottom:none; }
        .pblock-label { width:170px; flex-shrink:0; font-size:12.5px; font-weight:500; }
        .pblock-label .pct { color:var(--ink-dim2); font-family:'IBM Plex Mono',monospace; font-weight:400; font-size:10.5px; display:block; }
        .pblock-bar-track { flex:1; height:9px; background:var(--panel-2); border-radius:5px; overflow:hidden; }
        .pblock-bar-fill { height:100%; background:linear-gradient(90deg, var(--gold), #cf9a45); border-radius:5px; }
        .pblock-val { width:56px; text-align:right; font-family:'IBM Plex Mono',monospace; font-size:12px; flex-shrink:0; }

        /* Section 02 callouts */
        .callout-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        @media (max-width:700px){ .callout-row{ grid-template-columns:repeat(2,1fr);} }
        .callout-card { background:var(--panel-2); border:1px solid var(--border); border-radius:10px; padding:14px; text-align:center; }
        .callout-num { font-family:'Fraunces',serif; font-size:24px; font-weight:600; color:var(--gold); }
        .callout-label { font-size:11px; color:var(--ink-dim); margin-top:4px; }

        /* Section 03 building-block cards */
        .pblock-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px; }
        @media (max-width:880px){ .pblock-detail-grid{ grid-template-columns:1fr; } }
        .pblock-card { background:var(--panel-2); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
        .pblock-card-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
        .pblock-card-title { font-family:'Fraunces',serif; font-size:14px; font-weight:600; }
        .pblock-card-pct { font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--gold); display:flex; align-items:center; gap:6px; }
        .adj-tag { font-family:'IBM Plex Sans',sans-serif; font-size:9.5px; text-transform:uppercase; letter-spacing:0.03em; background:rgba(107,95,176,0.12); color:var(--violet); padding:1px 6px; border-radius:8px; }
        .pblock-card-meaning { font-size:12px; color:var(--ink); margin-bottom:4px; }
        .pblock-card-why { font-size:11.5px; color:var(--ink-dim); line-height:1.5; margin-bottom:10px; }

        /* Section 04 confidence-adjustment cards */
        .conf-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:10px; }
        .conf-card { background:var(--panel-2); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
        .conf-card-head { font-family:'Fraunces',serif; font-size:13.5px; font-weight:600; margin-bottom:8px; }
        .conf-stat { display:flex; justify-content:space-between; font-size:11.5px; color:var(--ink-dim); padding:3px 0; }
        .conf-stat b { color:var(--ink); font-family:'IBM Plex Mono',monospace; }
        .conf-compare { margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); }
        .conf-compare-row { display:flex; justify-content:space-between; font-size:11px; color:var(--ink-dim); padding:2px 0; }
        .conf-compare-row b { color:var(--gold); font-family:'IBM Plex Mono',monospace; }

        /* Business bars */
        .biz-row { display:flex; align-items:center; gap:12px; padding:8px 0; }
        .biz-label { width:130px; flex-shrink:0; font-size:12px; }
        .biz-label .pct { color:var(--ink-dim2); font-size:10px; font-family:'IBM Plex Mono',monospace; }
        .biz-track { flex:1; height:16px; background:var(--panel-2); border-radius:4px; position:relative; overflow:hidden; }
        .biz-fill { height:100%; border-radius:4px; }
        .biz-val { width:42px; text-align:right; font-family:'IBM Plex Mono',monospace; font-size:11.5px; flex-shrink:0; }

        .toggle-row { display:flex; gap:6px; }
        .toggle-btn { font-size:11px; padding:5px 11px; border-radius:6px; border:1px solid var(--border); background:var(--panel-2); color:var(--ink-dim); cursor:pointer; }
        .toggle-btn.on { background: var(--gold-soft); border-color: var(--gold); color: var(--gold); }
        .excluded-note { font-size:11px; color:var(--ink-dim2); margin-top:8px; font-style:italic; }

        .ma-list { display:flex; flex-direction:column; gap:10px; }
        .ma-item { border-left:2px solid var(--teal); padding-left:10px; }
        .ma-item .ma-co { font-size:12.5px; font-weight:600; margin-bottom:2px; }
        .ma-item .ma-txt { font-size:12px; color:var(--ink-dim); white-space:pre-line; line-height:1.5; }
        .ma-empty { color:var(--ink-dim2); font-size:12.5px; font-style:italic; }
        .domain-chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:4px; }
        .domain-chip { font-size:10.5px; background:var(--panel-2); border:1px solid var(--border); padding:2px 8px; border-radius:12px; color:var(--ink-dim); }

        .search-box { display:flex; align-items:center; gap:7px; background:var(--panel-2); border:1px solid var(--border); border-radius:7px; padding:6px 10px; }
        .search-box input { background:none; border:none; outline:none; color:var(--ink); font-size:12.5px; width:170px; }
        .search-box input::placeholder { color:var(--ink-dim2); }

        .table-wrap { overflow-x:auto; }
        table { width:100%; border-collapse:collapse; font-size:12.5px; }
        th { text-align:left; padding:9px 10px; color:var(--ink-dim); font-weight:600; text-transform:uppercase; font-size:10px; letter-spacing:0.04em; border-bottom:1.5px solid var(--ink); cursor:pointer; white-space:nowrap; }
        th:hover { color:var(--teal); }
        th .sort-ic { opacity:0.5; vertical-align:-2px; margin-left:3px; }
        td { padding:8px 10px; border-bottom:1px solid var(--panel-2); font-family:'IBM Plex Mono',monospace; white-space:nowrap; }
        td.co-name { font-family:'IBM Plex Sans',sans-serif; }
        tr.spotlight-row td { background: var(--gold-soft); color: var(--gold); font-weight:600; }
        tr.spotlight-row td.co-name { font-weight:700; }
        tr.competitor-row td { background: rgba(15,143,130,0.06); }
        tr.expand-row td { background: var(--panel-2); font-family:'IBM Plex Sans',sans-serif; white-space:normal; }
        .row-actions { display:flex; gap:6px; }
        .mini-btn { font-size:10.5px; padding:3px 8px; border-radius:5px; border:1px solid var(--border); background:var(--panel-2); color:var(--ink-dim); cursor:pointer; font-family:'IBM Plex Sans',sans-serif; }
        .mini-btn:hover { border-color:var(--teal); color:var(--teal); }
        .mini-btn.active { border-color:var(--gold); color:var(--gold); }
        .detail-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; padding:14px 4px; }
        @media (max-width:900px){ .detail-grid{ grid-template-columns:repeat(2,1fr);} }
        .detail-col h5 { font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-dim); margin:0 0 8px; }
        .detail-row { display:flex; justify-content:space-between; font-size:11.5px; padding:3px 0; border-bottom:1px dotted var(--border); }
        .detail-row b { font-family:'IBM Plex Mono',monospace; font-weight:500; }

        .limits-list { font-size:12px; color:var(--ink-dim); line-height:1.8; margin:0; padding-left:18px; }
        .foot-note { text-align:center; color:var(--ink-dim2); font-size:11px; margin-top:26px; line-height:1.8; }
      `}</style>

      <div className="wrap">
        {/* TOP BAR */}
        <div className="topbar">
          <div className="brand">
            <div className="brand-mark"><Award size={17} /></div>
            <div>
              <div className="brand-title">Citadel Award — EV Battery IP Valuation</div>
              <div className="brand-sub">Full methodology view · 2026 cycle</div>
            </div>
          </div>
          <div className="selector">
            <button className="selector-btn" onClick={() => setPickerOpen(o => !o)}>
              <span className="selector-label">Spotlight</span>{spotlight.name} <ChevronDown size={14} />
            </button>
            {pickerOpen && (
              <div className="dropdown">
                {[...companies].sort((a, b) => a.rankUS33 - b.rankUS33).map(c => (
                  <div key={c.name} className={`dropdown-item ${c.name === spotlightName ? 'active' : ''}`} onClick={() => setSpot(c.name)}>
                    <span>{c.name}</span><span className="dd-rank">#{c.rankUS33}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* HERO */}
        <div className="hero">
          <RankSeal rank={spotlight.rankUS33} total={TOTAL_US} />
          <div className="hero-info">
            <h1>{spotlight.name}</h1>
            {spotlight.techDomain && <div className="domain-tag">{spotlight.techDomain.split('\n')[0]}</div>}
            <p>
              Ranked <b style={{ color: 'var(--ink)' }}>#{spotlight.rankGlobal}</b> of {TOTAL_GLOBAL.toLocaleString()} companies worldwide in EV battery patent strength — top {percentileGlobal < 1 ? '<1' : percentileGlobal}% globally — and #{spotlight.rankUS33} among the {TOTAL_US} US innovators reviewed in full detail for this award, using GreyB's five-layer patent valuation methodology.
            </p>
            <div className="hero-links">
              {spotlight.website && <a href={spotlight.website} target="_blank" rel="noreferrer">Company site <ExternalLink size={11} /></a>}
              {spotlight.parentCompany && <span style={{ color: 'var(--ink-dim2)' }}><Building2 size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />Subsidiary of {spotlight.parentCompany}</span>}
            </div>
          </div>
        </div>

        {/* HOW TO READ */}
        <div className="howto section">
          <div className="howto-toggle" onClick={() => setHowToOpen(o => !o)}>
            <Info size={14} />How this ranking is built (from GreyB's Patent Valuation methodology)
            <ChevronDown size={14} style={{ transform: howToOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </div>
          {howToOpen && (
            <div className="howto-body">
              <div><b>Every patent</b> is first scored 0–100 across five dimensions: Technological Impact (25pts), Legal Strength (25pts), Market Coverage (20pts), Economic Activity (20pts), and Strategic Layer (10pts).</div>
              <div><b>Patent scores roll up</b> into a company-level Patent Portfolio Score using five signals — total strength, average quality, peak quality, portfolio scale, and high-value concentration — so one lucky patent, or a huge pile of weak ones, can't dominate.</div>
              <div><b>Business signals add context</b>: revenue growth, R&D intensity, R&D growth, FDA clearances, and M&A activity show whether patent strength is backed by real commercial momentum.</div>
              <div><b>The Final Score</b> = 60% Patent Portfolio + 10% Revenue Growth + 10% R&D Intensity + 7.5% R&D Growth + 7.5% FDA Clearance + 5% M&A — patents dominate, business signals validate.</div>
            </div>
          )}
        </div>

        {/* KPI ROW */}
        <div className="kpi-row">
          <KpiCard label="Composite Score" glossaryKey="Composite Score" value={spotlight.finalScore.toFixed(1)} sub={`#${spotlight.rankUS33} of ${TOTAL_US} in this study`} accent />
          <KpiCard label="Patent Portfolio Score" glossaryKey="Patent Portfolio Score" value={spotlight.patentPortfolioScore.toFixed(1)} sub={`${spotlight.patentCount} patents · avg quality ${n1(spotlight.avgPatentScore)}/100`} />
          <KpiCard label="R&D Spend (2025)" value={fmtMoney(spotlight.rd2025)} sub={rdGrowth3y !== null ? `${fmtPct(rdGrowth3y)} vs. earliest year on record` : 'Trend not available'} />
          <KpiCard label="Revenue (2025)" value={fmtMoney(spotlight.revenue2025)} sub={revGrowth3y !== null ? `${fmtPct(revGrowth3y)} vs. earliest year on record` : (spotlight.revenue2025 !== null && spotlight.revenue2025 < 10 ? 'Pre-revenue stage' : 'Trend not available')} />
        </div>

        {/* 01 FINAL SCORE BRIDGE */}
        <div className="section">
          <SectionHead n="01" title="How the Final Score Is Built" icon={Award} />
          <div className="section-desc">Per the methodology's Section 8 formula: 60% Patent Portfolio Score plus five weighted business/commercial indicators. Bars below show {spotlight.name}'s actual point contribution from each.</div>
          <div className="bridge-bar">
            {bridgeParts.map(p => (
              <div key={p.label} className="bridge-seg" style={{ width: `${(p.points / bridgeSum) * 100}%`, background: p.color }} title={`${p.label}: ${p.points.toFixed(2)} pts`}>
                {(p.points / bridgeSum) * 100 > 7 ? p.points.toFixed(1) : ''}
              </div>
            ))}
          </div>
          <div className="bridge-key">
            {bridgeParts.map(p => (
              <div key={p.label} className="bridge-key-item">
                <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: p.color, marginRight: 6 }} />{p.label} ({p.pct})</span>
                <b>{p.raw.toFixed(2)} pts</b>
              </div>
            ))}
          </div>
          {spotlight.otherContribution40 < 0 && <div className="excluded-note">Note: business-momentum sub-scores summed to a negative contribution here, driven by a steep decline in one underlying metric — shown as zero above to keep the bar readable.</div>}
          <div className="bridge-total"><span style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>Final Company Ranking Score</span><span className="num">{spotlight.finalScore.toFixed(1)}</span></div>
        </div>

        {/* 02 WHAT THE PATENT PORTFOLIO SCORE MEASURES */}
        <div className="section">
          <SectionHead n="02" title="What the Patent Portfolio Score Measures" icon={Layers} />
          <div className="section-desc" style={{ marginBottom: 4 }}>
            Per Section 6 of the methodology: this score converts patent-level quality into one company-level number. Every patent is first scored across <b style={{ color: 'var(--ink)' }}>five quality dimensions</b> —
            so a company can't rank well on patent volume alone, or on a single unusually strong filing.
          </div>
          <div className="callout-row">
            <div className="callout-card">
              <div className="callout-num">{spotlight.patentCount}</div>
              <div className="callout-label">Patents in portfolio</div>
            </div>
            <div className="callout-card">
              <div className="callout-num">{n1(spotlight.avgPatentScore)}<span style={{ fontSize: 13, color: 'var(--ink-dim2)' }}>/100</span></div>
              <div className="callout-label">Average single-patent quality</div>
            </div>
            <div className="callout-card">
              <div className="callout-num">{n1(spotlight.maxPatentScore)}<span style={{ fontSize: 13, color: 'var(--ink-dim2)' }}>/100</span></div>
              <div className="callout-label">Strongest single patent</div>
            </div>
            <div className="callout-card">
              <div className="callout-num">{(spotlight.highValuePatentRatio * 100).toFixed(0)}%</div>
              <div className="callout-label">Patents in the top quartile</div>
            </div>
          </div>
        </div>

        {/* 03 FIVE QUALITY DIMENSIONS */}
        <div className="section">
          <SectionHead n="03" title="The Five Quality Dimensions" icon={Layers} />
          <div className="section-desc">Section 4 of the methodology: every patent is scored 0–100 across these five dimensions. Bars show {spotlight.name}'s average per-patent score in each, against the selected competitors.</div>
          <div className="pblock-detail-grid">
            {dimBlocks.map(b => (
              <div className="pblock-card" key={b.label}>
                <div className="pblock-card-head">
                  <span className="pblock-card-title">{b.label}</span>
                  <span className="pblock-card-pct">{b.pct}</span>
                </div>
                <div className="pblock-card-meaning">{b.meaning}</div>
                <div className="pblock-card-why"><b>Why it matters:</b> {b.why}</div>
                {b.byCompany.map((x, i) => (
                  <div className="pblock" key={x.name}>
                    <div className="pblock-label" style={{ width: 128, fontSize: 11.5, color: i === 0 ? 'var(--gold)' : COMPARE_COLORS[i - 1], fontWeight: 600 }}>{x.name.split(' ')[0]}</div>
                    <div className="pblock-bar-track"><div className="pblock-bar-fill" style={{ width: `${x.pct}%`, background: i === 0 ? 'linear-gradient(90deg, var(--gold), #cf9a45)' : COMPARE_COLORS[i - 1] }} /></div>
                    <div className="pblock-val">{x.value.toFixed(1)}/{x.max}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="chip-row" style={{ marginTop: 4 }}>
            {[...companies].sort((a, b) => a.rankUS33 - b.rankUS33).filter(c => c.name !== spotlightName).map(c => {
              const idx = competitorNames.indexOf(c.name), on = idx !== -1;
              return (
                <button key={c.name} className={`chip ${on ? 'on' : ''}`} onClick={() => toggleCompetitor(c.name)}>
                  {on && <span className="swatch" style={{ background: COMPARE_COLORS[idx] }} />}{c.name} <span style={{ opacity: 0.6 }}>#{c.rankUS33}</span>
                </button>
              );
            })}
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="rgba(22,35,61,0.12)" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: '#5b6b85', fontSize: 10.5 }} />
              <Radar name={spotlight.name} dataKey={spotlight.name} stroke="#a8762a" fill="#a8762a" fillOpacity={0.25} strokeWidth={2} />
              {competitors.map((c, i) => <Radar key={c.name} name={c.name} dataKey={c.name} stroke={COMPARE_COLORS[i]} fill={COMPARE_COLORS[i]} fillOpacity={0.08} strokeWidth={1.5} />)}
              <RTooltip contentStyle={{ background: '#16233d', border: 'none', borderRadius: 8, fontSize: 12, color: '#fff' }} formatter={(v) => `${v}% of max`} />
            </RadarChart>
          </ResponsiveContainer>
          <div className="legend-row">
            <span><span className="dot" style={{ background: 'var(--gold)' }} />{spotlight.name}</span>
            {competitors.map((c, i) => <span key={c.name}><span className="dot" style={{ background: COMPARE_COLORS[i] }} />{c.name}</span>)}
          </div>
        </div>

        {/* 04 BUSINESS MOMENTUM */}
        <div className="section">
          <SectionHead n="04" title="Business & Commercial Momentum" icon={Zap} />
          <div className="section-desc">Section 7: does patent strength show up in real business execution? Each bar is the raw 0–100 score before its final weight is applied.</div>
          <div className="grid2">
            {compareSet.map((c, ci) => (
              <div key={c.name} style={{ paddingBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, color: ci === 0 ? 'var(--gold)' : COMPARE_COLORS[ci - 1] }}>{c.name}</div>
                {bizMetrics.map(m => (
                  <div className="biz-row" key={m.key}>
                    <div className="biz-label">{m.label}<span className="pct"> · {m.weight}</span></div>
                    <div className="biz-track"><div className="biz-fill" style={{ width: `${c[m.key]}%`, background: ci === 0 ? 'var(--gold)' : COMPARE_COLORS[ci - 1] }} /></div>
                    <div className="biz-val">{c[m.key].toFixed(0)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 05 GROWTH TRAJECTORY + M&A */}
        <div className="grid2">
          <div className="section">
            <SectionHead n="05" title="Investment Trajectory" icon={TrendingUp} />
            <div className="section-desc" style={{ marginBottom: 6 }}>2023–2025, indexed to first available year = 100, so companies of very different sizes compare on trend, not scale.</div>
            <div className="toggle-row" style={{ marginBottom: 12 }}>
              <button className={`toggle-btn ${growthMetric === 'rd' ? 'on' : ''}`} onClick={() => setGrowthMetric('rd')}>R&amp;D Spend</button>
              <button className={`toggle-btn ${growthMetric === 'revenue' ? 'on' : ''}`} onClick={() => setGrowthMetric('revenue')}>Revenue</button>
            </div>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={growthData} margin={{ left: -14, right: 8 }}>
                <CartesianGrid stroke="rgba(22,35,61,0.08)" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: '#5b6b85', fontSize: 11.5 }} axisLine={{ stroke: 'rgba(22,35,61,0.15)' }} tickLine={false} />
                <YAxis tick={{ fill: '#5b6b85', fontSize: 11 }} axisLine={false} tickLine={false} width={38} />
                <RTooltip contentStyle={{ background: '#16233d', border: 'none', borderRadius: 8, fontSize: 12, color: '#fff' }} formatter={(v) => `${v} idx`} />
                <Line type="monotone" dataKey={spotlight.name} stroke="#a8762a" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                {competitors.map((c, i) => <Line key={c.name} type="monotone" dataKey={c.name} stroke={COMPARE_COLORS[i]} strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
            <div className="legend-row">
              <span><span className="dot" style={{ background: 'var(--gold)' }} />{spotlight.name}</span>
              {competitors.map((c, i) => <span key={c.name}><span className="dot" style={{ background: COMPARE_COLORS[i] }} />{c.name}</span>)}
            </div>
            {excludedFromGrowth.length > 0 && <div className="excluded-note">Not enough public {growthMetric === 'rd' ? 'R&D' : 'revenue'} history to index: {excludedFromGrowth.map(c => c.name).join(', ')}.</div>}
          </div>

          <div className="section">
            <SectionHead n="06" title="M&A &amp; Technology Focus" icon={Building2} />
            <div className="section-desc" style={{ marginBottom: 10 }}>Acquisitions and disclosed technology areas for the selected companies.</div>
            <div className="ma-list">
              {compareSet.every(c => !c.maActivity && !c.techDomain) && <div className="ma-empty">No M&A or technology-domain disclosures on record for the selected companies.</div>}
              {compareSet.map(c => (c.maActivity || c.techDomain) && (
                <div className="ma-item" key={c.name} style={{ borderColor: c.name === spotlight.name ? 'var(--gold)' : 'var(--teal)' }}>
                  <div className="ma-co" style={{ color: c.name === spotlight.name ? 'var(--gold)' : 'var(--teal)' }}>{c.name}</div>
                  {c.maActivity && <div className="ma-txt">{c.maActivity}</div>}
                  {c.techDomain && <div className="domain-chips">{c.techDomain.split('\n').map((t, i) => <span className="domain-chip" key={i}>{t}</span>)}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 07 LEADERBOARD */}
        <div className="section">
          <SectionHead n="07" title="Full Leaderboard — All 33 Companies" icon={Search} />
          <div className="section-desc" style={{ marginBottom: 8 }}>Click a row to expand the complete score breakdown for that company.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <div className="search-box"><Search size={13} color="#8996ac" /><input placeholder="Search company..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th onClick={() => toggleSort('rankUS33')}>US Rank <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th onClick={() => toggleSort('name')}>Company <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th onClick={() => toggleSort('rankGlobal')}>Global Rank <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th onClick={() => toggleSort('finalScore')}>Score <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th onClick={() => toggleSort('patentCount')}>Patents <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th onClick={() => toggleSort('revenue2025')}>Revenue '25 <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th onClick={() => toggleSort('rd2025')}>R&amp;D '25 <ArrowUpDown size={10} className="sort-ic" /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredTable.map(c => {
                  const isSpotlight = c.name === spotlightName, isCompetitor = competitorNames.includes(c.name), isExpanded = expandedRow === c.name;
                  const d = dims(c);
                  return (
                    <React.Fragment key={c.name}>
                      <tr className={isSpotlight ? 'spotlight-row' : isCompetitor ? 'competitor-row' : ''} style={{ cursor: 'pointer' }} onClick={() => setExpandedRow(isExpanded ? null : c.name)}>
                        <td><ChevronRight size={13} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /></td>
                        <td>#{c.rankUS33}</td>
                        <td className="co-name">{c.name}</td>
                        <td>#{c.rankGlobal}</td>
                        <td>{c.finalScore.toFixed(1)}</td>
                        <td>{c.patentCount}</td>
                        <td>{fmtMoney(c.revenue2025)}</td>
                        <td>{fmtMoney(c.rd2025)}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="row-actions">
                            {!isSpotlight && <button className="mini-btn" onClick={() => setSpot(c.name)}>Spotlight</button>}
                            {!isSpotlight && <button className={`mini-btn ${isCompetitor ? 'active' : ''}`} onClick={() => toggleCompetitor(c.name)}>{isCompetitor ? 'Remove' : 'Compare'}</button>}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="expand-row"><td colSpan={9}>
                          <div className="detail-grid">
                            <div className="detail-col">
                              <h5>Final Score</h5>
                              <div className="detail-row"><span>Patent Portfolio (60%)</span><b>{c.patentContribution60.toFixed(2)}</b></div>
                              <div className="detail-row"><span>Revenue Growth (10%)</span><b>{(c.revenueGrowthScore * 0.10).toFixed(2)}</b></div>
                              <div className="detail-row"><span>R&amp;D Intensity (10%)</span><b>{(c.rdIntensityScore * 0.10).toFixed(2)}</b></div>
                              <div className="detail-row"><span>R&amp;D Growth (7.5%)</span><b>{(c.rdGrowthScore * 0.075).toFixed(2)}</b></div>
                              <div className="detail-row"><span>FDA Clearance (7.5%)</span><b>{(c.fdaScore * 0.075).toFixed(2)}</b></div>
                              <div className="detail-row"><span>M&amp;A Activity (5%)</span><b>{(c.maScore * 0.05).toFixed(2)}</b></div>
                            </div>
                            <div className="detail-col">
                              <h5>Portfolio Build</h5>
                              <div className="detail-row"><span>Sum Patent Score</span><b>{c.weightedSumPatentScore.toFixed(2)}</b></div>
                              <div className="detail-row"><span>Avg Patent Score</span><b>{c.weightedAvgPatentScore.toFixed(2)}</b></div>
                              <div className="detail-row"><span>Max Patent Score</span><b>{c.weightedMaxPatentScore.toFixed(2)}</b></div>
                              <div className="detail-row"><span>Patent Count Score</span><b>{c.weightedPatentCountScore.toFixed(2)}</b></div>
                              <div className="detail-row"><span>High-Value Ratio</span><b>{c.weightedHighValueRatio.toFixed(2)}</b></div>
                            </div>
                            <div className="detail-col">
                              <h5>Quality Profile</h5>
                              {DIM_META.map(dm => <div className="detail-row" key={dm.key}><span>{dm.label}</span><b>{d[dm.key].value.toFixed(1)}/{d[dm.key].max}</b></div>)}
                            </div>
                            <div className="detail-col">
                              <h5>Raw Patent Stats</h5>
                              <div className="detail-row"><span>Avg Patent Score</span><b>{n1(c.avgPatentScore)}/100</b></div>
                              <div className="detail-row"><span>Max Patent Score</span><b>{n1(c.maxPatentScore)}/100</b></div>
                              <div className="detail-row"><span>High-Value Ratio</span><b>{(c.highValuePatentRatio * 100).toFixed(0)}%</b></div>
                              <div className="detail-row"><span>Total Patents</span><b>{c.patentCount}</b></div>
                            </div>
                            <div className="detail-col">
                              <h5>Business Figures</h5>
                              <div className="detail-row"><span>Revenue '23 → '25</span><b>{fmtMoney(c.revenue2023)} → {fmtMoney(c.revenue2025)}</b></div>
                              <div className="detail-row"><span>R&amp;D '23 → '25</span><b>{fmtMoney(c.rd2023)} → {fmtMoney(c.rd2025)}</b></div>
                              <div className="detail-row"><span>M&amp;A on record</span><b>{c.maActivity ? c.maActivity.split('\n').length : 0}</b></div>
                              <div className="detail-row"><span>Parent company</span><b>{c.parentCompany || '—'}</b></div>
                            </div>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* GLOSSARY */}
        <div className="section">
          <SectionHead n="08" title="Glossary & Limitations" icon={Info} />
          <div className="howto-body" style={{ marginTop: 0, marginBottom: 16 }}>
            {Object.entries(GLOSSARY).map(([term, def]) => (
              <div key={term}><b>{term}</b> — {def}</div>
            ))}
          </div>
          <ul className="limits-list">
            <li>This ranking is a decision-support tool, not a final legal, financial, or investment conclusion.</li>
            <li>Revenue, R&D, FDA, and M&A figures should be source-checked and refreshed before external presentation.</li>
            <li>Normalization is dataset-dependent — scores may shift if the comparison set of companies changes.</li>
            <li>FDA clearance is a count-based regulatory metric relevant mainly to medical-device makers; it is 0 for every company in this EV/aviation study.</li>
            <li>Qualitative expert review is recommended for shortlisted companies, especially where litigation or claim scope is material.</li>
          </ul>
        </div>

        <div className="foot-note">
          Source: GreyB Patent Valuation and Company Ranking Framework, EV Battery patent landscape (2026 cycle) · Business figures from public filings and company disclosures, 2023–2025.<br />
          Scores are relative rankings within the {TOTAL_US} companies studied, not absolute or percentage-of-maximum measures.
          {meta && meta.uploaded_at && (
            <><br />Data last updated {new Date(meta.uploaded_at).toLocaleString()} ({meta.filename}).</>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Maps a Postgres row (snake_case) to the shape the Dashboard expects (camelCase) ----
function mapRow(r) {
  return {
    name: r.name,
    rankUS33: r.rank_us33,
    rankGlobal: r.rank_global,
    finalScore: Number(r.final_score),
    patentPortfolioScore: Number(r.patent_portfolio_score),
    patentContribution60: Number(r.patent_contribution_60),
    patentCount: r.patent_count,
    sumPatentScore: numOrNull(r.sum_patent_score),
    avgPatentScore: numOrNull(r.avg_patent_score),
    maxPatentScore: numOrNull(r.max_patent_score),
    highValuePatentRatio: numOrNull(r.high_value_patent_ratio),
    weightedSumPatentScore: numOrNull(r.weighted_sum_patent_score),
    weightedAvgPatentScore: numOrNull(r.weighted_avg_patent_score),
    weightedMaxPatentScore: numOrNull(r.weighted_max_patent_score),
    weightedPatentCountScore: numOrNull(r.weighted_patent_count_score),
    weightedHighValueRatio: numOrNull(r.weighted_high_value_ratio),
    forwardCitationScore: numOrNull(r.forward_citation_score),
    citationVelocity: numOrNull(r.citation_velocity),
    classificationBreadth: numOrNull(r.classification_breadth),
    claimQuality: numOrNull(r.claim_quality),
    prosecutionHistory: numOrNull(r.prosecution_history),
    survivalLegalStatus: numOrNull(r.survival_legal_status),
    familySize: numOrNull(r.family_size),
    geographicCoverage: numOrNull(r.geographic_coverage),
    remainingTerm: numOrNull(r.remaining_term),
    assignmentActivity: numOrNull(r.assignment_activity),
    litigationActivity: numOrNull(r.litigation_activity),
    maintenanceActivity: numOrNull(r.maintenance_activity),
    strategicScoreCap: numOrNull(r.strategic_score_cap),
    revenueGrowthScore: numOrNull(r.revenue_growth_score),
    rdGrowthScore: numOrNull(r.rd_growth_score),
    rdIntensityScore: numOrNull(r.rd_intensity_score),
    fdaScore: numOrNull(r.fda_score),
    maScore: numOrNull(r.ma_score),
    otherContribution40: numOrNull(r.other_contribution_40),
    revenue2023: numOrNull(r.revenue_2023),
    revenue2024: numOrNull(r.revenue_2024),
    revenue2025: numOrNull(r.revenue_2025),
    rd2023: numOrNull(r.rd_2023),
    rd2024: numOrNull(r.rd_2024),
    rd2025: numOrNull(r.rd_2025),
    fda2023: r.fda_2023,
    fda2024: r.fda_2024,
    fda2025: r.fda_2025,
    maActivity: r.ma_activity,
    techDomain: r.tech_domain,
    comments: r.comments,
    website: r.website,
    parentCompany: r.parent_company,
  };
}
function numOrNull(v) { return v === null || v === undefined ? null : Number(v); }

// ---- Top-level App: fetches live data, then renders the Dashboard ----
export default function App() {
  const [state, setState] = useState({ status: 'loading', companies: [], meta: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/companies')
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', companies: (data.companies || []).map(mapRow), meta: data.meta, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', companies: [], meta: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') {
    return <CenterMessage title="Loading dashboard…" subtitle="Fetching the latest data." />;
  }
  if (state.status === 'error') {
    return <CenterMessage title="Couldn't load the dashboard" subtitle={state.error} isError />;
  }
  if (state.companies.length === 0) {
    return (
      <CenterMessage
        title="No data yet"
        subtitle={<>An admin needs to upload the ranking workbook first — go to <code>/admin</code> to upload it.</>}
      />
    );
  }
  return <Dashboard companies={state.companies} meta={state.meta} />;
}

function CenterMessage({ title, subtitle, isError }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'IBM Plex Sans, sans-serif', background: '#eef1f6', color: isError ? '#c44536' : '#16233d', padding: 20, textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: '#5b6b85', maxWidth: 420 }}>{subtitle}</div>
    </div>
  );
}
