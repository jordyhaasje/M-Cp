export function createPersistDbQueue({ storage, getState }) {
  if (!storage || typeof storage.persistState !== "function") {
    throw new Error("storage.persistState is required");
  }
  if (typeof getState !== "function") {
    throw new Error("getState is required");
  }

  let writeQueue = Promise.resolve();

  return async function persistDb() {
    const nextWrite = writeQueue.catch(() => {}).then(() => storage.persistState(getState()));
    writeQueue = nextWrite.catch(() => {});
    await nextWrite;
  };
}
