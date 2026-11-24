import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

export class FileCredentialStore implements CredentialStore {
  readonly #path: string;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  #load(): Record<string, Credential> {
    try {
      return JSON.parse(readFileSync(this.#path, "utf8")) as Record<string, Credential>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  #save(data: Record<string, Credential>): void {
    const temporary = `${this.#path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.#path);
  }

  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(work, work);
    this.#chain = next.catch(() => {});
    return next;
  }

  read(providerId: string): Promise<Credential | undefined> {
    return Promise.resolve(this.#load()[providerId]);
  }

  list(): Promise<readonly CredentialInfo[]> {
    return Promise.resolve(
      Object.entries(this.#load()).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    );
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.#serialize(async () => {
      const data = this.#load();
      const next = await fn(data[providerId]);
      if (next === undefined) return data[providerId];
      data[providerId] = next;
      this.#save(data);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.#serialize(async () => {
      const data = this.#load();
      if (!(providerId in data)) return;
      delete data[providerId];
      this.#save(data);
    });
  }
}
