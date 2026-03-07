import { AsyncLocalStorage } from "async_hooks";

const requestContextStore = new AsyncLocalStorage();

const getRequestContext = () => requestContextStore.getStore() || null;

export { requestContextStore, getRequestContext };
