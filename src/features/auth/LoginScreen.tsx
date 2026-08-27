import React, { useEffect } from 'react';
import { useToast } from '../../components/ui/Toast';
import { useNavigate, Navigate } from 'react-router-dom';
import { Receipt, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';

export function LoginScreen() {
  const navigate = useNavigate();
  const { signIn, user, loading, error } = useAuth();
  const { showToast } = useToast();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleLogin = async () => {
    if (!navigator.onLine) {
      showToast("You must be online to sign in.", "error");
      return;
    }
    await signIn();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="bg-blue-600 text-white p-3 rounded-2xl shadow-sm">
            <Receipt size={40} />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 tracking-tight">
          KharchaLens
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 max-w-sm mx-auto">
          Private, isolated expense tracking with intelligent receipt analysis.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-2xl sm:px-10 border border-gray-100">
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl text-center">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full flex justify-center items-center py-3 px-4 border border-gray-300 rounded-xl shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            <img 
              className="h-5 w-5 mr-2" 
              src="/google-logo.svg" 
              alt="Google logo" 
            />
            Continue with Google
          </button>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2 mb-4">
              <ShieldCheck size={18} className="text-green-600" />
              Privacy First Guarantee
            </h3>
            <ul className="text-xs text-gray-500 space-y-3">
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                Your data is strictly private and isolated.
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                Receipt images are processed temporarily and never persistently stored.
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                No advertising, no hidden telemetry, no selling data.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
