import { BrowserRouter, Link, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { EmptyState, Button } from "./components/ui";
import { BrandProvider } from "./state/brand";
import { ToastProvider } from "./state/toast";
import Home from "./pages/Home";
import BrandBrainPage from "./pages/BrandBrain";
import AuditPage from "./pages/Audit";
import PlanPage from "./pages/Plan";
import EtsyPage from "./pages/EtsyPage";
import PinterestPage from "./pages/PinterestPage";
import ResearchPage from "./pages/Research";
import ApprovePage from "./pages/Approve";
import LibraryPage from "./pages/Library";
import CalendarPage from "./pages/Calendar";
import StylesPage from "./pages/Styles";
import AutomationsPage from "./pages/Automations";
import InstagramPage from "./pages/InstagramPage";
import SettingsPage from "./pages/SettingsPage";
import UseInClaude from "./pages/UseInClaude";
import AssistantPage from "./pages/Assistant";
import AutopilotPage from "./pages/Autopilot";
import ClipsPage from "./pages/Clips"; // long video → short clips
import { Compass } from "lucide-react";

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <BrandProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="new" element={<Home />} />
              <Route path="brands/:id" element={<BrandBrainPage />} />
              <Route path="brain" element={<BrandBrainPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="plan" element={<PlanPage />} />
              <Route path="autopilot" element={<AutopilotPage />} />
              <Route path="clips" element={<ClipsPage />} />
              <Route path="etsy" element={<EtsyPage />} />
              <Route path="pinterest" element={<PinterestPage />} />
              <Route path="research" element={<ResearchPage />} />
              <Route path="approve" element={<ApprovePage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="styles" element={<StylesPage />} />
              <Route path="automations" element={<AutomationsPage />} />
              <Route path="instagram" element={<InstagramPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="claude" element={<UseInClaude />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route
                path="*"
                element={
                  <EmptyState icon={<Compass className="size-6" />} title="Page not found" action={<Link to="/"><Button variant="primary">Go home</Button></Link>}>
                    That page doesn't exist.
                  </EmptyState>
                }
              />
            </Route>
          </Routes>
        </BrandProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
