export function shouldFloatDisplayAlias(alias: string | undefined): boolean {
  if (alias === undefined) {
    return false;
  }
  let widthUnits = 0;
  for (const character of alias) {
    const codePoint = character.codePointAt(0) ?? 0;
    widthUnits += codePoint <= 0xff ? 1 : 2;
  }
  return widthUnits > 28;
}
