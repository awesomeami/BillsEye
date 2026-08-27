# KharchaLens - Project Rules

This document outlines the strict constraints and rules for KharchaLens.

## Product Constraints
1. **Authentication**: Every user signs in with their own Google account. No guest mode for core data.
2. **Data Privacy**: Each user's receipt data is strictly private and isolated from every other user.
3. **No Persistent Images**: Receipt images are temporary OCR inputs ONLY. They MUST NEVER be persistently stored anywhere (no Firebase Storage, AWS S3, etc.).
4. **Data Storage**: Firebase Authentication and Cloud Firestore will eventually be used to store *only* user profiles, OCR text, and structured receipt data. 
5. **AI vs Logic Rules**: Gemini is strictly used for extracting information from receipts. TypeScript code—NOT Gemini—calculates all totals, trends, comparisons, and charts.
6. **Localization Settings**: Default currency is PKR (Pakistani Rupee), locale is `en-PK`, and time zone is `Asia/Karachi`. These settings must be centralized.
7. **Monetization & Tracking**: No telemetry, no advertisements, no subscriptions, and no paid services.

## Architecture Constraints
1. **Stack**: React 19, TypeScript, Vite, Tailwind CSS. Compatible with Google AI Studio preview and Vercel Hobby.
2. **Dependencies**: Only free, maintained, open-source npm packages. Do not add cloud functions, Supabase, alternative databases, etc.
3. **Structure**: Feature-oriented (e.g., `/src/features/auth`, `/src/features/receipts`). Domain logic remains outside React components.
4. **Resilience**: Must include global error boundaries, loading states, a toast system, and confirmation dialog primitives.
5. **Development Mode**: Use isolated mock data specifically labeled as development-only until full integration.

## UI/UX Guidelines
1. **Navigation**: Bottom navigation on phones with a visually dominant central "Add Receipt" action. Compact sidebar on tablet/desktop.
2. **Simplicity**: Avoid dense fintech styling. Use plain wording and controls that a normal family user will understand. Avoid decorative 3D charts.
3. **Accessibility**: Large touch targets (minimum 44px on mobile), accessible contrast, visible focus, clear empty and error states. 
4. **Action Hierarchy**: One obvious primary action per screen.
