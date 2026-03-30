
export const verifiedStatuses = [
  'auto_verified',
  'manually_verified',
  'auto_partially_verified',
  'manually_partially_verified',
] as const;

export type VerifiedStatus = typeof verifiedStatuses[number];