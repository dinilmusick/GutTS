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

    let entry = this.entry;
    if (!entry) {
      const model = await this.loadOnce(load);
      entry = this.entry ?? {model, users: 0};
      this.entry = entry;
    }

    entry.users += 1;
    try {
      return await operation(entry.model);
    } finally {
      entry.users -= 1;
      if (entry.users === 0 && this.entry === entry) {
        this.entry = undefined;
        this.unloading = unload(entry.model).finally(() => {
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
