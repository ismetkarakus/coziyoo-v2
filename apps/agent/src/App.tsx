import { Navigate, Route, Routes } from "react-router-dom";
import RouteGuard from "./components/RouteGuard";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SettingsPage from "./pages/SettingsPage";
import { isLoggedIn } from "./lib/auth";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={isLoggedIn() ? "/home" : "/login"} replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/home" element={<RouteGuard><HomePage /></RouteGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
