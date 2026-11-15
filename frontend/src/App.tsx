import React from "react";
import { HashRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import clsx from "clsx";
import { Menu, Satellite, SlidersHorizontal } from "lucide-react";
import { StoreProvider, useStore } from "./lib/store";
import { DataBanner, FilterBar, Sidebar } from "./components/Layout";
import Overview from "./pages/Overview";
import MapPage from "./pages/MapPage";
import CalendarPage from "./pages/CalendarPage";
import LabPage from "./pages/LabPage";
import HistoryPage from "./pages/HistoryPage";
import AnomaliesPage from "./pages/AnomaliesPage";
import AoiPage from "./pages/AoiPage";
import ReportsPage from "./pages/ReportsPage";
import SourcesPage from "./pages/SourcesPage";
import MethodologyPage from "./pages/MethodologyPage";

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </StoreProvider>
  );
}

function Shell() {
  const { immersive } = useStore();
  const { pathname } = useLocation();
  const fullBleed = pathname === "/";
  const [menu, setMenu] = React.useState(false); // phone: slide-out navigation
  const [filtersOpen, setFiltersOpen] = React.useState(false); // phone: filter bar folded away
  React.useEffect(() => { setMenu(false); setFiltersOpen(false); }, [pathname]);
  return (
    <div className="flex h-full overflow-hidden">
      {/* desktop sidebar */}
      <div className={clsx("hidden shrink-0 overflow-hidden transition-all duration-700 ease-out md:block", immersive ? "w-0 -translate-x-8 opacity-0" : "w-[218px] opacity-100")}>
        <Sidebar />
      </div>
      {/* phone: slide-out sidebar */}
      <div className={clsx("fixed inset-0 z-50 md:hidden", menu ? "pointer-events-auto" : "pointer-events-none")}>
        <div className={clsx("absolute inset-0 bg-black/60 transition-opacity duration-300", menu ? "opacity-100" : "opacity-0")} onClick={() => setMenu(false)} />
        <div className={clsx("absolute inset-y-0 left-0 transition-transform duration-300 ease-out", menu ? "translate-x-0" : "-translate-x-full")}>
          <Sidebar />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* phone: compact top bar */}
        <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2 md:hidden">
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 hover:bg-ink-800" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
          <Link to="/" title="FireScope home: Global Fire Map" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-harm to-[#7a1d0c]"><Satellite size={14} className="text-white" /></div>
            <span className="text-[15px] font-bold tracking-tight text-white">FireScope</span>
          </Link>
          <button className={clsx("ml-auto flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px]", filtersOpen ? "bg-ink-700 text-white" : "text-slate-300 hover:bg-ink-800")} onClick={() => setFiltersOpen((o) => !o)} aria-label="Filters">
            <SlidersHorizontal size={16} /> Filters
          </button>
        </div>
        <div className={clsx("overflow-hidden transition-all duration-700 ease-out", immersive ? "max-h-0 -translate-y-4 opacity-0" : "md:max-h-[400px] md:opacity-100", filtersOpen ? "max-h-[70vh] overflow-y-auto opacity-100" : "max-h-0 opacity-0 md:max-h-[400px] md:opacity-100")}>
          <FilterBar />
        </div>
        <DataBanner />
        <main className={clsx("min-h-0 flex-1", fullBleed ? "overflow-hidden" : "overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,rgba(224,85,47,0.06),transparent_50%)] p-3 md:p-5")}>
          <Routes>
            <Route path="/" element={<MapPage />} />
            <Route path="/map" element={<Navigate to="/" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/lab" element={<LabPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/anomalies" element={<AnomaliesPage />} />
            <Route path="/aoi" element={<AoiPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
