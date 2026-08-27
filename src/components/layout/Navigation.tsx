import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Receipt, PlusCircle, PieChart, Settings, Inbox } from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useAuth } from '../../features/auth/AuthContext';
import { useReceiptsLibrary } from '../../features/receipts/library/ReceiptsLibraryContext';

export function Navigation() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { user } = useAuth();
  const { pendingReceipts } = useReceiptsLibrary();
  
  const pendingCount = pendingReceipts.length;

  const navItems = [
    { name: 'Home', path: '/', icon: Home },
    { name: 'Inbox', path: '/inbox', icon: Inbox },
    { name: 'Receipts', path: '/receipts', icon: Receipt },
    { name: 'Reports', path: '/reports', icon: PieChart },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-safe z-50">
        <div className="flex justify-around items-center h-16 px-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPath === item.path;
            const isInbox = item.name === 'Inbox';
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full space-y-1 text-[10px] sm:text-xs",
                  isActive ? "text-blue-600" : "text-gray-500 hover:text-gray-900"
                )}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  {isInbox && pendingCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <span className="font-medium truncate">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      {/* Mobile Add FAB */}
      <div className="md:hidden fixed bottom-20 right-4 z-50">
        <Link
          to="/add"
          className="flex items-center justify-center w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300"
          aria-label="Add Receipt"
        >
          <PlusCircle size={28} strokeWidth={2.5} />
        </Link>
      </div>

      {/* Desktop/Tablet Sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-screen bg-white border-r border-gray-200 sticky top-0">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-lg">
            <Receipt size={24} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">KharchaLens</h1>
        </div>

        <div className="px-4 pb-6">
          <Link
            to="/add"
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-medium transition-colors shadow-sm"
          >
            <PlusCircle size={20} />
            <span>Add Receipt</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPath === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-lg font-medium transition-colors",
                  isActive 
                    ? "bg-blue-50 text-blue-700" 
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                    <span>{item.name}</span>
                  </div>
                  {item.name === 'Inbox' && pendingCount > 0 && (
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">
                      {pendingCount}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
          
          </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-gray-200" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm">
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-gray-900 truncate">{user?.displayName || 'Unknown User'}</span>
              <span className="text-xs text-gray-500 truncate">{user?.email}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
