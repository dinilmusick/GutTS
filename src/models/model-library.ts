import {ModelResidency} from "./model-residency.js";
import type {ModelMetadata, ModelRuntime} from "./model-types.js";

export abstract class ModelLibrary<TModel> {
  readonly residency = new ModelResidency<TModel>();

  protected constructor(readonly metadata: ModelMetadata, readonly runtime: ModelRuntime<TModel>) {}

  async withModel<T>(operation: (model: TModel) => Promise<T>): Promise<T> {
    const lease = await this.residency.acquire(() => this.runtime.load(this.metadata));
    try {
      return await operation(lease.model);
    } finally {
      await lease.release();
      if (this.residency.activeUsers === 0) {
        await this.residency.dispose((model) => this.runtime.unload(model));
      }
    }
  }
}
