import { config } from '../pack';
// Whether the goal onboarding (#start, screens/Start.tsx) has been seen on this device. Its own tiny module so Home can
// ask without loading the onboarding screen.
export const START_SEEN = `pe.${config.id}.start.seen.v1`;
export const markStartSeen = () => { try { localStorage.setItem(START_SEEN, '1'); } catch (e) { /* private mode */ } };
export const startSeen = () => { try { return localStorage.getItem(START_SEEN) === '1'; } catch (e) { return true; } };
