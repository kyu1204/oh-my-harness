import type { BuildingBlock } from "./types.js";

export class CatalogRegistry {
  private blocks: Map<string, BuildingBlock> = new Map();

  register(block: BuildingBlock): void {
    this.blocks.set(block.id, block);
  }

  get(id: string): BuildingBlock | undefined {
    return this.blocks.get(id);
  }

  has(id: string): boolean {
    return this.blocks.has(id);
  }

  list(): BuildingBlock[] {
    return Array.from(this.blocks.values());
  }

  listByCategory(category: string): BuildingBlock[] {
    return this.list().filter((b) => b.category === category);
  }

  listByEvent(event: string): BuildingBlock[] {
    return this.list().filter((b) => b.event === event);
  }

  search(query: string): BuildingBlock[] {
    const q = query.toLowerCase();
    return this.list().filter((b) => {
      if (b.name.toLowerCase().includes(q)) return true;
      if (b.description.toLowerCase().includes(q)) return true;
      if (b.tags.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }
}

export async function createDefaultRegistry(): Promise<CatalogRegistry> {
  const registry = new CatalogRegistry();
  try {
    const { builtinBlocks } = await import("./blocks/index.js");
    const blocks = builtinBlocks;
    for (const block of blocks) {
      registry.register(block);
    }
  } catch {
    // blocks/index.js may not exist yet; return empty registry
  }
  return registry;
}
