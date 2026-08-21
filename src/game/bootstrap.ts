// Asset-loading boundary. Bootstrap gathers every archetype the validated
// level requires, then awaits all GLBs before the simulation is exposed.
import { loadArchetype, type ArchetypeAsset } from '../actors/actor';

export async function loadArchetypes(names: Iterable<string>): Promise<Map<string, ArchetypeAsset>> {
  const unique = [...new Set(names)];
  const entries = await Promise.all(
    unique.map(async (name) => [name, await loadArchetype(name)] as const),
  );
  return new Map(entries);
}

export function requireArchetype(
  assets: ReadonlyMap<string, ArchetypeAsset>,
  name: string,
): ArchetypeAsset {
  const asset = assets.get(name);
  if (!asset) throw new Error(`Archetype was not loaded: ${name}`);
  return asset;
}
