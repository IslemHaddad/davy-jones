import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginScreen } from "./components/Auth/LoginScreen";
import { SealScreen } from "./components/Auth/SealScreen";
import { Dashboard } from "./components/Dashboard";

function Gate() {
  const { phase } = useAuth();

  if (phase === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas text-xs text-ink-faint">
        Loading...
      </div>
    );
  }
  if (phase === "needs-init") return <SealScreen phase="needs-init" />;
  if (phase === "sealed") return <SealScreen phase="sealed" />;
  if (phase === "needs-setup") return <LoginScreen mode="needs-setup" />;
  if (phase === "locked") return <LoginScreen mode="locked" />;
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
