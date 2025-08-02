import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import SidebarLayout from './components/SidebarLayout';
import AdminDashboard from './components/AdminDashboard';
import SystemStatusDashboard from './components/SystemStatusDashboard'; // placeholder for now

const App = () => {
  return (
    <Router>
      <SidebarLayout>
        <Routes>
          <Route path="/requests" element={<AdminDashboard />} />
          <Route path="/status" element={<SystemStatusDashboard />} />
          <Route path="*" element={<Navigate to="/requests" replace />} />
        </Routes>
      </SidebarLayout>
    </Router>
  );
};

export default App;