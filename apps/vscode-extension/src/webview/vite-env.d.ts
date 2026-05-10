/// <reference types="vite/client" />

// Vite's `?worker` suffix returns a Worker constructor for the
// imported chunk. Vite ships the canonical declaration at
// `vite/client`, but listing the specific module declarations here as
// well makes tsc accept the imports without `vite/client` having to
// be in `tsconfig.types`.

declare module "*?worker" {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}

declare module "*?worker&url" {
  const url: string;
  export default url;
}
