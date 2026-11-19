// The Workers runtime module that holds the bindings (wrangler.jsonc). Typed loosely here; env.ts gives them their types.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
