import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { reminders: {} };
  }

  async open() {
    try {
      this.state = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }
    return this;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`);
    await rename(temporaryPath, this.filePath);
  }

  async insert(reminder) {
    this.state.reminders[reminder.id] = reminder;
    await this.save();
    return reminder;
  }

  get(id) {
    return this.state.reminders[id] ?? null;
  }

  list() {
    return Object.values(this.state.reminders);
  }

  async update(id, update) {
    const reminder = this.get(id);
    if (!reminder) return null;
    Object.assign(reminder, update);
    await this.save();
    return reminder;
  }
}
