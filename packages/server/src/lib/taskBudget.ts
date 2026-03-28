const RATIOS: Record<string, number> = { low: 4, normal: 2, high: 1 };
const FLOORS: Record<string, number> = { low: 2, normal: 3, high: 5 };

export function computeTaskBudget(opts: {
  plantCount: number;
  taskQuantity?: "low" | "normal" | "high";
}): { maxTasks: number; ratio: number; floor: number } {
  const quantity = opts.taskQuantity ?? "normal";
  const ratio = RATIOS[quantity];
  const floor = FLOORS[quantity];
  const maxTasks = Math.max(floor, Math.ceil(opts.plantCount / ratio));
  return { maxTasks, ratio, floor };
}
