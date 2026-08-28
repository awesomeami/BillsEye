import React, { useState } from 'react';
import { useAiKeys } from './AiKeysContext';
import { ExtractionClient } from '../../../services/ai/ExtractionClient';
import { type ExtractionResultDTO } from '../../../domain/schema';

export function ExtractionTest() {
  const { executor, getDecryptedKey } = useAiKeys();
  const [file, setFile] = useState<File | null>(null);

  const [result, setResult] = useState<ExtractionResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleTest = async () => {
    if (!file) {
      setError('Please select an image first.');
      return;
    }
    if (!executor) {
      setError('AI Request Executor is not initialized. Please check keys.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Use the executor's execute method to pass through the rotation engine
      // The execute method provides the `key` as the first arg.
      // Notice how the network call and everything is contained here, leveraging rotation.
      const data = await executor.execute<ExtractionResultDTO>(
        'TestReceiptExtraction',
        async (key, signal) => {
          return await ExtractionClient.extractReceipt(key, file, signal);
        },
        getDecryptedKey
      );
      setResult(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred during extraction.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Real Gemini Extraction Test</h3>
        <p className="text-sm text-gray-600 mb-4">
          This form will send the image to the actual Gemini extraction backend. It enforces no-storage, verifies authentication, and uses the real rotation engine.
        </p>
        
        <input 
          type="file" 
          accept="image/jpeg, image/png, image/webp" 
          onChange={handleFileChange}
          className="mb-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />

        {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg">{error}</div>}
        
        <button
          onClick={handleTest}
          disabled={loading || !file}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Run Extraction'}
        </button>
      </div>

      {result && (
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 overflow-auto max-h-[600px]">
          <pre className="text-xs text-gray-800 whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
