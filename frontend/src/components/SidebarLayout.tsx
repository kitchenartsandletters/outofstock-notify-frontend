// SidebarLayout.tsx
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react'; // optional, you can swap icons

console.log('Initial window width:', window.innerWidth);

const navItems = [
  { label: 'Request Service', path: '/requests' },
  { label: 'System Status', path: '/status' },
];

const SidebarLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const toggleSidebar = () => {
    console.log('[Toggle] clicked');
    setSidebarOpen(prev => {
        const newState = !prev;
        console.log('[Sidebar Toggle] sidebarOpen:', newState);
        return newState;
    });
    };

    useEffect(() => {
        console.log('[SidebarEffect] sidebarOpen changed to:', sidebarOpen);
    }, [sidebarOpen]);

  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
        closeSidebar();
        }
    };

    if (sidebarOpen) {
        window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
        window.removeEventListener('keydown', handleKeyDown);
    };
    }, [sidebarOpen]);

    const sidebarClass = `
        fixed z-40 top-0 left-0 h-full w-64 bg-white dark:bg-gray-800 shadow-lg transform transition-transform duration-300 ease-in-out min-w-64
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 md:flex md:flex-col md:w-64 md:shadow-none md:z-auto
    `;
  return (
    <div className="flex min-h-screen bg-white dark:bg-gray-900 text-black dark:text-white">
      {/* Sidebar */}
      <aside
        className={sidebarClass}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b dark:border-gray-700 md:hidden">
          <h2 className="text-xl font-bold">Menu</h2>
          <button onClick={closeSidebar}>
            <X className="w-6 h-6" />
          </button>
        </div>
        <nav className="flex flex-col p-4 gap-2">
          {navItems.map(({ label, path }) => (
            <Link
              key={path}
              to={path}
              onClick={closeSidebar}
              className={`px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-all
                ${location.pathname === path ? 'bg-gray-200 dark:bg-gray-700 font-semibold' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black bg-opacity-50 md:hidden"
          onClick={closeSidebar}
        ></div>
      )}
      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700 md:hidden">
          <button onClick={toggleSidebar}>
            <Menu className="w-6 h-6" />
          </button>
          <div className="font-semibold text-lg">Admin Dashboard</div>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export default SidebarLayout;