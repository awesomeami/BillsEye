export const isE2eMockMode = (
  import.meta.env.MODE === 'e2e' && import.meta.env.VITE_E2E_MOCKS === 'true'
);
