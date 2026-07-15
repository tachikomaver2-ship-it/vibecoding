export type GraderResult = {
  level: 'L1' | 'L2' | 'L3';
  passed: boolean;
  score: number; // 0-1
  details: Record<string, any>;
  reasoning?: string;
};
