/** `parts` repeated `times` times, e.g. repeat([WORK, CARRY], 2) -> [WORK, CARRY, WORK, CARRY]. */
export function repeat(parts: BodyPartConstant[], times: number): BodyPartConstant[] {
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < times; i++) body.push(...parts);
  return body;
}
