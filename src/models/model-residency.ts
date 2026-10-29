import type {ModelLease, ModelLoader, ModelUnloader} from "./model-types.js";

type Entry<TModel> = {
  model: TModel;
  users: number;
};

export class ModelResidency<TModel> {
  private entry?: Entry<TModel>;
  private loading?: Promise<TModel>;

  async acquire(load: ModelLoader<TModel>): Promise<ModelLease<TModel>> {
    if (this.entry) {
      this.entry.users += 1;
      return this.lease(this.entry.model);
    }

    if (!this.loading) {
      this.loading = load();
    }

    const model = await this.loading;
    this.loading = undefined;
    this.entry = {model, users: 1};
    return this.lease(model);
  }

  async dispose(unload: ModelUnloader<TModel>): Promise<void> {
    if (this.loading) {
      await this.loading;
      this.loading = undefined;
    }
    if (!this.entry) return;
    const {model} = this.entry;
    this.entry = undefined;
    await unload(model);
  }

  get activeUsers(): number {
    return this.entry?.users ?? 0;
  }

  get isLoaded(): boolean {
    return this.entry !== undefined;
  }

  private lease(model: TModel): ModelLease<TModel> {
    let released = false;
    return {
      model,
      release: async () => {
        if (released) return;
        released = true;
        if (!this.entry) return;
        this.entry.users -= 1;
      },
    };
  }
}
