import { GlobalIdPluginOptions } from '.';

// TODO: I couldn't get these to propagate up to projects that reference `@graphile/global-ids`

declare module 'graphile-build' {
  interface Options extends GlobalIdPluginOptions { }
}

declare module 'postgraphile-core' {
  interface Options extends GlobalIdPluginOptions { }
}

declare module 'postgraphile' {
  interface Options extends GlobalIdPluginOptions { }
}
