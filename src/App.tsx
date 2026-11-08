import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { EngineInstallCreatePage, EngineInstallDetailPage, EngineManagerPage } from "./pages/engines/EnginePages";
import { DownloadedModelsPage } from "./pages/models/ModelsPages";
import { ModelSearchPage } from "./pages/models/ModelSearchPage";
import { ModelDownloadsPage } from "./pages/models/ModelDownloadsPage";
import { ModelDetailPage } from "./pages/models/ModelDetailPage";
import { PluginDetailPage, PluginsPage } from "./pages/plugins/PluginPages";
import { ProfileEditPage } from "./pages/profiles/ProfileEditPage";
import { ProfilesList } from "./pages/profiles/ProfilesList";
import { ProviderEditPage, ProviderManagerPage } from "./pages/providers/ProviderPages";
import { RouterPage } from "./pages/router/RouterPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { AssistantSettingsPage } from "./pages/settings/AssistantSettingsPage";
import { CpuGpuSettingsPage, InferenceSettingsPage, ModelsDirSettingsPage, NetworkSettingsPage, UsersSettingsPage } from "./pages/settings/SettingsSubPages";
import { CreateInferencePage } from "./pages/CreateInferencePage";
import { DashboardPage } from "./pages/DashboardPage";
import { InferenceDetailPage } from "./pages/InferenceDetailPage";
import { LoginPage } from "./pages/LoginPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/inferences/new" element={<CreateInferencePage />} />
          <Route path="/inferences/:id" element={<InferenceDetailPage />} />

          {/* Хаб раздела удалён: `/models` — канонический вход, ведёт на
              поиск (он же в сайдбаре и в хлебных крошках). */}
          <Route path="/models" element={<Navigate to="/models/search" replace />} />
          <Route path="/models/search" element={<ModelSearchPage />} />
          <Route path="/models/downloads" element={<ModelDownloadsPage />} />
          <Route path="/models/downloaded" element={<DownloadedModelsPage />} />
          <Route path="/models/:id" element={<ModelDetailPage />} />

          <Route path="/profiles" element={<ProfilesList />} />
          <Route path="/profiles/new" element={<ProfileEditPage mode="create" />} />
          <Route path="/profiles/:id" element={<ProfileEditPage mode="edit" />} />

          <Route path="/engines" element={<EngineManagerPage />} />
          <Route path="/engines/new" element={<EngineInstallCreatePage />} />
          <Route path="/engines/:id" element={<EngineInstallDetailPage />} />

          <Route path="/providers" element={<ProviderManagerPage />} />
          <Route path="/providers/:id" element={<ProviderEditPage />} />

          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/plugins/:id" element={<PluginDetailPage />} />

          <Route path="/router" element={<RouterPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/users" element={<UsersSettingsPage />} />
          <Route path="/settings/models-dir" element={<ModelsDirSettingsPage />} />
          <Route path="/settings/network" element={<NetworkSettingsPage />} />
          <Route path="/settings/cpu-gpu" element={<CpuGpuSettingsPage />} />
          <Route path="/settings/inference" element={<InferenceSettingsPage />} />
          <Route path="/settings/assistant" element={<AssistantSettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
