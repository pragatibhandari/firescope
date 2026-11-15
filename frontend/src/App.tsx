import React from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import clsx from "clsx";
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
  return (
    <div className="flex h-full overflow-hidden">
      {/* sidebar + filter bar slide away while the cinematic intro owns the screen */}
      <div className={clsx("shrink-0 overflow-hidden transition-all duration-700 ease-out", immersive ? "w-0 -translate-x-8 opacity-0" : "w-[218px] opacity-100")}>
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={clsx("overflow-hidden transition-all duration-700 ease-out", immersive ? "max-h-0 -translate-y-4 opacity-0" : "max-h-[400px] opacity-100")}>
          <FilterBar />
          <DataBanner />
        </div>
        <main className={clsx("min-h-0 flex-1", fullBleed ? "overflow-hidden" : "overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,rgba(224,85,47,0.06),transparent_50%)] p-5")}>
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
