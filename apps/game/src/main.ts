import { forbidEval } from './zod-config.ts';

// zod compiles its schemas when @nebotok/core is first imported, so eval has to be ruled out before
// the app and its imports load at all.
forbidEval();
await import('./app.ts');
