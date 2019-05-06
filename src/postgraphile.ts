import { GlobalIdPluginOptions } from ".";

declare module "graphile-build" {
  // tslint:disable-next-line:no-empty-interface
  interface Options extends GlobalIdPluginOptions {}
}
