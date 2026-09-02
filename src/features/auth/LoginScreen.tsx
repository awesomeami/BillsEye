import React from 'react';
import { useToast } from '../../components/ui/Toast';
import { Navigate } from 'react-router-dom';
import { Receipt, ShieldCheck, Loader2, Check } from 'lucide-react';
import { useAuth } from './AuthContext';

const privacyPoints = [
  'Your expense data stays private to your account.',
  'Receipt images are processed temporarily and never stored.',
  'No advertising, hidden telemetry or data selling.',
];

export function LoginScreen() {
  const { signIn, user, loading, error } = useAuth();
  const { showToast } = useToast();

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-[var(--canvas)]"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
  }

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async () => {
    if (!navigator.onLine) {
      showToast('You must be online to sign in.', 'error');
      return;
    }
    await signIn();
  };

  return (
    <main className="relative flex min-h-dvh items-center overflow-x-hidden bg-[var(--canvas)] px-4 py-10 sm:px-6 lg:px-8">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-[var(--scanner-amber)]" />
      <div className="relative mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <section className="text-center lg:text-left">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-md bg-blue-600 text-white"><Receipt size={30} /></div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-[-0.045em] text-gray-950 sm:text-5xl">KharchaLens</h1>
          <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-gray-600 lg:mx-0 lg:text-lg">A clear, private view of everyday spending—built from the receipts you already have.</p>
          <div className="mt-8 hidden max-w-lg space-y-3 text-left lg:block">
            {privacyPoints.map(point => <div key={point} className="flex items-center gap-3 text-sm text-gray-600"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-blue-100 text-blue-700"><Check size={14} /></span>{point}</div>)}
          </div>
        </section>

        <section className="app-card mx-auto w-full max-w-md p-6 sm:p-8" aria-labelledby="signin-title">
          <div className="mb-6">
            <div className="flex items-center gap-2 text-blue-700"><ShieldCheck size={20} /><span className="text-sm font-semibold">Private by design</span></div>
            <h2 id="signin-title" className="mt-3 text-2xl font-bold tracking-tight text-gray-950">Welcome</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">Sign in to securely access your receipts and reports.</p>
          </div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">{error}</div> : null}

          <button onClick={handleLogin} className="btn-outline w-full py-3">
            <img className="h-5 w-5" src="/google-logo.svg" alt="" width={20} height={20} />
            Continue with Google
          </button>

          <div className="mt-6 space-y-3 border-t border-gray-100 pt-6 lg:hidden">
            {privacyPoints.map(point => <div key={point} className="flex items-start gap-2 text-xs leading-5 text-gray-500"><Check size={14} className="mt-0.5 shrink-0 text-blue-600" />{point}</div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
