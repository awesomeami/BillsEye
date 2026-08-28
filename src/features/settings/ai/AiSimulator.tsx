import React, { useState, useRef } from 'react';
import { Activity, StopCircle, Terminal } from 'lucide-react';
import { useAiKeys } from './AiKeysContext';

export function AiSimulator() {
  const { executor, getDecryptedKey, activeKeyIndex } = useAiKeys();
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  const runScenario = async (scenarioType: string) => {
    if (!executor) return;
    
    setLogs([]);
    setIsRunning(true);
    abortControllerRef.current = new AbortController();
    
    addLog(`Starting scenario: ${scenarioType}`);

    try {
      let attemptsCounter = 0;
      
      const result = await executor.execute(
        'SimulatedExtraction',
        async (key, signal) => {
          attemptsCounter++;
          addLog(`Attempt ${attemptsCounter}: Executor provided a key (starts with [REDACTED]).`);
          addLog(`Currently active UI slot index is: ${activeKeyIndex}`);
          
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          
          // Simulate network delay
          await new Promise(r => setTimeout(r, 1000));
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

          switch (scenarioType) {
            case 'success':
              return { success: true, text: 'Receipt Extracted' };
              
            case '429_then_success':
              if (attemptsCounter === 1) {
                addLog('Simulating 429 RESOURCE_EXHAUSTED');
                throw { status: 429, message: 'Too Many Requests', retryAfterMs: 5000 };
              }
              return { success: true, text: 'Receipt Extracted on retry' };
              
            case '401_then_success':
              if (attemptsCounter === 1) {
                addLog('Simulating 401 INVALID_API_KEY');
                throw { status: 401, message: 'API key not valid. Please pass a valid API key.' };
              }
              return { success: true, text: 'Receipt Extracted on retry' };
              
            case 'all_429':
              addLog('Simulating 429 RESOURCE_EXHAUSTED');
              throw { status: 429, message: 'Too Many Requests', retryAfterMs: 10000 };
              
            case '400_no_rotation':
              addLog('Simulating 400 Bad Request (Schema/Safety)');
              throw { status: 400, message: 'Invalid schema requested.' };
              
            default:
              return { success: true };
          }
        },
        getDecryptedKey,
        { signal: abortControllerRef.current.signal }
      );
      
      addLog(`Success! Result: ${JSON.stringify(result)}`);
    } catch (error) {
      addLog(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  const cancel = () => {
    if (abortControllerRef.current) {
      addLog('Cancelling request...');
      abortControllerRef.current.abort();
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Activity className="text-blue-600" />
        Rotation & Transport Simulator
      </h3>
      <p className="text-sm text-gray-500 mb-6">
        Developer tool to test vault retrieval, error classification, and round-robin key rotation without calling live Gemini endpoints.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <button disabled={isRunning} onClick={() => runScenario('success')} className="btn-simulator">Test Success</button>
        <button disabled={isRunning} onClick={() => runScenario('429_then_success')} className="btn-simulator">429 then Success</button>
        <button disabled={isRunning} onClick={() => runScenario('401_then_success')} className="btn-simulator">401 then Success</button>
        <button disabled={isRunning} onClick={() => runScenario('all_429')} className="btn-simulator">All 429</button>
        <button disabled={isRunning} onClick={() => runScenario('400_no_rotation')} className="btn-simulator">400 (No Rotate)</button>
        <button disabled={!isRunning} onClick={cancel} className="flex items-center justify-center gap-1 py-2 px-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50">
          <StopCircle size={16}/> Cancel
        </button>
      </div>

      <div className="bg-gray-900 rounded-xl p-4 font-mono text-sm h-64 overflow-y-auto">
        <div className="flex items-center gap-2 text-gray-400 mb-2 border-b border-gray-700 pb-2">
          <Terminal size={16} />
          <span>Console Output</span>
        </div>
        {logs.length === 0 ? (
          <span className="text-gray-500">Ready. Run a scenario above.</span>
        ) : (
          <div className="space-y-1">
            {logs.map((log, i) => (
              <div key={i} className={log.includes('Failed') || log.includes('Simulating 4') ? 'text-red-400' : log.includes('Success') ? 'text-green-400' : 'text-gray-300'}>
                {log}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .btn-simulator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          padding: 0.5rem 0.75rem;
          background-color: #f9fafb;
          color: #374151;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s;
        }
        .btn-simulator:hover:not(:disabled) {
          background-color: #f3f4f6;
          border-color: #d1d5db;
        }
        .btn-simulator:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
