import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Receipt, PlusCircle, PieChart, Settings, Inbox, MoreHorizontal, X } from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useAuth } from '../../features/auth/AuthContext';
import { useReceiptsLibrary } from '../../features/receipts/library/ReceiptsLibraryContext';

const desktopNavItems = [
  { name: 'Home', path: '/', icon: Home },
  { name: 'Inbox', path: '/inbox', icon: Inbox },
  { name: 'Receipts', path: '/receipts', icon: Receipt },
  { name: 'Reports', path: '/reports', icon: PieChart },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export function Navigation() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { user } = useAuth();
  const { pendingReceipts } = useReceiptsLibrary();
  const [moreOpen, setMoreOpen] = useState(false);
  const pendingCount = pendingReceipts.length;
  const moreIsActive = currentPath === '/reports' || currentPath === '/settings';

  useEffect(() => setMoreOpen(false), [currentPath]);

  return (
    <>
      <nav aria-label="Mobile navigation" className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)]">
        <div className="flex h-16 items-center justify-around px-1">
          <MobileNavLink name="Home" path="/" icon={Home} isActive={currentPath === '/'} />
          <MobileNavLink name="Inbox" path="/inbox" icon={Inbox} isActive={currentPath === '/inbox'} badge={pendingCount} />
          <Link to="/add" className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-blue-700" aria-label="Add Receipt" aria-current={currentPath === '/add' ? 'page' : undefined}>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700"><PlusCircle size={25} strokeWidth={2.5} /></span>
            <span className="text-[10px] font-semibold">Add</span>
          </Link>
          <MobileNavLink name="Receipts" path="/receipts" icon={Receipt} isActive={currentPath === '/receipts'} />
          <button type="button" onClick={() => setMoreOpen(open => !open)} aria-expanded={moreOpen} aria-controls="mobile-more-menu" className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[10px]', moreIsActive || moreOpen ? 'text-blue-700' : 'text-gray-500 hover:text-gray-900')}>
            <MoreHorizontal size={22} strokeWidth={moreIsActive || moreOpen ? 2.5 : 2} />
            <span className="font-medium">More</span>
          </button>
        </div>
      </nav>
      {moreOpen && <div id="mobile-more-menu" role="menu" aria-label="More destinations" className="md:hidden fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] right-3 z-50 w-52 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl"><div className="flex items-center justify-between px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">More<button type="button" onClick={() => setMoreOpen(false)} className="touch-target -mr-2 flex items-center justify-center text-gray-500" aria-label="Close more menu"><X size={18} /></button></div><MoreMenuLink name="Reports" path="/reports" icon={PieChart} isActive={currentPath === '/reports'} /><MoreMenuLink name="Settings" path="/settings" icon={Settings} isActive={currentPath === '/settings'} /></div>}

      <aside className="hidden md:flex flex-col w-64 h-screen bg-white border-r border-gray-200 sticky top-0">
        <div className="p-6 flex items-center gap-3"><div className="bg-blue-600 text-white p-2 rounded-lg"><Receipt size={24} /></div><h1 className="text-xl font-bold text-gray-900 tracking-tight">KharchaLens</h1></div>
        <div className="px-4 pb-6"><Link to="/add" className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-medium transition-colors shadow-sm"><PlusCircle size={20} /><span>Add Receipt</span></Link></div>
        <nav aria-label="Main navigation" className="flex-1 px-4 space-y-1">{desktopNavItems.map((item) => { const Icon = item.icon; const isActive = currentPath === item.path; return <Link key={item.name} to={item.path} aria-current={isActive ? 'page' : undefined} className={cn('flex items-center gap-3 px-3 py-3 rounded-lg font-medium transition-colors', isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900')}><div className="flex items-center justify-between w-full"><div className="flex items-center gap-3"><Icon size={20} strokeWidth={isActive ? 2.5 : 2} /><span>{item.name}</span></div>{item.name === 'Inbox' && pendingCount > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">{pendingCount}</span>}</div></Link>; })}</nav>
        <div className="p-4 border-t border-gray-200"><div className="flex items-center gap-3 px-3 py-2">{user?.photoURL ? <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-gray-200" /> : <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm">{user?.email?.charAt(0).toUpperCase() || 'U'}</div>}<div className="flex flex-col overflow-hidden"><span className="text-sm font-medium text-gray-900 truncate">{user?.displayName || 'Unknown User'}</span><span className="text-xs text-gray-500 truncate">{user?.email}</span></div></div></div>
      </aside>
    </>
  );
}

function MobileNavLink({ name, path, icon: Icon, isActive, badge = 0 }: { name: string; path: string; icon: typeof Home; isActive: boolean; badge?: number }) {
  return <Link to={path} aria-label={name} aria-current={isActive ? 'page' : undefined} className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[10px]', isActive ? 'text-blue-700' : 'text-gray-500 hover:text-gray-900')}><span className="relative"><Icon size={22} strokeWidth={isActive ? 2.5 : 2} />{badge > 0 && <span className="absolute -top-1 -right-2 min-w-4 h-4 rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">{badge}</span>}</span><span className="font-medium">{name}</span></Link>;
}

function MoreMenuLink({ name, path, icon: Icon, isActive }: { name: string; path: string; icon: typeof Home; isActive: boolean }) {
  return <Link to={path} role="menuitem" className={cn('touch-target flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium', isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50')}><Icon size={18} />{name}</Link>;
}
