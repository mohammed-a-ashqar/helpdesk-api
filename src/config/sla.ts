import { assertValidPolicy, type SlaPolicy } from '../modules/sla/domain/sla-policy.js';

/**
 * Service-level targets per priority, in calendar minutes.
 *
 * | priority | first response | resolution |
 * |----------|----------------|------------|
 * | urgent   | 30 min         | 4 h        |
 * | high     | 1 h            | 8 h        |
 * | medium   | 4 h            | 24 h       |
 * | low      | 8 h            | 72 h       |
 */
export const defaultSlaPolicy: SlaPolicy = assertValidPolicy({
  targets: {
    urgent: { firstResponseMinutes: 30, resolutionMinutes: 4 * 60 },
    high: { firstResponseMinutes: 60, resolutionMinutes: 8 * 60 },
    medium: { firstResponseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
    low: { firstResponseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
  },
  atRiskRatio: 0.25,
});
