import type { Hono } from 'hono';
import type { Storage } from '../storage.ts';
import { body } from '../context.ts';
import { embeddedPreferencesPatch, embeddedPreferencesPath } from '../../../packages/contracts/preferences.ts';

export function registerPreferenceRoutes(app: Hono, storage: Storage): void {
  app.get(embeddedPreferencesPath, (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ item: storage.getEmbeddedPreferences() });
  });
  app.patch(embeddedPreferencesPath, async (c) => {
    const input = await body(c, embeddedPreferencesPatch);
    c.header('Cache-Control', 'no-store');
    return c.json({ item: storage.patchEmbeddedPreferences(input) });
  });
}
