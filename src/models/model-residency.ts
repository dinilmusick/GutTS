import type {ModelLoader, ModelUnloader} from "./model-types.js";

type Entry<TModel> = {
  model: TModel;
  users: number;
};

export class ModelResidency<TModel> {
  private entry?: Entry<TModel>;
  private loading?: Promise<TModel>;
  private unloading?: Promise<void>;

  async run<T>(
    load: ModelLoader<TModel>,
    unload: ModelUnloader<TModel>,
    operation: (model: TModel) => Promise<T>,
  ): Promise<T> {
    await this.waitForUnload();

    if (!this.entry) {
      const model = await this.loadOnce(load);
      if (!this.entry) this.entry = {model, users: 0};
    }

    this.entry.users += 1;
    try {
      return await operation(this.entry.model);
    } finally {
      this.entry.users -= 1;
      if (this.entry.users === 0) {
        const model = this.entry.model;
        this.entry = undefined;
        this.unloading = unload(model).finally(() => {
          this.unloading = undefined;
        });
        await this.unloading;
      }
    }
  }

  get activeUsers(): number {
    return this.entry?.users ?? 0;
  }

  get isLoaded(): boolean {
    return this.entry !== undefined;
  }

  private async loadOnce(load: ModelLoader<TModel>): Promise<TModel> {
    if (!this.loading) {
      this.loading = load().finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  private async waitForUnload(): Promise<void> {
    if (this.unloading) await this.unloading;
  }
}
