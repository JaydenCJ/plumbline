/**
 * Did-you-mean support: a small Damerau–Levenshtein (adjacent
 * transpositions count as one edit, so "agrs" is one step from "args").
 * Used for typo'd config keys and unknown `explain` topics.
 */

/** Edit distance with adjacent transposition. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) (dist[i] as number[])[0] = i;
  for (let j = 0; j < cols; j += 1) (dist[0] as number[])[j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (dist[i - 1] as number[])[j]! + 1, // deletion
        (dist[i] as number[])[j - 1]! + 1, // insertion
        (dist[i - 1] as number[])[j - 1]! + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (dist[i - 2] as number[])[j - 2]! + 1); // transposition
      }
      (dist[i] as number[])[j] = best;
    }
  }
  return (dist[a.length] as number[])[b.length]!;
}

/**
 * The closest candidate to `input` within a distance budget, or null.
 * Case-insensitive: "Command" is distance 0 from "command", which lets
 * the caller phrase a casing-specific message.
 */
export function nearest(input: string, candidates: ReadonlyArray<string>, maxDistance = 2): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  const loweredInput = input.toLowerCase();
  for (const candidate of candidates) {
    const distance = editDistance(loweredInput, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
