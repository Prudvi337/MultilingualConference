declare module 'peerjs-server' {
  import { Server as HttpServer } from 'http';

  export interface ExpressPeerServerOptions {
    debug?: boolean;
    path?: string;
    proxied?: boolean;
    port?: number;
    key?: string;
    cert?: string;
    allow_discovery?: boolean;
  }

  export class ExpressPeerServer {
    constructor(server: HttpServer, options?: ExpressPeerServerOptions);
  }

  export function ExpressPeerServer(server: HttpServer, options?: ExpressPeerServerOptions): ExpressPeerServer;
}
