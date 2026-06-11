# openapi-express-server-gen

Generates a typed Express server skeleton from an OpenAPI 3.x spec. Given a spec, it writes five files into an output directory:

| File | Description |
|------|-------------|
| `models.ts` | TypeScript types for all schemas |
| `decoders.ts` | Runtime validators for all schemas |
| `types.ts` | `AuthHandlers` and `Application` interfaces |
| `index.ts` | `registerRoutes` function wiring routes to the `Application` interface |
| `utils/` | Fixed infrastructure: `requestHandler`, `appError`, `bearerAuthWrapper` |

`types.ts` and `index.ts` are regenerated on every run and should not be edited manually. `utils/` is also overwritten on every run. `models.ts` and `decoders.ts` are produced by [`openapi-typescript-validator`](https://github.com/Q42/openapi-typescript-validator).

## Requirements

- Node.js >= 18

## Installation

```bash
npm install --save-dev openapi-express-server-gen
npm install ajv
npm install ajv-formats  # only required if addFormats is true (the default)
```

`ajv` and `ajv-formats` are runtime dependencies of the generated `decoders.ts` and must be installed in the consuming project.

## Usage

### CLI

```bash
npx openapi-express-server-gen --spec ./openapi.yaml --out ./src/_generated/server
```

Both flags are optional:

| Flag | Default |
|------|---------|
| `--spec` | `./openapi.yaml` |
| `--out` | `./src/_generated/server` |

### Programmatic

```js
const { generate } = require('openapi-express-server-gen');

await generate({
  schemaFile: './openapi.yaml',
  directory: './src/_generated/server',
});
```

Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schemaFile` | `string` | — | Path to the OpenAPI YAML or JSON spec |
| `directory` | `string` | — | Output directory |
| `schemaType` | `'yaml' \| 'json'` | auto-detected | Override file type detection |
| `addFormats` | `boolean` | `true` | Pass AJV format validators to the generated decoders |

### Config file

Options can also be set in `openapi-server-gen.config.json` at the project root, or under an `"openapi-server-gen"` key in `package.json`. CLI flags take precedence over config file values.

```json
{
  "spec": "./openapi.yaml",
  "out": "./src/_generated/server"
}
```

## What gets generated

Given a spec with a `BearerAuth` security scheme and the following operations:

```yaml
POST /transactions   # query param + request body → 201 response
POST /fileUpload     # request body only → 200 response
GET  /fileUpload/{fileId}   # path param only → 200 response
GET  /documents/{documentId}  # integer path param → 200 response
```

### `types.ts`

```typescript
export type AuthHandlers<TBearerAuth> = {
    BearerAuth: (req: Request, scopes: string[]) => Promise<TBearerAuth>;
};

export type Application<TBearerAuth> = {
    createTransaction: (auth: TBearerAuth, parameters: { mode?: CreationMode }, payload: TransactionInput) => Promise<{status: 201, body: TransactionCreatedResponse}>;
    uploadFile: (auth: TBearerAuth, payload: FileUploadRequest) => Promise<{status: 200, body: FileUploadResponse}>;
    getFileUploadStatus: (auth: TBearerAuth, parameters: { fileId: string }) => Promise<{status: 200, body: FileUploadStatusResponse}>;
    getDocument: (auth: TBearerAuth, parameters: { documentId: number }) => Promise<{status: 200, body: DocumentInfo}>;
};
```

### `index.ts`

```typescript
export function registerRoutes<TBearerAuth>(
    app: Express,
    authHandler: AuthHandlers<TBearerAuth>,
    application: Application<TBearerAuth>
): void { ... }
```

## Consuming the generated code

Implement the `Application` interface with your business logic, wrap your auth with `bearerAuth` from `utils`, then pass both to `registerRoutes`:

```typescript
import express from 'express';
import { registerRoutes } from './_generated/server';
import { bearerAuth } from './_generated/server/utils';

const app = express();
app.use(express.json());

registerRoutes(app, {
    BearerAuth: bearerAuth(async (token) => {
        // validate token, return your auth object
    }),
}, application);
```

## Limitations

- Only `application/json` request and response bodies are supported
- Request and response body schemas must be named `$ref`s — inline schemas are not supported
- Path and query parameters with `object` or `array` schemas are skipped
- Operations without a `security` requirement are not yet supported and will be omitted from `index.ts`
- Only OpenAPI 3.x is supported
