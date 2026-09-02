import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Receipt, PlusCircle, PieChart, Settings, Inbox, MoreHorizontal, X } from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useAuth } from '../../features/auth/AuthContext';
import { useReceiptsLibrary } from '../../features/receipts/library/ReceiptsLibraryContext';
import { preloadRoute } from '../../app/routing/routePreload';

const desktopNavItems = [
  { name: 'Home', path: '/', icon: Home },
  { name: 'Inbox', path: '/inbox', icon: Inbox },
  { name: 'Receipts', path: '/receipts', icon: Receipt },
  { name: 'Reports', path: '/reports', icon: PieChart },
  { name: 'Settings', path: '/settings', icon: Settings },
] as const;

const isRouteActive = (currentPath: string, path: string) => (
  path === '/' ? currentPath === '/' : currentPath === path || currentPath.startsWith(`${path}/`)
);

const preloadProps = (path: string) => ({
  onMouseEnter: () => preloadRoute(path),
  onFocus: () => preloadRoute(path),
  onTouchStart: () => preloadRoute(path),
});

export function Navigation() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { user } = useAuth();
  const { pendingReceipts } = useReceiptsLibrary();
  const [moreOpen, setMoreOpen] = useState(false);
  const pendingCount = pendingReceipts.length;
  const moreIsActive = isRouteActive(currentPath, '/reports') || isRouteActive(currentPath, '/settings');

  useEffect(() => setMoreOpen(false), [currentPath]);

  return (
    <>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="flex h-16 items-center justify-around px-1">
          <MobileNavLink name="Home" path="/" icon={Home} isActive={isRouteActive(currentPath, '/')} />
          <MobileNavLink name="Inbox" path="/inbox" icon={Inbox} isActive={isRouteActive(currentPath, '/inbox')} badge={pendingCount} />
          <Link {...preloadProps('/add')} to="/add" className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-blue-700" aria-label="Add Receipt" aria-current={currentPath === '/add' ? 'page' : undefined}>
            <span className={cn(
              'flex h-11 w-11 items-center justify-center rounded-md bg-blue-600 text-white',
              currentPath === '/add' ? 'outline-2 outline-offset-2 outline-blue-600' : 'hover:bg-blue-700',
            )}>
              <PlusCircle size={25} strokeWidth={2.5} />
            </span>
            <span className="text-[11px] font-semibold">Add</span>
          </Link>
          <MobileNavLink name="Receipts" path="/receipts" icon={Receipt} isActive={isRouteActive(currentPath, '/receipts')} />
          <button type="button" onClick={() => setMoreOpen(open => !open)} aria-expanded={moreOpen} aria-controls="mobile-more-menu" className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]', moreIsActive || moreOpen ? 'text-blue-700' : 'text-gray-500 hover:text-gray-900')}>
            <MoreHorizontal size={22} strokeWidth={moreIsActive || moreOpen ? 2.5 : 2} />
            <span className="font-medium">More</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <>
          <button type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 bg-gray-950/15 md:hidden" />
          <div id="mobile-more-menu" role="menu" aria-label="More destinations" className="fixed right-3 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-50 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl md:hidden">
            <div className="flex items-center justify-between px-2 pb-2 text-xs font-semibold text-gray-500">
              More
              <button type="button" onClick={() => setMoreOpen(false)} className="touch-target -mr-2 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Close more menu"><X size={18} /></button>
            </div>
            <MoreMenuLink name="Reports" path="/reports" icon={PieChart} isActive={isRouteActive(currentPath, '/reports')} />
            <MoreMenuLink name="Settings" path="/settings" icon={Settings} isActive={isRouteActive(currentPath, '/settings')} />
          </div>
        </>
      ) : null}

      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col overflow-y-auto border-r border-gray-200/90 bg-white/90 md:flex lg:w-60">
        <div className="flex min-h-20 items-center justify-center gap-3 px-3 lg:justify-start lg:px-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white"><Receipt size={23} /></div>
          <h1 className="hidden text-xl font-semibold tracking-tight text-gray-950 lg:block">Kharcha Lens</h1>
        </div>

        <div className="px-3 pb-5 lg:px-4">
          <Link {...preloadProps('/add')} to="/add" aria-label="Add Receipt" className="btn-primary w-full px-0 lg:px-4">
            <PlusCircle size={20} />
            <span className="hidden lg:inline">Add Receipt</span>
          </Link>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-1 px-3 lg:px-4">
          {desktopNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = isRouteActive(currentPath, item.path);
            return (
              <Link
                {...preloadProps(item.path)}
                key={item.name}
                to={item.path}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.name}
                title={item.name}
                className={cn(
                  'relative flex min-h-12 items-center justify-center rounded-md px-3 font-medium lg:justify-start lg:gap-3',
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950',
                )}
              >
                {isActive ? <span aria-hidden="true" className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-blue-600" /> : null}
                <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                <span className="hidden lg:inline">{item.name}</span>
                {item.name === 'Inbox' && pendingCount > 0 ? (
                  <span className="absolute top-1.5 right-1.5 min-w-5 rounded-full bg-red-100 px-1.5 text-center text-xs font-bold leading-5 text-red-700 lg:static lg:ml-auto">
                    {pendingCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-3 lg:p-4">
          <div className="flex items-center justify-center gap-3 rounded-xl py-2 lg:justify-start lg:px-2">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" width={32} height={32} decoding="async" className="h-8 w-8 shrink-0 rounded-full border border-gray-200" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-600">{user?.email?.charAt(0).toUpperCase() || 'U'}</div>
            )}
            <div className="hidden min-w-0 flex-col lg:flex">
              <span className="truncate text-sm font-medium text-gray-900">{user?.displayName || 'Unknown User'}</span>
              <span className="truncate text-xs text-gray-500">{user?.email}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function MobileNavLink({ name, path, icon: Icon, isActive, badge = 0 }: { name: string; path: string; icon: typeof Home; isActive: boolean; badge?: number }) {
  return (
    <Link {...preloadProps(path)} to={path} aria-label={name} aria-current={isActive ? 'page' : undefined} className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'text-blue-700' : 'text-gray-500 hover:text-gray-900')}>
      <span className="relative"><Icon size={22} strokeWidth={isActive ? 2.5 : 2} />{badge > 0 ? <span className="absolute -top-1 -right-2 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{badge}</span> : null}</span>
      <span className="font-medium">{name}</span>
    </Link>
  );
}

function MoreMenuLink({ name, path, icon: Icon, isActive }: { name: string; path: string; icon: typeof Home; isActive: boolean }) {
  return <Link {...preloadProps(path)} to={path} role="menuitem" className={cn('touch-target flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium', isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50')}><Icon size={18} />{name}</Link>;
}
