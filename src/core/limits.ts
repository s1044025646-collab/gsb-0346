export interface Limits {
  maxLength: number;
  maxIntegerDigits: number;
  maxExplanations: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxLength: 4096,
  maxIntegerDigits: 1000,
  maxExplanations: 100
};
