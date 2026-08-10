import { Component, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Rooms from './pages/Rooms';
import Room from './pages/Room';
import Join from './pages/Join';
import Admin from './pages/Admin';
import { useUserStore } from './store/useUserStore';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useUserStore((state) => state.user);
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black text-white text-center gap-3">
          <h1 className="text-xl font-bold">Algo deu errado</h1>
          <p className="text-sm text-gray-400">Tente recarregar a página.</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#1db954] hover:bg-[#1ed760] text-black font-bold rounded-lg px-4 py-2 transition-colors"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <Router>
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/join" element={<Join />} />
          <Route path="/admin" element={<Admin />} />
          <Route 
            path="/rooms" 
            element={
              <ProtectedRoute>
                <Rooms />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/room/:id" 
            element={
              <ProtectedRoute>
                <Room />
              </ProtectedRoute>
            } 
          />
          {/* /join?code=XYZ lida a entrada por link de convite */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteErrorBoundary>
    </Router>
  );
}

export default App;
