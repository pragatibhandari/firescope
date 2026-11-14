import React from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { StoreProvider } from "./lib/store";
import { DemoBanner, FilterBar, Sidebar } from "./components/Layout";
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
        <div className="flex h-full">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <FilterBar />
            <DemoBanner />
            <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,rgba(224,85,47,0.06),transparent_50%)] p-5">
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/map" element={<MapPage />} />
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
      </HashRouter>
    </StoreProvider>
  );
}
